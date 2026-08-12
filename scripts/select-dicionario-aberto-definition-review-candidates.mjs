#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const probePath = requiredPath(args.probe, 'probe');
const sourceReportPath = requiredPath(args['source-report'], 'source-report');
const attemptPath = requiredPath(args['attempt-index'], 'attempt-index');
const dbPath = requiredPath(args.db, 'db');
const outPath = path.resolve(required(args.out, 'out'));
const limit = positiveInteger(args.limit, 20);
const maxDefinitions = positiveInteger(args['max-definitions'], 1);
const excludePaths = csv(args['exclude-reviews']).map((value) => requiredPath(value, 'exclude-reviews'));
const eligibleReportPath = args['eligible-report']
  ? requiredPath(args['eligible-report'], 'eligible-report')
  : null;

const probe = readJson(probePath);
const sourceReport = readJson(sourceReportPath);
if (probe.research_only !== true || probe.production_publishable !== false) {
  throw new Error('Expected a research-only Dicionario Aberto probe');
}
const attempts = readJson(attemptPath).selected || [];
const attemptedEntries = new Set(attempts.map((row) => Number(row.source_entry_id)).filter(Number.isInteger));
const reviewedKeys = new Set();
const reviewedEntries = new Set();
for (const filePath of excludePaths) {
  const report = readJson(filePath);
  for (const row of report.reviews || report.review_candidates || report.selected || []) {
    if (row.candidate_key) {
      const key = String(row.candidate_key);
      reviewedKeys.add(key);
      const entryId = Number(key.split(':', 1)[0]);
      if (Number.isInteger(entryId)) reviewedEntries.add(entryId);
    }
    const entryId = Number(row.source_entry_id);
    if (Number.isInteger(entryId)) reviewedEntries.add(entryId);
  }
}
const eligibleKeys = eligibleReportPath
  ? new Set((readJson(eligibleReportPath).selected || []).map(candidateKey))
  : null;
const sourceRows = new Map((sourceReport.selected || []).map((row) => [candidateKey(row), row]));

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
db.pragma('query_only = ON');
const productEntryExists = db.prepare(`
  SELECT 1 FROM product_entries
  WHERE primary_lang = ? AND normalized_key = ?
  LIMIT 1
`);

const assessed = (probe.review_candidates || []).map((row) => assess(row));
const eligible = assessed
  .filter((row) => row.selection_eligibility.eligible)
  .sort(
    (left, right) =>
      Number(left.frequency_rank ?? Number.MAX_SAFE_INTEGER) -
        Number(right.frequency_rank ?? Number.MAX_SAFE_INTEGER) ||
      String(left.term).localeCompare(String(right.term), 'pt-BR') ||
      Number(left.source_entry_id) - Number(right.source_entry_id)
  );
const selected = [];
const selectedSourceRows = [];
const seenEntries = new Set();
const seenTerms = new Set();
for (const row of eligible) {
  const entryId = Number(row.source_entry_id);
  const term = normalize(row.term);
  if (seenEntries.has(entryId) || seenTerms.has(term)) continue;
  seenEntries.add(entryId);
  seenTerms.add(term);
  selected.push(row);
  const sourceRow = sourceRows.get(String(row.candidate_key));
  if (!sourceRow) throw new Error(`Candidate missing from source report: ${row.candidate_key}`);
  selectedSourceRows.push(sourceRow);
  if (selected.length >= limit) break;
}
db.close();

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  research_only: true,
  production_publishable: false,
  publication_evidence: false,
  source_report: relative(probePath),
  source_candidate_report: relative(sourceReportPath),
  eligible_report: eligibleReportPath ? relative(eligibleReportPath) : null,
  attempt_index: relative(attemptPath),
  product_db: relative(dbPath),
  excluded_review_reports: excludePaths.map(relative),
  selection_policy: {
    exact_source_headword: true,
    known_part_of_speech: true,
    maximum_dictionary_definitions: maxDefinitions,
    single_english_anchor: true,
    exclude_cross_reference_only_definitions: true,
    exclude_historical_attempt_entries: true,
    exclude_existing_product_entries: true,
    unique_source_entry_and_term: true,
    deterministic_eligible_report_required: Boolean(eligibleReportPath),
    downstream_dual_model_review_required: true
  },
  summary: {
    input_rows: assessed.length,
    eligible_rows: eligible.length,
    selected_rows: selected.length,
    attempted_entries: attemptedEntries.size,
    previously_reviewed_keys: reviewedKeys.size,
    previously_reviewed_entries: reviewedEntries.size,
    rejection_reasons: countReasons(assessed),
    selected_by_pos: countBy(selected, (row) => row.part_of_speech)
  },
  selected_count: selectedSourceRows.length,
  selected: selectedSourceRows,
  review_candidates: selected
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary: output.summary, words: selected.map((row) => row.term) }, null, 2));

