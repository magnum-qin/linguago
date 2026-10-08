#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const poolPath = requiredPath(args.pool, 'pool');
const reviewPath = requiredPath(args.review, 'review');
if (!args.out) throw new Error('Missing --out');
const outPath = path.resolve(String(args.out));
const pool = readJson(poolPath);
const review = readJson(reviewPath);

const candidates = new Map((pool.selected || []).map((row) => [key(row), row]));
const reviews = [];
for (const row of review.reviews || []) {
  const candidate = candidates.get(key(row));
  if (!candidate) continue;
  for (const field of ['word', 'source_lang', 'gloss_key']) {
    if (candidate[field] !== row[field]) {
      throw new Error(`Review binding mismatch for ${key(row)} field ${field}`);
    }
  }
  reviews.push(row);
}

const reviewedKeys = new Set(reviews.map(key));
const missing = [...candidates.keys()].filter((candidateKey) => !reviewedKeys.has(candidateKey));
if (missing.length) {
  throw new Error(`Review is missing ${missing.length} pool candidates: ${missing.slice(0, 10).join(', ')}`);
}

const output = {
  ...review,
  generated_at: new Date().toISOString(),
  report: path.relative(process.cwd(), poolPath),
  filtered_from: path.relative(process.cwd(), reviewPath),
  summary: summarize(reviews),
  reviews
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2));

function summarize(rows) {
  return {
    reviewed: rows.length,
    valid: rows.filter((row) => row?.valid === true).length,
    approved: rows.filter((row) => row?.decision === 'accept' && row?.approved === true).length,
    rejected: rows.filter((row) => row?.decision === 'reject').length,
    manual_review: rows.filter((row) => row?.decision === 'manual_review').length
  };
}

function key(row) {
  const entryId = Number(row?.source_entry_id);
  const senseId = Number(row?.source_sense_id ?? row?.first_sense_id);
  if (!Number.isInteger(entryId) || !Number.isInteger(senseId)) {
    throw new Error('Candidate or review lacks exact source identity');
  }
  return `${entryId}:${senseId}`;
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const filePath = path.resolve(String(value));
  if (!fs.existsSync(filePath) && name !== 'out') throw new Error(`File not found: ${filePath}`);
  return filePath;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const name = argv[index].slice(2);
    const next = argv[index + 1];
    parsed[name] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return parsed;
}
