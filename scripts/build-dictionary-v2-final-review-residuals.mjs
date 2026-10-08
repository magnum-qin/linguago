#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const generationPath = requiredPath(args.generation, 'generation');
const reversePath = requiredPath(args.reverse, 'reverse');
const reviewPaths = csv(args.reviews).map((value) => requiredPath(value, 'reviews'));
const outPath = path.resolve(args.out || 'state/dictionary-final-review-residuals.json');
if (!reviewPaths.length) throw new Error('Missing --reviews');

const generation = readJson(generationPath);
const reverse = readJson(reversePath);
const latestReviews = new Map();
for (const reviewPath of reviewPaths) {
  for (const row of readJson(reviewPath).reviews || []) latestReviews.set(candidateKey(row), row);
}

const residuals = new Map();
for (const row of generation.generated || []) {
  if (row?.valid === true) continue;
  add(row, 'invalid_generation', row.errors || []);
}
for (const row of reverse.validations || []) {
  if (row?.decision === 'supported') continue;
  add(row, `reverse_${row?.decision || 'unknown'}`, [row.reason].filter(Boolean));
}
for (const row of latestReviews.values()) {
  if (row?.consensus_accepted === true) continue;
  add(row, `final_review_${row?.decision || 'unknown'}`, [row.reason].filter(Boolean));
}

const selected = [...residuals.values()].sort(
  (left, right) => left.source_entry_id - right.source_entry_id || left.source_sense_id - right.source_sense_id
);
const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_generation: relative(generationPath),
  source_reverse: relative(reversePath),
  source_reviews: reviewPaths.map(relative),
  policy: {
    exact_source_sense_identity: true,
    later_review_decision_wins: true,
    automatic_retry: false,
    automatic_publication: false
  },
  summary: {
    selected: selected.length,
    by_reason: countBy(selected.flatMap((row) => row.residual_reasons))
  },
  selected_count: selected.length,
  selected
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary: output.summary }, null, 2));

function add(row, reason, details) {
  const key = candidateKey(row);
  if (!key) throw new Error(`Residual row lacks exact identity: ${JSON.stringify(row).slice(0, 240)}`);
  const current = residuals.get(key) || {
    source_entry_id: Number(row.source_entry_id ?? row.output?.source_entry_id),
    source_sense_id: Number(row.source_sense_id ?? row.output?.source_sense_id),
    word: row.word ?? row.output?.source_word ?? null,
    source_lang: row.source_lang ?? row.output?.primary_lang ?? null,
    residual_reasons: [],
    details: []
  };
  if (!current.residual_reasons.includes(reason)) current.residual_reasons.push(reason);
  for (const detail of details) {
    const value = String(detail || '').trim();
    if (value && !current.details.includes(value)) current.details.push(value);
  }
  residuals.set(key, current);
}

function candidateKey(row) {
  const entryId = Number(row?.source_entry_id ?? row?.output?.source_entry_id);
  const senseId = Number(row?.source_sense_id ?? row?.output?.source_sense_id);
  return Number.isInteger(entryId) && Number.isInteger(senseId) ? `${entryId}:${senseId}` : null;
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function csv(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const filePath = path.resolve(value);
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return filePath;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function relative(filePath) {
  return path.relative(process.cwd(), filePath);
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
