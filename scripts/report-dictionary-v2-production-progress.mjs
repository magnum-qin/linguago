#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const runDir = path.resolve(required(args['run-dir'], 'run-dir'));
const now = Date.now();
const manifestPath = path.join(runDir, 'manifest.json');
const manifest = readJson(manifestPath);
const stages = Object.entries(manifest.stages || {}).map(([name, stage]) => ({
  name,
  status: stage?.status || 'unknown',
  started_at: stage?.started_at || null,
  completed_at: stage?.completed_at || null,
  duration_seconds: numberOrNull(stage?.duration_seconds)
}));
const activeStage = stages.find((stage) => stage.status === 'running') || null;
const progress = activeStage ? inspectStageProgress(activeStage.name) : inspectCompletedProgress();
const heartbeatPath = progress?.source_path ? path.join(runDir, progress.source_path) : manifestPath;
const heartbeat = fs.existsSync(heartbeatPath) ? fs.statSync(heartbeatPath) : null;

console.log(JSON.stringify({
  ok: true,
  run_id: manifest.run_id || path.basename(runDir),
  run_status: manifest.status || 'unknown',
  active_stage: activeStage?.name || null,
  progress,
  heartbeat: heartbeat ? {
    source: path.relative(runDir, heartbeatPath),
    updated_at: heartbeat.mtime.toISOString(),
    age_seconds: Math.max(0, Math.round((now - heartbeat.mtimeMs) / 1000))
  } : null,
  stages
}, null, 2));

function inspectStageProgress(stageName) {
  const descriptors = {
    gemma_source_review: {
      report: '03-gemma-source-review.json',
      input: '00b-source-sense-aligned.json',
      completed: (report) => Number(report?.summary?.reviewed || rowsFrom(report, ['reviews']).length),
      accepted: (report) => Number(report?.summary?.approved || 0),
      rejected: (report) => Number(report?.summary?.rejected || 0) + Number(report?.summary?.manual_review || 0)
    },
    source_suggested_reverse_evidence: reportDescriptor('04b-source-consensus-reverse-evidence.json', ['validations', 'selected'], '03-gemma-source-review-approved.json'),
    semantic_preview_gemma: reportDescriptor('04d-semantic-preview-gemma.json', ['reviews'], '04c-semantic-preview.json'),
    qwen_generation: generationDescriptor('05-qwen-generation.checkpoint.json', '04f-generation-ready-candidates.json'),
    reverse_evidence: reportDescriptor('06-reverse-evidence.json', ['validations', 'selected'], '05-qwen-generation.json'),
    final_gemma: reportDescriptor('07-final-gemma.json', ['reviews'], '06-reverse-evidence-supported.json'),
    qwen_repair_generation: generationDescriptor('09-qwen-repair-generation.checkpoint.json', '08-structured-correction-retry.json'),
    repair_reverse_evidence: reportDescriptor('10-repair-reverse-evidence.json', ['validations', 'selected'], '09-qwen-repair-generation.json'),
    repair_final_gemma: reportDescriptor('11-repair-final-gemma.json', ['reviews'], '10-repair-reverse-evidence-supported.json')
  };
  const descriptor = descriptors[stageName];
  if (!descriptor) return inspectLogProgress(stageName);
  const reportPath = path.join(runDir, descriptor.report);
  const inputPath = descriptor.input ? path.join(runDir, descriptor.input) : null;
  const report = optionalJson(reportPath);
  if (!report) return inspectLogProgress(stageName);
  const input = inputPath ? optionalJson(inputPath) : null;
  const completed = descriptor.completed(report);
  const total = input ? reportItemCount(input) : numberOrNull(report?.summary?.selected) ?? completed;
  return {
    stage: stageName,
    completed,
    total,
    remaining: Number.isFinite(total) ? Math.max(0, total - completed) : null,
    accepted: descriptor.accepted(report),
    rejected: descriptor.rejected(report),
    source_path: fs.existsSync(reportPath) ? descriptor.report : null
  };
}

function inspectCompletedProgress() {
  const summaryPath = path.join(runDir, 'summary.json');
  const summary = optionalJson(summaryPath);
  return summary ? {
    stage: 'complete',
    completed: numberOrNull(summary?.summary?.generated ?? summary?.summary?.selected),
    total: numberOrNull(summary?.summary?.selected),
    remaining: 0,
    accepted: numberOrNull(summary?.summary?.final_accepted ?? summary?.summary?.accepted),
    rejected: null,
    source_path: 'summary.json'
  } : null;
}

function generationDescriptor(report, input) {
  return {
    report,
    input,
    completed: (value) => Object.keys(value?.items || {}).length,
    accepted: (value) => Object.values(value?.items || {}).filter((item) => item?.status === 'accepted').length,
    rejected: (value) => Object.values(value?.items || {}).filter((item) => item?.status && item.status !== 'accepted').length
  };
}

function reportDescriptor(report, rowKeys, input = null) {
  return {
    report,
    input,
    completed: (value) => Number(value?.summary?.reviewed ?? value?.summary?.validated ?? rowsFrom(value, rowKeys).length),
    accepted: (value) => Number(value?.summary?.approved ?? value?.summary?.supported ?? value?.summary?.accepted ?? 0),
    rejected: (value) => Number(value?.summary?.rejected ?? value?.summary?.unsupported ?? 0)
  };
}

function inspectLogProgress(stageName) {
  const sourcePath = `${stageName}.log`;
  const logPath = path.join(runDir, sourcePath);
  if (!fs.existsSync(logPath)) {
    return { stage: stageName, completed: null, total: null, remaining: null, accepted: null, rejected: null, source_path: null };
  }
  const tail = readFileTail(logPath, 64 * 1024);
  const matches = [...tail.matchAll(/completed=(\d+)\/(\d+)/gu)];
  const latest = matches.at(-1);
  const completed = latest ? Number(latest[1]) : null;
  const total = latest ? Number(latest[2]) : null;
  return {
    stage: stageName,
    completed,
    total,
    remaining: completed !== null && total !== null ? Math.max(0, total - completed) : null,
    accepted: null,
    rejected: null,
    source_path: sourcePath
  };
}

function readFileTail(filePath, maximumBytes) {
  const size = fs.statSync(filePath).size;
  const length = Math.min(size, maximumBytes);
  const buffer = Buffer.alloc(length);
  const descriptor = fs.openSync(filePath, 'r');
  try {
    fs.readSync(descriptor, buffer, 0, length, size - length);
  } finally {
    fs.closeSync(descriptor);
  }
  return buffer.toString('utf8');
}

function reportItemCount(value) {
  const direct = rowsFrom(value, ['candidates', 'selected', 'items', 'reviews', 'generated', 'validations']);
  if (direct.length) return direct.length;
  for (const key of ['count', 'selected', 'reviewed', 'total']) {
    const count = numberOrNull(value?.summary?.[key]);
    if (count !== null) return count;
  }
  return 0;
}

function rowsFrom(value, keys) { for (const key of keys) if (Array.isArray(value?.[key])) return value[key]; return []; }
function optionalJson(filePath) { return fs.existsSync(filePath) ? readJson(filePath) : null; }
function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, '')); }
function numberOrNull(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function required(value, name) { if (!value) throw new Error(`Missing --${name}`); return String(value); }
function parseArgs(argv) { const output = {}; for (let index = 0; index < argv.length; index += 1) { if (!argv[index].startsWith('--')) continue; const key = argv[index].slice(2); const next = argv[index + 1]; output[key] = next && !next.startsWith('--') ? argv[++index] : 'true'; } return output; }
