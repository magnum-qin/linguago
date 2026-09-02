#!/usr/bin/env node

import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const poolPath = requiredPath(args.pool, 'pool');
const outPath = path.resolve(args.out || 'logs/product-source-gap-fresh-cohort.json');
const limit = positiveInteger(args.limit, 20);
const sourceLangQuotas = parseQuotas(args['source-lang-quotas']);
const requiredHintSource = normalize(args['require-generation-hint-source']);
const onePerSourceEntry = args['one-per-source-entry'] === 'true';
const excludeSourceEntries = args['exclude-source-entries'] === 'true';
const maxGenerationHintTerms = nonNegativeInteger(
  args['max-generation-hint-terms'],
  0
);
const requireAllHintLanguages = args['require-all-hint-languages'] === 'true';
const productDbPath = path.resolve(
  args['product-db'] || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db'
);
const excludePaths = String(args.exclude || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => requiredPath(value, 'exclude'));
const attemptIndexPath = args['attempt-index'] ? requiredPath(args['attempt-index'], 'attempt-index') : null;
const attemptIndexEntryLevel = args['attempt-index-entry-level'] === 'true';
const attemptIndexMaxEntryAttempts = nonNegativeInteger(args['attempt-index-max-entry-attempts'], 0);

const pool = readJson(poolPath);
const rows = candidateRows(pool);
const excluded = new Set();
const excludedSourceEntryIds = new Set();
const attempted = new Set();
const attemptedEntryCounts = new Map();
for (const reportPath of excludePaths) {
  for (const row of candidateRows(readJson(reportPath))) {
    excluded.add(candidateKey(row));
    if (excludeSourceEntries) {
      const sourceEntryId = Number(row?.source_entry_id);
      if (Number.isInteger(sourceEntryId)) excludedSourceEntryIds.add(sourceEntryId);
    }
  }
}
if (attemptIndexPath) {
  for (const row of candidateRows(readJson(attemptIndexPath))) {
    const entryId = Number(row?.source_entry_id);
    const senseId = Number(row?.source_sense_id);
    if (!Number.isInteger(entryId)) continue;
    attemptedEntryCounts.set(entryId, (attemptedEntryCounts.get(entryId) || 0) + 1);
    if (attemptIndexEntryLevel) attempted.add(`${entryId}:*`);
    attempted.add(`${entryId}:${Number.isInteger(senseId) && senseId > 0 ? senseId : '*'}`);
  }
}

