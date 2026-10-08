#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const inputPaths = String(args.inputs || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => requiredPath(value));
const outPath = path.resolve(required(args.out, 'out'));
if (inputPaths.length < 2) throw new Error('Expected at least two --inputs reports');

const reports = inputPaths.map((filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8')));
if (reports.some((report) => report.research_only !== true || report.production_publishable !== false)) {
  throw new Error('Expected research-only, non-publishable reports');
}
const models = unique(reports.map((report) => String(report.model || '').trim()));
if (models.length !== 1) throw new Error(`Review model mismatch: ${models.join(', ')}`);

const reviewsByKey = new Map();
for (const report of reports) {
  for (const review of report.reviews || []) {
    const key = String(review.candidate_key || '').trim();
    if (!key) throw new Error('Review is missing candidate_key');
    if (reviewsByKey.has(key)) throw new Error(`Duplicate candidate_key across shards: ${key}`);
    reviewsByKey.set(key, review);
  }
}
const reviews = [...reviewsByKey.values()];
const valid = reviews.filter((row) => row.valid === true);
const output = {
  ok: reports.every((report) => report.ok !== false),
  generated_at: new Date().toISOString(),
  research_only: true,
  production_publishable: false,
  publication_evidence: false,
  source_reports: inputPaths.map((value) => path.relative(process.cwd(), value)),
  reviewer: reports[0].reviewer,
  model: models[0],
  confidence_threshold: reports[0].confidence_threshold,
  summary: {
    total: reviews.length,
    valid: valid.length,
    approved: reviews.filter((row) => row.approved === true).length,
    rejected: reviews.filter((row) => row.decision === 'reject').length,
    manual_review: reviews.filter((row) => row.decision === 'manual_review').length,
    errors: reviews.filter((row) => row.valid !== true).length
  },
  reviews
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2));

function unique(values) { return [...new Set(values.filter(Boolean))]; }
function required(value, name) { if (!value) throw new Error(`Missing --${name}`); return String(value); }
function requiredPath(value) { const result = path.resolve(value); if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`); return result; }
function parseArgs(argv) { const out = {}; for (let index = 0; index < argv.length; index += 1) { const token = argv[index]; if (!token.startsWith('--')) continue; const key = token.slice(2); const next = argv[index + 1]; out[key] = next && !next.startsWith('--') ? argv[++index] : true; } return out; }