function assess(row) {
  const reasons = [];
  const entryId = Number(row.source_entry_id);
  const definitions = Array.isArray(row.dicionario_aberto_definitions)
    ? row.dicionario_aberto_definitions
    : [];
  const usableDefinitions = definitions.filter((item) => {
    const value = String(item?.definition || '').trim();
    return value.length >= 12 && value.length <= 360 &&
      !/^(?:o mesmo que|feminino de|plural de|variante de|forma de)\b/iu.test(value);
  });
  const anchor = String(row.english_anchor || '').trim();
  const pos = normalizePos(row.part_of_speech);
  if (!Number.isInteger(entryId)) reasons.push('invalid_source_entry_id');
  if (attemptedEntries.has(entryId)) reasons.push('historical_attempt_entry');
  if (reviewedKeys.has(String(row.candidate_key || ''))) reasons.push('previously_reviewed');
  else if (reviewedEntries.has(entryId)) reasons.push('previously_reviewed_entry');
  if (eligibleKeys && !eligibleKeys.has(String(row.candidate_key || ''))) {
    reasons.push('not_in_deterministic_eligible_report');
  }
  if (!['noun', 'verb', 'adjective', 'adverb'].includes(pos)) reasons.push('unknown_part_of_speech');
  if (definitions.length < 1 || definitions.length > maxDefinitions) reasons.push('definition_count_out_of_range');
  if (!usableDefinitions.length) reasons.push('no_usable_definition');
  if (!anchor || /[;|/]/u.test(anchor) || /\b(?:or|and)\b/iu.test(anchor)) {
    reasons.push('non_single_english_anchor');
  }
  if (!/^[a-z][a-z '-]{1,60}$/iu.test(anchor)) reasons.push('invalid_english_anchor_shape');
  if (/^(?:thing|person|place|state|act|action|object|matter|quality|condition)$/iu.test(anchor)) {
    reasons.push('generic_english_anchor');
  }
  if (usableDefinitions.some((item) => looksProper(anchor, String(item.definition || '')))) {
    reasons.push('proper_or_encyclopedic');
  }
  if (productEntryExists.get(String(row.source_lang || ''), normalize(row.term))) {
    reasons.push('existing_product_entry');
  }
  return {
    ...row,
    part_of_speech: pos || row.part_of_speech,
    selection_eligibility: { eligible: reasons.length === 0, reasons }
  };
}

function looksProper(anchor, definition) {
  if (/\b(?:rei|rainha|príncipe|princesa|santo|cidade|rio|província|distrito)\b/iu.test(definition)) return true;
  return /^(?:saint|king|queen|prince|princess)\b/iu.test(anchor);
}

function normalizePos(value) {
  const text = String(value || '').normalize('NFKC').trim().toLowerCase();
  if (['n', 'noun', 'substantivo'].includes(text)) return 'noun';
  if (['v', 'verb', 'verbo'].includes(text)) return 'verb';
  if (['adj', 'adjective', 'adjetivo', 'adjectivo'].includes(text)) return 'adjective';
  if (['adv', 'adverb', 'advérbio', 'adverbio'].includes(text)) return 'adverb';
  return text;
}

function normalize(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('pt-BR').replace(/\s+/gu, ' ');
}

function candidateKey(row) {
  return String(row.candidate_key || `${row.source_entry_id}:${row.source_sense_id ?? row.first_sense_id}`);
}

function countReasons(rows) {
  return countBy(
    rows.flatMap((row) => row.selection_eligibility.reasons),
    (value) => value
  );
}

function countBy(rows, selector) {
  const counts = new Map();
  for (const row of rows) {
    const key = String(selector(row) || 'none');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
}

function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
function csv(value) { return String(value || '').split(',').map((item) => item.trim()).filter(Boolean); }
function required(value, name) { if (!value) throw new Error(`Missing --${name}`); return String(value); }
function requiredPath(value, name) { const result = path.resolve(required(value, name)); if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`); return result; }
function positiveInteger(value, fallback) { const parsed = Number(value ?? fallback); if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Invalid positive integer: ${value}`); return parsed; }
function relative(value) { return path.relative(process.cwd(), value); }
function parseArgs(argv) { const out = {}; for (let index = 0; index < argv.length; index += 1) { const token = argv[index]; if (!token.startsWith('--')) continue; const key = token.slice(2); const next = argv[index + 1]; out[key] = next && !next.startsWith('--') ? argv[++index] : true; } return out; }
