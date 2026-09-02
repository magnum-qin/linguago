#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const headwordPath = requiredPath(args.headwords, 'headwords');
const additionalPath = requiredPath(args['additional-senses'], 'additional-senses');
const outPath = requiredPath(args.out, 'out');
const headwordLimit = nonNegativeInteger(args['headword-limit'], 60);
const additionalLimit = nonNegativeInteger(args['additional-sense-limit'], 40);
const headwordPool = readRows(headwordPath);
const headwords = headwordPool.slice(0, headwordLimit);
const additional = readRows(additionalPath).slice(0, additionalLimit);
const selected = [];
const seen = new Set();

for (const [lane, rows] of [['new_headword', headwords], ['additional_sense', additional]]) {
  for (const row of rows) {
    const key = `${Number(row.source_entry_id || 0)}:${Number(row.source_sense_id || row.first_sense_id || 0)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push({ ...row, production_lane: lane });
  }
}
for (const row of headwordPool.slice(headwordLimit)) {
  if (selected.length >= headwordLimit + additionalLimit) break;
  const key = `${Number(row.source_entry_id || 0)}:${Number(row.source_sense_id || row.first_sense_id || 0)}`;
  if (seen.has(key)) continue;
  seen.add(key);
  selected.push({ ...row, production_lane: 'new_headword' });
}

const output = {
  ok: true,
  status: selected.length ? 'ready' : 'candidate_exhausted',
  generated_at: new Date().toISOString(),
  policy: {
    headword_ratio: 0.6,
    additional_sense_ratio: 0.4,
    fill_additional_sense_shortfall_with_valid_headwords: true,
    fill_shortfall_with_low_value_candidates: false
  },
  inputs: [fingerprint(headwordPath), fingerprint(additionalPath)],
  selected_count: selected.length,
  summary: {
    selected_by_lane: countBy(selected, (row) => row.production_lane),
    selected_by_source_lang: countBy(selected, (row) => row.source_lang)
  },
  selected
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, status: output.status, out: relative(outPath), summary: output.summary }, null, 2));

function readRows(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const report = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (Array.isArray(report)) return report;
  return report.selected || report.items || report.candidates || [];
}

function fingerprint(filePath) {
  const contents = fs.readFileSync(filePath);
  return { path: relative(filePath), bytes: contents.length, sha256: crypto.createHash('sha256').update(contents).digest('hex') };
}

function countBy(rows, selector) {
  const result = {};
  for (const row of rows) {
    const key = String(selector(row) || 'unknown');
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return path.resolve(value);
}

function nonNegativeInteger(value, fallback) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`Expected non-negative integer, got ${value}`);
  return number;
}

function relative(value) { return path.relative(process.cwd(), value); }

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) { result[key] = next; index += 1; }
    else result[key] = 'true';
  }
  return result;
}
