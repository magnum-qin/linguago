#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPaths = String(args.reports || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => path.resolve(value));
const outPath = path.resolve(required(args.out, 'out'));
const onlyValid = args['only-valid'] !== 'false';
if (!reportPaths.length) throw new Error('Missing --reports');

const generatedByCandidate = new Map();
for (const reportPath of reportPaths) {
  if (!fs.existsSync(reportPath)) throw new Error(`Report not found: ${reportPath}`);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const rows = Array.isArray(report.generated)
    ? report.generated
    : Array.isArray(report.replayed)
      ? report.replayed
      : null;
  if (!rows) throw new Error(`Report has no generated or replayed array: ${reportPath}`);
  for (const item of rows) {
    if (onlyValid && item?.valid !== true) continue;
    generatedByCandidate.set(key(item), item);
  }
}

const generated = [...generatedByCandidate.values()];
const output = {
  ok: generated.every((item) => item?.valid === true),
  generated_at: new Date().toISOString(),
  source_reports: reportPaths.map((filePath) => path.relative(process.cwd(), filePath)),
  stats: {
    generated: generated.length,
    accepted: generated.filter((item) => item?.valid === true).length,
    rejected: generated.filter((item) => item?.valid !== true).length,
    only_valid: onlyValid,
    later_reports_replace_earlier_candidates: true
  },
  generated
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: output.ok, out: path.relative(process.cwd(), outPath), stats: output.stats }, null, 2));
if (!output.ok) process.exitCode = 1;

function key(item) {
  const sourceEntryId = Number(item?.source_entry_id);
  const sourceSenseId = Number(item?.source_sense_id ?? item?.output?.source_sense_id);
  if (!Number.isInteger(sourceEntryId) || !Number.isInteger(sourceSenseId)) {
    throw new Error(`Generated item lacks exact source identity: ${JSON.stringify(item).slice(0, 240)}`);
  }
  return `${sourceEntryId}:${sourceSenseId}`;
}

function required(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return String(value);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const keyName = token.slice(2);
    const next = argv[index + 1];
    parsed[keyName] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return parsed;
}
