#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const candidateReportPath = requiredPath(args['candidate-report'], 'candidate-report');
const consensusReportPaths = String(args['consensus-reports'] || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => path.resolve(value));
const outPath = requiredPath(args.out, 'out');

if (!consensusReportPaths.length) throw new Error('Missing --consensus-reports');

const candidateReport = readJson(candidateReportPath);
if (!Array.isArray(candidateReport.selected)) {
  throw new Error(`Candidate report has no selected array: ${candidateReportPath}`);
}

const candidatesByExactKey = new Map();
const candidatesByEntry = new Map();
for (const row of candidateReport.selected) {
  const exactKey = candidateKey(row);
  if (exactKey && !candidatesByExactKey.has(exactKey)) candidatesByExactKey.set(exactKey, row);
  const entryKey = String(Number(row.source_entry_id));
  if (!candidatesByEntry.has(entryKey)) candidatesByEntry.set(entryKey, []);
  candidatesByEntry.get(entryKey).push(row);
}

const selectedByKey = new Map();
const missing = [];
const ambiguous = [];
let acceptedReviewCount = 0;
for (const consensusPath of consensusReportPaths) {
  const consensus = readJson(consensusPath);
  const reviews = Array.isArray(consensus.reviews) ? consensus.reviews : [];
  for (const review of reviews.filter(isAcceptedReview)) {
    acceptedReviewCount += 1;
    const exactKey = candidateKey(review);
    let candidate = exactKey ? candidatesByExactKey.get(exactKey) : null;
    if (!candidate) {
      const entryRows = candidatesByEntry.get(String(Number(review.source_entry_id))) || [];
      if (entryRows.length === 1) candidate = entryRows[0];
      else if (entryRows.length > 1) {
        ambiguous.push(reviewIdentity(review, consensusPath));
        continue;
      }
    }
    if (!candidate) {
      missing.push(reviewIdentity(review, consensusPath));
      continue;
    }
    const key = candidateKey(candidate) || `entry:${Number(candidate.source_entry_id)}`;
    if (!selectedByKey.has(key)) {
      selectedByKey.set(key, {
        ...candidate,
        verified_consensus: {
          accepted: true,
          consensus_report: path.relative(process.cwd(), consensusPath),
          source_entry_id: Number(review.source_entry_id),
          source_sense_id: Number(review.source_sense_id ?? review.output?.source_sense_id) || null
        }
      });
    }
  }
}

const selected = [...selectedByKey.values()].sort(
  (left, right) => Number(left.frequency_rank ?? Infinity) - Number(right.frequency_rank ?? Infinity)
);
const output = {
  ok: missing.length === 0 && ambiguous.length === 0,
  generated_at: new Date().toISOString(),
  candidate_report: path.relative(process.cwd(), candidateReportPath),
  consensus_reports: consensusReportPaths.map((value) => path.relative(process.cwd(), value)),
  selected_count: selected.length,
  selected,
  summary: {
    accepted_reviews: acceptedReviewCount,
    mapped_unique_candidates: selected.length,
    missing: missing.length,
    ambiguous: ambiguous.length
  },
  missing,
  ambiguous
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out: path.relative(process.cwd(), outPath), ...output.summary }, null, 2));
if (!output.ok) process.exitCode = 1;

function isAcceptedReview(row) {
  if (row?.consensus_accepted === true) return true;
  return row?.valid === true && row?.decision === 'accept' && Number(row?.confidence) >= 0.9;
}

function candidateKey(row) {
  const entryId = Number(row?.source_entry_id);
  const senseId = Number(row?.source_sense_id ?? row?.output?.source_sense_id ?? row?.first_sense_id);
  if (!Number.isInteger(entryId) || !Number.isInteger(senseId)) return null;
  return `${entryId}:${senseId}`;
}

function reviewIdentity(row, reportPath) {
  return {
    source_entry_id: Number(row?.source_entry_id),
    source_sense_id: Number(row?.source_sense_id ?? row?.output?.source_sense_id) || null,
    report: path.relative(process.cwd(), reportPath)
  };
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Report not found: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return path.resolve(value);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index += 1;
    } else parsed[key] = true;
  }
  return parsed;
}
