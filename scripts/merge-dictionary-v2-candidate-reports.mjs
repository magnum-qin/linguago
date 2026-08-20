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
const excludeReportPaths = String(args['exclude-reports'] || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => path.resolve(value));
if (!reportPaths.length) throw new Error('Missing --reports');

const excludedKeys = new Set();
for (const reportPath of excludeReportPaths) {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  for (const candidate of reportRows(report)) excludedKeys.add(key(candidate));
}

const selectedByKey = new Map();
const order = [];
for (const reportPath of reportPaths) {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (!Array.isArray(report?.selected)) throw new Error(`Report has no selected array: ${reportPath}`);
  for (const candidate of report.selected) {
    const candidateKey = key(candidate);
    if (excludedKeys.has(candidateKey)) continue;
    if (!selectedByKey.has(candidateKey)) order.push(candidateKey);
    selectedByKey.set(candidateKey, candidate);
  }
}

const selected = order.map((candidateKey) => selectedByKey.get(candidateKey));
const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_reports: reportPaths.map((filePath) => path.relative(process.cwd(), filePath)),
  excluded_reports: excludeReportPaths.map((filePath) => path.relative(process.cwd(), filePath)),
  policy: {
    exact_source_identity: true,
    later_reports_replace_earlier_candidates: true,
    automatic_promotion: false
  },
  excluded_count: excludedKeys.size,
  selected_count: selected.length,
  selected
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, selected: selected.length, out: path.relative(process.cwd(), outPath) }, null, 2));

function key(row) {
  const entryId = Number(row?.source_entry_id);
  const senseId = Number(row?.source_sense_id ?? row?.first_sense_id ?? row?.output?.source_sense_id);
  if (!Number.isInteger(entryId) || !Number.isInteger(senseId)) {
    throw new Error(`Candidate lacks exact source identity: ${JSON.stringify(row).slice(0, 240)}`);
  }
  return `${entryId}:${senseId}`;
}

function reportRows(report) {
  if (Array.isArray(report?.selected)) return report.selected;
  if (Array.isArray(report?.generated)) return report.generated;
  if (Array.isArray(report?.replayed)) return report.replayed;
  return [];
}

function required(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return String(value);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const keyName = token.slice(2);
    const next = argv[index + 1];
    parsed[keyName] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return parsed;
}
