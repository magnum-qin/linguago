#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const selectedReports = csvPaths(args['selected-reports']);
const rejectedReports = csvPaths(args['rejected-reports']);
const outPath = path.resolve(args.out || 'logs/native-alignment-retry-cohort.json');
const targets = parseTargets(args.targets || 'zh=100,ja=100');
const excludedKeys = loadExcludedKeys(args['exclude-reports']);

if (!selectedReports.length || selectedReports.length !== rejectedReports.length) {
  throw new Error('--selected-reports and --rejected-reports must contain matching non-empty lists');
}

const candidates = [];
const seen = new Set();
const inputs = [];
for (let index = 0; index < selectedReports.length; index += 1) {
  const selectedPath = selectedReports[index];
  const rejectedPath = rejectedReports[index];
  const selectedReport = readJson(selectedPath);
  const rejectedReport = readJson(rejectedPath);
  const retryIds = new Set(
    (rejectedReport.rejected || [])
      .filter((row) => row.sense_alignment?.reason === 'no_eligible_sense')
      .map((row) => `${row.source_entry_id}:${row.sense_alignment?.original_sense_id ?? ''}`)
  );
  let matched = 0;
  for (const row of selectedReport.selected || []) {
    const key = `${row.source_entry_id}:${row.first_sense_id ?? ''}`;
    if (!retryIds.has(key) || seen.has(key) || excludedKeys.has(key)) continue;
    if (!isAuthoritativeNativeRow(row)) continue;
    seen.add(key);
    matched += 1;
    candidates.push({
      ...row,
      alignment_retry: {
        reason: 'historical_no_eligible_sense',
        selected_report: relative(selectedPath),
        rejected_report: relative(rejectedPath)
      }
    });
  }
  inputs.push({
    selected_report: relative(selectedPath),
    rejected_report: relative(rejectedPath),
    retry_ids: retryIds.size,
    matched
  });
}

candidates.sort((left, right) =>
  Number(left.frequency_rank ?? Number.MAX_SAFE_INTEGER) - Number(right.frequency_rank ?? Number.MAX_SAFE_INTEGER) ||
  String(left.normalized_key || left.word).localeCompare(String(right.normalized_key || right.word)) ||
  Number(left.source_entry_id) - Number(right.source_entry_id)
);

const counts = { zh: 0, ja: 0 };
const selected = [];
for (const row of candidates) {
  if (!(row.source_lang in targets) || counts[row.source_lang] >= targets[row.source_lang]) continue;
  selected.push(row);
  counts[row.source_lang] += 1;
  if (Object.keys(targets).every((lang) => counts[lang] >= targets[lang])) break;
}

const report = {
  ok: true,
  generated_at: new Date().toISOString(),
  policy: {
    rejection_reason: 'no_eligible_sense',
    authoritative_sources: { zh: 'cc-cedict', ja: 'jmdict' },
    target_by_lang: targets,
    excluded_candidate_keys: excludedKeys.size,
    database_writes: 0
  },
  inputs,
  summary: {
    matched_candidates: candidates.length,
    selected_by_lang: counts,
    targets_satisfied: Object.keys(targets).every((lang) => counts[lang] >= targets[lang])
  },
  selected_count: selected.length,
  selected
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary: report.summary }, null, 2));

function isAuthoritativeNativeRow(row) {
  if (row.source_lang === 'zh') return normalize(row.native_source_family) === 'cc-cedict';
  if (row.source_lang === 'ja') return normalize(row.native_source_family) === 'jmdict';
  return false;
}

function parseTargets(value) {
  const result = {};
  for (const pair of String(value).split(',')) {
    const [lang, rawCount] = pair.split('=');
    const count = Number.parseInt(rawCount, 10);
    if (!['zh', 'ja'].includes(lang) || !Number.isInteger(count) || count < 0) {
      throw new Error(`Invalid target: ${pair}`);
    }
    result[lang] = count;
  }
  return result;
}

function csvPaths(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean).map((item) => path.resolve(item));
}

function loadExcludedKeys(value) {
  const keys = new Set();
  for (const reportPath of csvPaths(value)) {
    const report = readJson(reportPath);
    for (const row of report.selected || []) {
      keys.add(`${row.source_entry_id}:${row.first_sense_id ?? ''}`);
    }
  }
  return keys;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Report not found: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalize(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase();
}

function relative(filePath) {
  return path.relative(process.cwd(), filePath).replaceAll('\\', '/');
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) parsed[token.slice(2)] = true;
    else {
      parsed[token.slice(2)] = next;
      index += 1;
    }
  }
  return parsed;
}
