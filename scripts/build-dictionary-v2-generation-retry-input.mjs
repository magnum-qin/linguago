#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const candidatePath = requiredPath(args.candidates, '--candidates');
const generationPath = requiredPath(args.generation, '--generation');
const validationPath = requiredPath(args.validation, '--validation');
const outPath = path.resolve(args.out || 'logs/product-source-gap-generation-retry-input.json');
const retryableErrorPrefixes = String(args['retryable-error-prefixes'] || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const candidateReport = readJson(candidatePath);
const generationReport = readJson(generationPath);
const validationReport = readJson(validationPath);
const candidates = candidateReport.selected || candidateReport.candidates || [];
const generated = generationReport.generated || [];
const replayed = validationReport.replayed || [];
if (!Array.isArray(candidates) || !Array.isArray(generated) || !Array.isArray(replayed)) {
  throw new Error('Expected candidates.selected, generation.generated, and validation.replayed arrays.');
}

const candidatesByKey = new Map(candidates.map((row) => [candidateKey(row), row]));
const candidatesByEntry = uniqueCandidatesByEntry(candidates);
const replayedByKey = new Map(replayed.map((item) => [candidateKey(item), item]));
const retryRows = [];
const missingCandidates = [];
let skippedNonretryable = 0;

for (const item of generated) {
  const exactKey = candidateKey(item, true);
  const candidate = exactKey
    ? candidatesByKey.get(exactKey)
    : candidatesByEntry.get(String(Number(item?.source_entry_id)));
  const key = exactKey || (candidate ? candidateKey(candidate) : `entry:${item?.source_entry_id}`);
  const validation = replayedByKey.get(key);
  if (validation?.valid === true) continue;
  if (!candidate) {
    missingCandidates.push(key);
    continue;
  }
  const latest = validation || item;
  const latestErrors = Array.isArray(latest?.errors) ? latest.errors : ['missing_replay_output'];
  if (
    retryableErrorPrefixes.length &&
    !latestErrors.some((error) => retryableErrorPrefixes.some((prefix) => String(error).startsWith(prefix)))
  ) {
    skippedNonretryable++;
    continue;
  }
  retryRows.push({
    ...candidate,
    latest_errors: latestErrors,
    latest_ja_term: latest?.output?.localizations?.ja?.term || null,
    latest_zh_term: latest?.output?.localizations?.zh?.term || null,
    retry_origin: {
      generation: path.relative(process.cwd(), generationPath),
      validation: path.relative(process.cwd(), validationPath),
      previous_valid: item?.valid === true,
      replay_matched: Boolean(validation)
    }
  });
}

const result = {
  generated_at: new Date().toISOString(),
  derived_from: {
    candidates: path.relative(process.cwd(), candidatePath),
    generation: path.relative(process.cwd(), generationPath),
    validation: path.relative(process.cwd(), validationPath)
  },
  stats: {
    candidates: candidates.length,
    generated: generated.length,
    replayed: replayed.length,
    replay_valid: replayed.filter((item) => item?.valid === true).length,
    retry: retryRows.length,
    skipped_nonretryable: skippedNonretryable,
    missing_candidates: missingCandidates.length
  },
  missing_candidates: missingCandidates,
  selected: retryRows
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: missingCandidates.length === 0, out: outPath, stats: result.stats }, null, 2));

function candidateKey(value, allowMissingSense = false) {
  const entryId = Number(value?.source_entry_id ?? value?.output?.source_entry_id);
  const senseId = Number(value?.source_sense_id ?? value?.first_sense_id ?? value?.output?.source_sense_id);
  if (Number.isInteger(entryId) && allowMissingSense && !Number.isInteger(senseId)) return null;
  if (!Number.isInteger(entryId) || !Number.isInteger(senseId)) {
    throw new Error(`Candidate lacks exact source identity: ${JSON.stringify(value)}`);
  }
  return `${entryId}:${senseId}`;
}

function uniqueCandidatesByEntry(rows) {
  const result = new Map();
  const ambiguous = new Set();
  for (const row of rows) {
    const entryId = String(Number(row?.source_entry_id));
    if (result.has(entryId)) {
      result.delete(entryId);
      ambiguous.add(entryId);
    } else if (!ambiguous.has(entryId)) {
      result.set(entryId, row);
    }
  }
  return result;
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing ${name}`);
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) throw new Error(`File not found for ${name}: ${resolved}`);
  return resolved;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    result[key] = next && !next.startsWith('--') ? argv[++index] : true;
  }
  return result;
}
