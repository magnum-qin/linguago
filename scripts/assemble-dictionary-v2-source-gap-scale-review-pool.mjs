#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const productionPath = requiredPath(args.production, 'production');
const reviewPath = requiredPath(args.review, 'review');
const upgradePath = requiredPath(args.upgrade, 'upgrade');
const outPath = path.resolve(args.out || 'logs/product-source-gap-scale-review-pool.json');
const quotas = parseQuotas(args.quotas || 'production=10,multi_hint=7,evidence_upgrade=3');
const uniqueEntry = args['unique-entry'] !== 'false';

const production = readJson(productionPath).selected || [];
const review = readJson(reviewPath).selected || [];
const upgrades = readJson(upgradePath).selected || [];
const productionKeys = new Set(production.map(candidateKey));
const lanes = {
  production: production.map((row) => tagged(row, 'production')),
  multi_hint: review
    .filter((row) => !productionKeys.has(candidateKey(row)))
    .map((row) => tagged(row, 'multi_hint')),
  evidence_upgrade: upgrades.map((row) => tagged(row, 'evidence_upgrade'))
};
for (const rows of Object.values(lanes)) rows.sort(compareRows);

const selected = [];
const seenCandidates = new Set();
const seenEntries = new Set();
for (const lane of ['production', 'multi_hint', 'evidence_upgrade']) {
  const quota = quotas[lane] || 0;
  let added = 0;
  for (const row of lanes[lane]) {
    const key = candidateKey(row);
    const entryKey = String(row.source_entry_id);
    if (seenCandidates.has(key) || (uniqueEntry && seenEntries.has(entryKey))) continue;
    selected.push(row);
    seenCandidates.add(key);
    seenEntries.add(entryKey);
    added += 1;
    if (added >= quota) break;
  }
}

const requested = Object.values(quotas).reduce((sum, value) => sum + value, 0);
const output = {
  ok: selected.length === requested,
  generated_at: new Date().toISOString(),
  sources: {
    production: relative(productionPath),
    review: relative(reviewPath),
    evidence_upgrade: relative(upgradePath)
  },
  policy: {
    unique_entry: uniqueEntry,
    production_lane_requires_full_pipeline_revalidation: true,
    multi_hint_lane_requires_per_language_selection: true,
    evidence_upgrade_lane_requires_dual_model_revalidation: true,
    automatic_publication: false
  },
  summary: {
    requested,
    selected: selected.length,
    quotas,
    available: Object.fromEntries(
      Object.entries(lanes).map(([lane, rows]) => [lane, rows.length])
    ),
    selected_by_lane: countBy(selected, (row) => row.scale_review_lane),
    selected_by_source_lang: countBy(selected, (row) => row.source_lang),
    unique_entries: seenEntries.size
  },
  selected_count: selected.length,
  selected
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: output.ok, out: relative(outPath), summary: output.summary }, null, 2));
if (!output.ok) process.exitCode = 1;

function tagged(row, lane) {
  return { ...row, scale_review_lane: lane };
}

function candidateKey(row) {
  return `${Number(row.source_entry_id)}:${Number(row.first_sense_id ?? row.source_sense_id)}`;
}

function compareRows(left, right) {
  return (
    Number(left.frequency_rank || Number.MAX_SAFE_INTEGER) -
      Number(right.frequency_rank || Number.MAX_SAFE_INTEGER) ||
    candidateKey(left).localeCompare(candidateKey(right))
  );
}

function parseQuotas(value) {
  const result = { production: 0, multi_hint: 0, evidence_upgrade: 0 };
  for (const item of String(value).split(',')) {
    const [lane, raw] = item.split('=');
    if (!Object.hasOwn(result, lane)) throw new Error(`Unknown quota lane: ${lane}`);
    const count = Number.parseInt(raw, 10);
    if (!Number.isInteger(count) || count < 0) throw new Error(`Invalid quota: ${item}`);
    result[lane] = count;
  }
  return result;
}

function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = String(selector(row) || 'unknown');
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const filePath = path.resolve(value);
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return filePath;
}

function relative(filePath) {
  return path.relative(process.cwd(), filePath);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return parsed;
}