const selected = [];
const selectedBySourceLang = new Map();
const seen = new Set();
const seenSourceEntries = new Set();
const productDb = new Database(productDbPath, { readonly: true });
const linkedProductSense = productDb.prepare(`
  SELECT ps.id
  FROM product_sense_source_links link
  JOIN product_senses ps ON ps.id = link.product_sense_id
  WHERE link.source_sense_id = ?
    AND ps.status IN ('accepted', 'draft_single_source')
  LIMIT 1
`);
const completeProductSense = productDb.prepare(`
  SELECT ps.id
  FROM product_entries pe
  JOIN product_senses ps ON ps.product_entry_id = pe.id
  JOIN product_localizations pl ON pl.product_sense_id = ps.id
  WHERE pe.group_key = ?
    AND ps.gloss_key = ?
    AND ps.status = 'accepted'
    AND COALESCE(pl.needs_review, 0) = 0
  GROUP BY ps.id
  HAVING COUNT(DISTINCT pl.lang) = 4
  LIMIT 1
`);
const acceptedLocalizationRows = productDb.prepare(`
  SELECT pl.product_sense_id, pl.lang, pl.term
  FROM product_localizations pl
  JOIN product_senses ps ON ps.id = pl.product_sense_id
  WHERE ps.status IN ('accepted', 'draft_single_source')
`).all();
const acceptedSensesByTerm = buildAcceptedSenseTermIndex(acceptedLocalizationRows);
let excludedByProduct = 0;
let excludedBySemanticDuplicate = 0;
let excludedByRequiredHintSource = 0;
let excludedBySourceEntryDeduplication = 0;
let excludedByHistoricalAttempt = 0;
let excludedByGenerationHintAmbiguity = 0;
for (const row of rows) {
  const sourceLang = String(row?.source_lang || '');
  if (sourceLangQuotas.size > 0) {
    const quota = sourceLangQuotas.get(sourceLang) || 0;
    if ((selectedBySourceLang.get(sourceLang) || 0) >= quota) continue;
  }
  const key = candidateKey(row);
  if (excluded.has(key) || seen.has(key)) continue;
  const sourceEntryId = Number(row?.source_entry_id);
  const sourceSenseId = Number(row?.first_sense_id ?? row?.source_sense_id);
  if (
    attemptIndexMaxEntryAttempts > 0 &&
    (attemptedEntryCounts.get(sourceEntryId) || 0) >= attemptIndexMaxEntryAttempts
  ) {
    excludedByHistoricalAttempt += 1;
    continue;
  }
  if (
    attempted.has(`${sourceEntryId}:*`) ||
    (Number.isInteger(sourceSenseId) && attempted.has(`${sourceEntryId}:${sourceSenseId}`))
  ) {
    excludedByHistoricalAttempt += 1;
    continue;
  }
  if (excludeSourceEntries && excludedSourceEntryIds.has(sourceEntryId)) continue;
  if (requiredHintSource && !hasGenerationHintSource(row, requiredHintSource)) {
    excludedByRequiredHintSource += 1;
    continue;
  }
  if (!generationHintsMeetLimit(row, maxGenerationHintTerms, requireAllHintLanguages)) {
    excludedByGenerationHintAmbiguity += 1;
    continue;
  }
  if (onePerSourceEntry && seenSourceEntries.has(sourceEntryId)) {
    excludedBySourceEntryDeduplication += 1;
    continue;
  }
  if (Number.isInteger(sourceSenseId) && sourceSenseId > 0 && linkedProductSense.get(sourceSenseId)) {
    excludedByProduct += 1;
    continue;
  }
  const groupKey = `source-gap:${row.source_lang}:${normalize(row.normalized_key || row.word)}`;
  const glossKey = row.first_gloss_key || row.first_gloss_preview || row.gloss_key || row.gloss_preview || '';
  if (glossKey && completeProductSense.get(groupKey, glossKey)) {
    excludedByProduct += 1;
    continue;
  }
  if (findAcceptedSemanticDuplicate(row, acceptedSensesByTerm)) {
    excludedBySemanticDuplicate += 1;
    continue;
  }
  selected.push(row);
  selectedBySourceLang.set(sourceLang, (selectedBySourceLang.get(sourceLang) || 0) + 1);
  seen.add(key);
  if (onePerSourceEntry) seenSourceEntries.add(sourceEntryId);
  if (selected.length >= limit) break;
}
productDb.close();

const output = {
  ok: selected.length === limit,
  generated_at: new Date().toISOString(),
  pool: relative(poolPath),
  pool_sha256: sha256(poolPath),
  excluded_reports: excludePaths.map((filePath) => ({ path: relative(filePath), sha256: sha256(filePath) })),
  summary: {
    requested: limit,
    selected: selected.length,
    excluded_candidates: excluded.size,
    excluded_by_product: excludedByProduct,
    excluded_by_semantic_duplicate: excludedBySemanticDuplicate,
    excluded_by_required_hint_source: excludedByRequiredHintSource,
    excluded_by_source_entry_deduplication: excludedBySourceEntryDeduplication,
    excluded_by_historical_attempt: excludedByHistoricalAttempt,
    excluded_by_generation_hint_ambiguity: excludedByGenerationHintAmbiguity,
    excluded_source_entry_count: excludedSourceEntryIds.size,
    required_generation_hint_source: requiredHintSource || null,
    one_per_source_entry: onePerSourceEntry,
    exclude_source_entries: excludeSourceEntries,
    max_generation_hint_terms: maxGenerationHintTerms || null,
    require_all_hint_languages: requireAllHintLanguages,
    source_lang_quotas: Object.fromEntries(sourceLangQuotas),
    attempt_index: attemptIndexPath ? relative(attemptIndexPath) : null,
    attempt_index_entry_level: attemptIndexEntryLevel,
    attempt_index_max_entry_attempts: attemptIndexMaxEntryAttempts || null,
    selected_by_source_lang: countBy(selected, (row) => row.source_lang),
    selected_by_lane: countBy(selected, (row) => row.scale_review_lane)
  },
  selected_count: selected.length,
  selected
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: output.ok, out: relative(outPath), summary: output.summary }, null, 2));
if (!output.ok) process.exitCode = 1;

