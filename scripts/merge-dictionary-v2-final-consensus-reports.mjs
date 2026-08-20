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

const reports = reportPaths.map(readJson);
const reviewsByCandidate = new Map();
for (const report of reports) {
  if (!Array.isArray(report?.reviews)) throw new Error('Final consensus report has no reviews array.');
  for (const review of report.reviews) {
    const candidate = key(review);
    const existing = reviewsByCandidate.get(candidate);
    if (!existing || betterReview(review, existing)) reviewsByCandidate.set(candidate, review);
  }
}

const reviews = [...reviewsByCandidate.values()];
const accepted = reviews.filter(isAcceptedNoCorrection);
const output = {
  ok: reviews.every((row) => row?.valid === true),
  generated_at: new Date().toISOString(),
  source_reports: reportPaths.map((filePath) => path.relative(process.cwd(), filePath)),
  policy: {
    reviewer_model: reports.find((report) => report?.policy?.reviewer_model)?.policy?.reviewer_model || null,
    generation_model: reports.find((report) => report?.policy?.generation_model)?.policy?.generation_model || null,
    confidence_threshold: Math.max(...reports.map((report) => Number(report?.policy?.confidence_threshold || 0.9))),
    independent_model_families: reports.every((report) => report?.policy?.independent_model_families === true),
    require_no_corrections: true,
    automatic_promotion: false,
    later_accepted_reviews_replace_earlier_rejections: true
  },
  summary: {
    reviews: reviews.length,
    accepted: accepted.length,
    rejected: reviews.filter((row) => row?.decision === 'reject').length,
    manual_review: reviews.filter((row) => row?.decision === 'manual_review').length,
    failed: reviews.filter((row) => row?.valid !== true).length
  },
  reviews
};

if (!output.policy.independent_model_families) {
  throw new Error('Every final consensus report must certify independent model families.');
}
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: output.ok, out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2));

function isAcceptedNoCorrection(row) {
  return row?.valid === true &&
    row?.decision === 'accept' &&
    row?.consensus_accepted === true &&
    Array.isArray(row?.corrections) &&
    row.corrections.length === 0;
}

function betterReview(candidate, existing) {
  if (isAcceptedNoCorrection(candidate) !== isAcceptedNoCorrection(existing)) {
    return isAcceptedNoCorrection(candidate);
  }
  if ((candidate?.valid === true) !== (existing?.valid === true)) return candidate?.valid === true;
  return Number(candidate?.confidence || 0) >= Number(existing?.confidence || 0);
}

function key(row) {
  const entryId = Number(row?.source_entry_id);
  const senseId = Number(row?.source_sense_id ?? row?.first_sense_id);
  if (!Number.isInteger(entryId) || !Number.isInteger(senseId)) {
    throw new Error(`Review lacks exact source identity: ${JSON.stringify(row).slice(0, 240)}`);
  }
  return `${entryId}:${senseId}`;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Report not found: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
