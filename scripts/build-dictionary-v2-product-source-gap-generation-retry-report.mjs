#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const generationPath = requiredPath(args.generation, 'generation');
const outPath = path.resolve(required(args.out, 'out'));
const report = readJson(reportPath);
const generation = readJson(generationPath);
const candidates = new Map((report.selected || []).map((row) => [candidateKey(row), row]));
const selected = [];
const missing = [];

for (const generated of generation.generated || []) {
  if (generated?.valid === true) continue;
  const key = candidateKey(generated);
  const candidate = candidates.get(key);
  if (!candidate) {
    missing.push(key);
    continue;
  }
  const retry = structuredClone(candidate);
  retry.latest_errors = Array.isArray(generated.errors) ? generated.errors : [];
  retry.generation_retry = {
    prior_generation_report: path.relative(process.cwd(), generationPath),
    prior_endpoint: generated.endpoint || null,
    prior_errors: retry.latest_errors,
    publication_evidence: false
  };
  retry.promote_allowed = false;
  selected.push(retry);
}

const output = {
  ...report,
  generated_at: new Date().toISOString(),
  derived_from: path.relative(process.cwd(), reportPath),
  prior_generation_report: path.relative(process.cwd(), generationPath),
  selected_count: selected.length,
  selected,
  generation_retry: {
    invalid_rows: selected.length + missing.length,
    selected: selected.length,
    missing_candidates: missing.length,
    missing_candidate_keys: missing
  }
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: missing.length === 0, out: path.relative(process.cwd(), outPath), ...output.generation_retry }, null, 2));
if (missing.length) process.exitCode = 1;

function candidateKey(row) {
  const sourceEntryId = Number(row?.source_entry_id ?? row?.output?.source_entry_id);
  const sourceSenseId = Number(
    row?.first_sense_id ?? row?.source_sense_id ?? row?.output?.source_sense_id
  );
  return `${sourceEntryId}:${sourceSenseId}`;
}

function required(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return String(value);
}

function requiredPath(value, name) {
  const result = path.resolve(required(value, name));
  if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`);
  return result;
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
    if (next && !next.startsWith('--')) parsed[key] = argv[++index];
    else parsed[key] = 'true';
  }
  return parsed;
}