function candidateRows(report) {
  for (const key of ['selected', 'candidates', 'rows', 'reviews', 'generated']) {
    if (Array.isArray(report?.[key])) return report[key];
  }
  return [];
}

function candidateKey(row) {
  const sourceSenseId = Number(row?.first_sense_id ?? row?.source_sense_id);
  return `${Number(row?.source_entry_id)}:${Number.isInteger(sourceSenseId) && sourceSenseId > 0 ? sourceSenseId : '*'}`;
}

function countBy(rowsToCount, selector) {
  const counts = {};
  for (const row of rowsToCount) {
    const key = String(selector(row) || 'unknown');
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function parseQuotas(value) {
  const quotas = new Map();
  for (const part of String(value || '').split(',').map((item) => item.trim()).filter(Boolean)) {
    const separator = part.indexOf('=');
    if (separator < 1) throw new Error(`Invalid source-lang quota: ${part}`);
    const lang = part.slice(0, separator).trim();
    const quota = Number(part.slice(separator + 1));
    if (!lang || !Number.isInteger(quota) || quota < 0) throw new Error(`Invalid source-lang quota: ${part}`);
    quotas.set(lang, quota);
  }
  return quotas;
}

function normalize(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase();
}

function hasGenerationHintSource(row, requiredSource) {
  return Object.values(row?.generation_hints || {}).some((hint) =>
    (Array.isArray(hint?.sources) ? hint.sources : []).some((source) =>
      normalize(source).includes(requiredSource)
    )
  );
}

function generationHintsMeetLimit(row, maximumTerms, requireAllLanguages) {
  if (!maximumTerms && !requireAllLanguages) return true;
  const hints = row?.generation_hints || {};
  for (const lang of ['en', 'pt-BR', 'zh', 'ja']) {
    const terms = Array.isArray(hints[lang]?.terms)
      ? hints[lang].terms.filter((term) => String(term || '').trim())
      : [];
    if (requireAllLanguages && terms.length === 0) return false;
    if (maximumTerms && terms.length > maximumTerms) return false;
  }
  return true;
}

function buildAcceptedSenseTermIndex(rowsToIndex) {
  const bySense = new Map();
  for (const row of rowsToIndex) {
    if (!bySense.has(row.product_sense_id)) bySense.set(row.product_sense_id, new Map());
    const byLang = bySense.get(row.product_sense_id);
    if (!byLang.has(row.lang)) byLang.set(row.lang, new Set());
    byLang.get(row.lang).add(normalize(row.term));
  }
  const byTerm = new Map();
  for (const [senseId, byLang] of bySense) {
    for (const [lang, terms] of byLang) {
      for (const term of terms) {
        const key = `${lang}:${term}`;
        if (!byTerm.has(key)) byTerm.set(key, []);
        byTerm.get(key).push({ senseId, byLang });
      }
    }
  }
  return byTerm;
}

function findAcceptedSemanticDuplicate(row, index) {
  const sourceLang = row?.source_lang;
  const sourceTerm = normalize(row?.word);
  if (!sourceLang || !sourceTerm) return null;
  const candidates = index.get(`${sourceLang}:${sourceTerm}`) || [];
  const hints = row?.generation_hints || {};
  for (const candidate of candidates) {
    let otherLanguageMatches = 0;
    for (const [lang, hint] of Object.entries(hints)) {
      if (lang === sourceLang) continue;
      const existing = candidate.byLang.get(lang);
      if (!existing) continue;
      const terms = Array.isArray(hint?.terms) ? hint.terms : [];
      if (terms.some((term) => existing.has(normalize(term)))) otherLanguageMatches += 1;
    }
    if (otherLanguageMatches >= 2) return candidate.senseId;
  }
  return null;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index++) {
    const token = values[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = values[index + 1];
    parsed[key] = next && !next.startsWith('--') ? values[++index] : 'true';
  }
  return parsed;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? fallback, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Invalid positive integer: ${value}`);
  return parsed;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
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

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function relative(filePath) {
  return path.relative(process.cwd(), filePath);
}
