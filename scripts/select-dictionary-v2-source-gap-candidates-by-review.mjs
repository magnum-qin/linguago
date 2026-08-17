#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const reviewPath = requiredPath(args.review, 'review');
const outPath = requiredPath(args.out, 'out');
const report = readJson(reportPath);
const review = readJson(reviewPath);
const offset = boundedInteger(args.offset, 0, 0);
const limit = boundedInteger(args.limit, Number.MAX_SAFE_INTEGER, 1);
const acceptedOnly = args['accepted-only'] === 'true';
const reviewRows = (review.reviews || []).filter(
  (row) => !acceptedOnly || row?.valid === true && row?.consensus_accepted === true
);
const reviewKeys = reviewRows.slice(offset, offset + limit).map(key);
const selectedByKey = new Map((report.selected || []).map((row) => [key(row), row]));
const missing = reviewKeys.filter((candidateKey) => !selectedByKey.has(candidateKey));
if (missing.length) throw new Error(`Report is missing ${missing.length} reviewed candidates: ${missing.join(', ')}`);
const selected = reviewKeys.map((candidateKey) => selectedByKey.get(candidateKey));
const output = {
  ...report,
  generated_at: new Date().toISOString(),
  derived_from: {
    report: relative(reportPath),
    review: relative(reviewPath)
  },
  selection_policy: {
    exact_review_candidate_replay: true,
    accepted_only: acceptedOnly,
    preserve_review_order: true
  },
  selected_count: selected.length,
  selected
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out: relative(outPath), selected: selected.length }, null, 2));

function key(row) {
  return `${Number(row.source_entry_id)}:${Number(row.source_sense_id ?? row.first_sense_id)}`;
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return path.resolve(value);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function relative(filePath) {
  return path.relative(process.cwd(), filePath);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const name = argv[index].slice(2);
    const next = argv[index + 1];
    parsed[name] = next && !next.startsWith('--') ? argv[++index] : true;
  }
  return parsed;
}

function boundedInteger(value, fallback, minimum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
}
