#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPaths = requiredPaths(args.reports, 'reports');
const outPath = path.resolve(required(args.out, 'out'));
const requiredLangs = String(args.langs || 'en,pt-BR,zh,ja')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const limit = Number(args.limit || Number.MAX_SAFE_INTEGER);
if (!Number.isInteger(limit) || limit < 1) throw new Error(`Invalid --limit: ${args.limit}`);

const selectedByKey = new Map();
const sourceReports = [];
for (const reportPath of reportPaths) {
  const report = readJson(reportPath);
  sourceReports.push(path.relative(process.cwd(), reportPath));
  for (const row of report.selected || []) {
    const key = candidateKey(row);
    const review = row?.candidate_evidence_review;
    if (!key || review?.decision !== 'accept' || Number(review?.confidence) < 0.9) continue;
    const preferredTerms = review.preferred_terms || {};
    if (!requiredLangs.every((lang) => String(preferredTerms[lang] || '').trim())) continue;
    if (!selectedByKey.has(key)) selectedByKey.set(key, row);
  }
}

const selected = [...selectedByKey.values()]
  .sort((left, right) => Number(left.frequency_rank ?? Infinity) - Number(right.frequency_rank ?? Infinity))
  .slice(0, limit);
const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_reports: sourceReports,
  selected_count: selected.length,
  selected,
  filter_policy: {
    exact_candidate_key: true,
    review_decision: 'accept',
    minimum_confidence: 0.9,
    required_preferred_term_langs: requiredLangs,
    limit
  }
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(
  JSON.stringify(
    {
      ok: true,
      out: path.relative(process.cwd(), outPath),
      selected: selected.length,
      by_lang: Object.fromEntries(
        [...new Set(selected.map((row) => row.source_lang))].map((lang) => [
          lang,
          selected.filter((row) => row.source_lang === lang).length
        ])
      )
    },
    null,
    2
  )
);

function candidateKey(row) {
  if (/^\d+:\d+$/.test(String(row?.candidate_key || ''))) return String(row.candidate_key);
  const entryId = Number(row?.source_entry_id);
  const senseId = Number(row?.source_sense_id ?? row?.output?.source_sense_id ?? row?.first_sense_id);
  if (!Number.isInteger(entryId) || !Number.isInteger(senseId)) return null;
  return `${entryId}:${senseId}`;
}

function required(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return String(value);
}

function requiredPaths(value, name) {
  return required(value, name)
    .split(',')
    .map((item) => path.resolve(item.trim()))
    .filter((item) => {
      if (!fs.existsSync(item)) throw new Error(`${name} not found: ${item}`);
      return true;
    });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
