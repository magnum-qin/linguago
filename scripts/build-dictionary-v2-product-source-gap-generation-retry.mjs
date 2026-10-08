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
const rejected = [];

for (const generated of generation.generated || []) {
  if (generated?.valid === true) continue;
  const key = candidateKey(generated);
  const candidate = candidates.get(key);
  if (!candidate) {
    rejected.push({ candidate_key: key, word: generated?.word, reason: 'candidate_not_found' });
    continue;
  }
  selected.push({
    ...candidate,
    latest_errors: [...new Set(generated.errors || [])],
    latest_ja_term: generated?.output?.localizations?.ja?.term || null,
    latest_ja_reading: generated?.output?.localizations?.ja?.reading || null,
    latest_zh_term: generated?.output?.localizations?.zh?.term || null,
    latest_zh_reading: generated?.output?.localizations?.zh?.reading || null,
    latest_en_term: generated?.output?.localizations?.en?.term || null,
    latest_pt_term: generated?.output?.localizations?.['pt-BR']?.term || null,
    latest_generation_endpoint: generated.endpoint || null,
    generation_retry: {
      source_report: relative(generationPath),
      previous_attempts: Number(generated.attempts || 1),
      automatic_promotion: false
    }
  });
}

const output = {
  ok: rejected.length === 0,
  generated_at: new Date().toISOString(),
  source_report: relative(reportPath),
  generation_report: relative(generationPath),
  policy: {
    retry_invalid_generation_only: true,
    preserve_exact_candidate_identity: true,
    automatic_promotion: false
  },
  summary: {
    candidates: candidates.size,
    invalid_generation_rows: selected.length + rejected.length,
    selected: selected.length,
    rejected: rejected.length,
    errors: countBy(selected.flatMap((row) => row.latest_errors))
  },
  selected_count: selected.length,
  selected,
  rejected
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: output.ok, out: relative(outPath), summary: output.summary }, null, 2));

function candidateKey(row) {
  const entryId = Number(row?.source_entry_id);
  const senseId = Number(row?.source_sense_id ?? row?.first_sense_id ?? row?.output?.source_sense_id);
  if (!Number.isInteger(entryId) || !Number.isInteger(senseId)) return null;
  return `${entryId}:${senseId}`;
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requiredPath(value, name) {
  const resolved = path.resolve(required(value, name));
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  return resolved;
}

function required(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return String(value);
}

function relative(value) {
  return path.relative(process.cwd(), value);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    parsed[token.slice(2)] = next && !next.startsWith('--') ? argv[++index] : true;
  }
  return parsed;
}
