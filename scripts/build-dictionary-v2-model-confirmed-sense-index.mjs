#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = parseArgs(process.argv.slice(2));
const poolPath = requiredPath(args.pool, 'pool');
const revisedPath = requiredPath(args.revised, 'revised');
const firstReviewPath = requiredPath(args['first-review'], 'first-review');
const secondReviewPath = requiredPath(args['second-review'], 'second-review');
const alternateInputPath = args['alternate-input'] ? requiredPath(args['alternate-input'], 'alternate-input') : null;
const alternateFirstPath = args['alternate-first'] ? requiredPath(args['alternate-first'], 'alternate-first') : null;
const alternateSecondPath = args['alternate-second'] ? requiredPath(args['alternate-second'], 'alternate-second') : null;
const confirmedOutPath = path.resolve(args['confirmed-out'] || 'state/model-confirmed-primary-senses.json');
const attemptOutPath = path.resolve(args['attempt-out'] || 'state/model-reviewed-sense-attempts.json');

const key = (row) => `${Number(row.source_entry_id)}:${Number(row.source_sense_id ?? row.first_sense_id)}`;
const accepted = (review) =>
  review?.valid === true && review.approved === true &&
  review.decision === 'accept' && Number(review.confidence) >= 0.9 &&
  Array.isArray(review.risk_flags) && review.risk_flags.length === 0;

function indexReviews(report) {
  const map = new Map();
  for (const review of report.reviews || []) {
    if (map.has(key(review))) throw new Error(`Duplicate review ${key(review)}`);
    map.set(key(review), review);
  }
  return map;
}

const pool = readJson(poolPath);
const revised = readJson(revisedPath);
const first = indexReviews(readJson(firstReviewPath));
const second = indexReviews(readJson(secondReviewPath));
const alternateInput = alternateInputPath ? readJson(alternateInputPath) : { selected: [] };
const alternateFirst = alternateFirstPath ? indexReviews(readJson(alternateFirstPath)) : new Map();
const alternateSecond = alternateSecondPath ? indexReviews(readJson(alternateSecondPath)) : new Map();

const poolById = new Map((pool.selected || []).map((row) => [key(row), row]));
const poolByEntry = new Map((pool.selected || []).map((row) => [Number(row.source_entry_id), row]));
const confirmed = [];
const reviewedSenses = new Set();
const dualConsensus = new Set();

for (const row of revised.selected || []) {
  const rowKey = key(row);
  const unchanged = poolById.get(rowKey);
  const rebound = poolByEntry.get(Number(row.source_entry_id));
  if (!unchanged && !rebound) throw new Error(`Unbound revised row ${rowKey}`);
  if (unchanged && (unchanged.word !== row.word || unchanged.source_lang !== row.source_lang)) {
    throw new Error(`Identity mismatch ${rowKey}`);
  }
  if (!unchanged && rebound && (rebound.word !== row.word || rebound.source_lang !== row.source_lang)) {
    throw new Error(`Rebound identity mismatch ${rowKey}`);
  }
  const ra = first.get(rowKey);
  const rb = second.get(rowKey);
  for (const review of [ra, rb]) {
    if (review && (review.word !== row.word || review.gloss_key !== row.gloss_key || review.source_lang !== row.source_lang)) {
      throw new Error(`Unbound review ${rowKey}`);
    }
  }
  if (accepted(ra) && accepted(rb)) {
    dualConsensus.add(rowKey);
    confirmed.push({
      source_entry_id: Number(row.source_entry_id),
      source_sense_id: Number(row.first_sense_id),
      word: row.word,
      source_lang: row.source_lang,
      gloss_key: row.gloss_key
    });
  }
}

for (const row of pool.selected || []) reviewedSenses.add(key(row));
for (const row of alternateInput.selected || []) {
  const rowKey = key(row);
  reviewedSenses.add(rowKey);
  const ra = alternateFirst.get(rowKey);
  const rb = alternateSecond.get(rowKey);
  if (accepted(ra) && accepted(rb)) dualConsensus.add(rowKey);
}

const attempted = [...reviewedSenses]
  .filter((k) => !dualConsensus.has(k))
  .map((k) => {
    const [entry, sense] = k.split(':');
    return { source_entry_id: Number(entry), source_sense_id: Number(sense) };
  })
  .sort((l, r) => l.source_entry_id - r.source_entry_id || l.source_sense_id - r.source_sense_id);

const inputs = [poolPath, revisedPath, firstReviewPath, secondReviewPath];
if (alternateInputPath) inputs.push(alternateInputPath, alternateFirstPath, alternateSecondPath);
const inputSha = Object.fromEntries(inputs.map((p) => [p, crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));

const confirmedOutput = {
  ok: true,
  generated_at: new Date().toISOString(),
  purpose: 'model_confirmed_primary_sense_pin_not_publication',
  automatic_publication: false,
  policy: { dual_model_accept_required: true, minimum_confidence: 0.9, risk_flags_must_be_empty: true },
  summary: { confirmed_senses: confirmed.length },
  input_sha256: inputSha,
  selected: confirmed
};
const attemptOutput = {
  ok: true,
  generated_at: new Date().toISOString(),
  purpose: 'reviewed_non_consensus_senses_are_spent_attempts',
  policy: { reviewed_senses_are_attempts: true, dual_consensus_senses_are_pinned_not_spent: true },
  summary: { attempted_source_senses: attempted.length },
  input_sha256: inputSha,
  selected: attempted
};

writeJson(confirmedOutPath, confirmedOutput);
writeJson(attemptOutPath, attemptOutput);
console.log(JSON.stringify({ ok: true, confirmed_out: path.relative(process.cwd(), confirmedOutPath), attempt_out: path.relative(process.cwd(), attemptOutPath), confirmed: confirmed.length, attempted: attempted.length }));

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const filePath = path.resolve(value);
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return filePath;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    result[token.slice(2)] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return result;
}
