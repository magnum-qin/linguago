#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const primaryPath = requiredPath(args.primary, 'primary');
const secondaryPath = requiredPath(args.secondary, 'secondary');
const outPath = requiredPath(args.out, 'out', false);
const sourceReportPath = args.report ? requiredPath(args.report, 'report') : null;
const approvedOutPath = args['approved-out'] ? requiredPath(args['approved-out'], 'approved-out', false) : null;
if (approvedOutPath && !sourceReportPath) throw new Error('--report is required with --approved-out');
const primary = readReviews(primaryPath);
const secondary = new Map(readReviews(secondaryPath).map((row) => [key(row), row]));

const adjudicated = primary.map((row) => {
  const peer = secondary.get(key(row));
  let decision = 'unresolved';
  if (row.valid && row.approved && !peer) decision = 'primary_accept_unadjudicated';
  else if (row.valid && peer?.valid && row.approved && peer.approved) decision = 'consensus_accept';
  else if (row.valid && peer?.valid && !row.approved && !peer.approved) decision = 'consensus_reject';
  else if (row.valid && peer?.valid && row.approved !== peer.approved) decision = 'reviewer_disagreement';
  return {
    source_entry_id: row.source_entry_id,
    source_sense_id: row.source_sense_id,
    word: row.word,
    source_lang: row.source_lang,
    decision,
    primary: compact(row),
    secondary: peer ? compact(peer) : null
  };
});

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  primary: relative(primaryPath),
  secondary: relative(secondaryPath),
  policy: {
    reviewer_disagreement_is_manual_review: true,
    invalid_or_missing_review_is_unresolved: true,
    model_agreement_is_not_dictionary_evidence: true
  },
  summary: countBy(adjudicated, (row) => row.decision),
  adjudicated
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
let approvedCount = null;
if (approvedOutPath) {
  const sourceReport = JSON.parse(fs.readFileSync(sourceReportPath, 'utf8'));
  if (!Array.isArray(sourceReport.selected)) throw new Error(`Source report has no selected array: ${sourceReportPath}`);
  const acceptedKeys = new Set(adjudicated.filter((row) => row.decision === 'consensus_accept').map(key));
  const selected = sourceReport.selected
    .filter((row) => acceptedKeys.has(key(row)))
    .map((row) => ({
      ...row,
      dual_source_review: adjudicated.find((item) => key(item) === key(row))
    }));
  approvedCount = selected.length;
  fs.mkdirSync(path.dirname(approvedOutPath), { recursive: true });
  fs.writeFileSync(approvedOutPath, `${JSON.stringify({
    ok: true,
    generated_at: new Date().toISOString(),
    source_report: relative(sourceReportPath),
    adjudication_report: relative(outPath),
    selected_count: selected.length,
    selected
  }, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify({ ok: true, out: relative(outPath), approved_out: approvedOutPath ? relative(approvedOutPath) : null, approved_count: approvedCount, summary: output.summary }, null, 2));

function readReviews(file) {
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(report.reviews)) throw new Error(`Review report has no reviews: ${file}`);
  return report.reviews;
}

function compact(row) {
  return {
    model: row.model ?? null,
    valid: row.valid === true,
    decision: row.decision ?? null,
    approved: row.approved === true,
    confidence: row.confidence ?? null,
    reason: row.reason ?? null,
    error: row.error ?? null
  };
}

function key(row) {
  return `${row.source_entry_id}:${row.source_sense_id ?? row.first_sense_id}`;
}

function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const value = selector(row);
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function requiredPath(value, name, mustExist = true) {
  if (!value) throw new Error(`Missing --${name}`);
  const resolved = path.resolve(String(value));
  if (mustExist && !fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  return resolved;
}

function relative(value) {
  return path.relative(process.cwd(), value);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      result[key] = next;
      index += 1;
    } else result[key] = 'true';
  }
  return result;
}
