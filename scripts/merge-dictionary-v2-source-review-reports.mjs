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
if (!reportPaths.length) throw new Error('Missing --reports');

const reviewsByCandidate = new Map();
for (const reportPath of reportPaths) {
  if (!fs.existsSync(reportPath)) throw new Error(`Report not found: ${reportPath}`);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (!Array.isArray(report.reviews)) throw new Error(`Report has no reviews array: ${reportPath}`);
  for (const review of report.reviews) {
    const candidate = key(review);
    const existing = reviewsByCandidate.get(candidate);
    if (!existing || betterReview(review, existing)) reviewsByCandidate.set(candidate, review);
  }
}

const reviews = [...reviewsByCandidate.values()];
const output = {
  ok: reviews.every((row) => row?.valid === true),
  generated_at: new Date().toISOString(),
  source_reports: reportPaths.map((filePath) => path.relative(process.cwd(), filePath)),
  policy: {
    source_meaning_review_only: true,
    automatic_database_write: false
  },
  summary: {
    reviews: reviews.length,
    approved: reviews.filter((row) => row?.approved === true).length,
    rejected: reviews.filter((row) => row?.decision === 'reject').length,
    manual_review: reviews.filter((row) => row?.decision === 'manual_review').length
  },
  reviews
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: output.ok, out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2));
if (!output.ok) process.exitCode = 1;

function key(row) {
  return `${Number(row?.source_entry_id)}:${Number(row?.source_sense_id ?? row?.first_sense_id)}`;
}

function betterReview(candidate, existing) {
  if (candidate?.valid === true && existing?.valid !== true) return true;
  if (candidate?.approved === true && existing?.approved !== true) return true;
  return Number(candidate?.confidence || 0) > Number(existing?.confidence || 0);
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
