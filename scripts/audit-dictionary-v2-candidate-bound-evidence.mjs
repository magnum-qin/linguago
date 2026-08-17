#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const databasePath = requiredPath(args['supplemental-source-db'], 'supplemental-source-db');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const validations = Array.isArray(report.validations) ? report.validations : [];
const database = new Database(databasePath, { readonly: true, fileMustExist: true });
const rows = database.prepare(`
  SELECT DISTINCT source_key, concept_id
  FROM lexical_evidence
  WHERE concept_id LIKE 'candidate:%'
`).all();
database.close();

const candidatesBySource = new Map();
for (const row of rows) {
  const candidate = String(row.concept_id).slice('candidate:'.length);
  if (!candidatesBySource.has(row.source_key)) candidatesBySource.set(row.source_key, new Set());
  candidatesBySource.get(row.source_key).add(candidate);
}

const violations = [];
for (const validation of validations) {
  const key = candidateKey(validation);
  const usedSources = collectStrings(validation).filter((value) => candidatesBySource.has(value));
  for (const source of new Set(usedSources)) {
    if (!candidatesBySource.get(source).has(key)) {
      violations.push({
        candidate_key: key,
        source_entry_id: validation.source_entry_id,
        source_sense_id: validation.source_sense_id,
        source_key: source,
        allowed_candidate_keys: [...candidatesBySource.get(source)].sort(),
        decision: validation.decision
      });
    }
  }
  for (const evidence of collectEvidenceRows(validation)) {
    const match = /^candidate:(.+)$/u.exec(String(evidence.concept_id || ''));
    if (match && match[1] !== key) {
      violations.push({
        candidate_key: key,
        source_entry_id: validation.source_entry_id,
        source_sense_id: validation.source_sense_id,
        source_key: evidence.source || null,
        concept_id: evidence.concept_id,
        decision: validation.decision
      });
    }
  }
}

const output = {
  ok: violations.length === 0,
  report: path.relative(process.cwd(), reportPath),
  supplemental_source_db: path.relative(process.cwd(), databasePath),
  candidate_bound_sources: candidatesBySource.size,
  candidate_bound_rows: rows.length,
  validations: validations.length,
  violations
};
console.log(JSON.stringify(output, null, 2));
if (!output.ok) process.exitCode = 1;

function collectStrings(value, result = []) {
  if (typeof value === 'string') result.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, result);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) collectStrings(item, result);
  return result;
}

function collectEvidenceRows(value, result = []) {
  if (Array.isArray(value)) for (const item of value) collectEvidenceRows(item, result);
  else if (value && typeof value === 'object') {
    if ('concept_id' in value && ('source' in value || 'source_key' in value)) result.push(value);
    for (const item of Object.values(value)) collectEvidenceRows(item, result);
  }
  return result;
}

function candidateKey(row) {
  const entryId = Number(row?.source_entry_id);
  const senseId = Number(row?.source_sense_id ?? row?.first_sense_id);
  return `${entryId}:${Number.isInteger(senseId) && senseId > 0 ? senseId : '*'}`;
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const filePath = path.resolve(value);
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return filePath;
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
