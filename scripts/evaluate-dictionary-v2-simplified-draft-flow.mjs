#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const runDirs = String(args.runs || '')
  .split(',')
  .map((value) => path.resolve(value.trim()))
  .filter(Boolean);
const outPath = args.out ? path.resolve(args.out) : null;
const minimumStructureRate = numberArg(args['min-structure-rate'], 0.9);
const minimumReleaseRetention = numberArg(args['min-release-retention'], 0.9);

if (runDirs.length === 0) {
  throw new Error('Provide at least one run directory with --runs <dir,dir>');
}

const runs = runDirs.map(evaluateRun);
const totals = runs.reduce(
  (sum, run) => {
    for (const key of [
      'generated',
      'structurally_valid',
      'reverse_supported',
      'final_reviewed',
      'final_accepted',
      'final_rejected_or_manual'
    ]) {
      sum[key] += run.counts[key];
    }
    for (const key of ['generation', 'reverse_evidence', 'final_review']) {
      sum.duration_seconds[key] += run.duration_seconds[key];
    }
    return sum;
  },
  {
    generated: 0,
    structurally_valid: 0,
    reverse_supported: 0,
    final_reviewed: 0,
    final_accepted: 0,
    final_rejected_or_manual: 0,
    duration_seconds: { generation: 0, reverse_evidence: 0, final_review: 0 }
  }
);

const rates = {
  structure_valid: ratio(totals.structurally_valid, totals.generated),
  reverse_retention: ratio(totals.reverse_supported, totals.structurally_valid),
  release_retention: ratio(totals.final_accepted, totals.structurally_valid),
  generated_to_release: ratio(totals.final_accepted, totals.generated)
};
const verdict = {
  draft_only_bulk_generation: rates.structure_valid >= minimumStructureRate &&
    rates.release_retention >= minimumReleaseRetention
    ? 'pass'
    : 'fail',
  direct_publish_without_release_gates: 'fail',
  reasons: []
};
if (rates.structure_valid < minimumStructureRate) {
  verdict.reasons.push(`structure_valid_below_${minimumStructureRate}`);
}
if (rates.release_retention < minimumReleaseRetention) {
  verdict.reasons.push(`release_retention_below_${minimumReleaseRetention}`);
}
if (totals.final_rejected_or_manual > 0) {
  verdict.reasons.push('final_review_still_rejects_structurally_valid_drafts');
}

const report = {
  ok: verdict.draft_only_bulk_generation === 'pass',
  generated_at: new Date().toISOString(),
  policy: {
    minimum_structure_rate: minimumStructureRate,
    minimum_release_retention: minimumReleaseRetention,
    candidate_content_included: false
  },
  totals,
  rates,
  verdict,
  runs
};

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, serialized, 'utf8');
}
process.stdout.write(serialized);
if (!report.ok) process.exitCode = 2;

function evaluateRun(runDir) {
  const generation = readJson(path.join(runDir, '05-qwen-generation.json'));
  const reverse = readJson(path.join(runDir, '06-reverse-evidence-supported.json'));
  const finalReview = readJson(path.join(runDir, '07-final-gemma.json'));
  const finalAccepted = readJson(path.join(runDir, '07-final-gemma-accepted.json'));
  const manifest = readJson(path.join(runDir, 'manifest.json'));
  const generated = arrayField(generation, 'generated');
  const structurallyValid = generated.filter((item) => item?.valid === true);
  const reverseSupported = arrayField(reverse, 'generated');
  const reviewed = arrayField(finalReview, 'reviews');
  const accepted = arrayField(finalAccepted, 'reviews');
  const acceptedKeys = new Set(accepted.map(candidateKey));
  const validKeys = new Set(structurallyValid.map(candidateKey));
  const acceptedFromValid = [...acceptedKeys].filter((key) => validKeys.has(key)).length;

  return {
    run: path.basename(runDir),
    counts: {
      generated: generated.length,
      structurally_valid: structurallyValid.length,
      reverse_supported: reverseSupported.length,
      final_reviewed: reviewed.length,
      final_accepted: acceptedFromValid,
      final_rejected_or_manual: Math.max(0, structurallyValid.length - acceptedFromValid)
    },
    rates: {
      structure_valid: ratio(structurallyValid.length, generated.length),
      reverse_retention: ratio(reverseSupported.length, structurallyValid.length),
      release_retention: ratio(acceptedFromValid, structurallyValid.length)
    },
    duration_seconds: {
      generation: stageDuration(manifest, 'qwen_generation'),
      reverse_evidence: stageDuration(manifest, 'reverse_evidence'),
      final_review: stageDuration(manifest, 'final_gemma')
    }
  };
}

function candidateKey(item) {
  const sourceEntryId = item?.source_entry_id ?? item?.output?.source_entry_id;
  const sourceSenseId = item?.source_sense_id ?? item?.output?.source_sense_id;
  return `${sourceEntryId ?? ''}:${sourceSenseId ?? ''}`;
}

function stageDuration(manifest, stage) {
  const value = Number(manifest?.stages?.[stage]?.duration_seconds || 0);
  return Number.isFinite(value) ? value : 0;
}

function arrayField(value, key) {
  return Array.isArray(value?.[key]) ? value[key] : [];
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing required report: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
}

function numberArg(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`Expected a rate between 0 and 1, got: ${value}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith('--') ? argv[++index] : true;
  }
  return parsed;
}
