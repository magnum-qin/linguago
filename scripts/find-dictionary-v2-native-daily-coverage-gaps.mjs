#!/usr/bin/env node

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const sourceDbPath = path.resolve(
  args['source-db'] || 'data/processed/linguago_v2_full.db'
);
const productDbPath = path.resolve(
  args['product-db'] || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db'
);
const outPath = path.resolve(args.out || 'logs/product-native-daily-coverage-gaps.json');
const maxRank = positiveInteger(args['max-rank'], 200_000);
const scanLimit = positiveInteger(args['scan-limit'], 100_000);
const targets = parseTargets(args.targets || 'zh=300,ja=100,pt-BR=50,en=50');
const excludedCandidateIds = loadExcludedCandidateIds(args['exclude-reports']);

for (const dbPath of [sourceDbPath, productDbPath]) {
  if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
}

const productDb = new Database(productDbPath, { readonly: true, fileMustExist: true });
productDb.pragma('query_only = ON');
const productCoverage = loadProductCoverage(productDb);
productDb.close();

const sourceDb = new Database(sourceDbPath, { readonly: true, fileMustExist: true });
sourceDb.pragma('query_only = ON');
sourceDb.pragma('busy_timeout = 30000');

// This query scans native dictionary senses once. It deliberately avoids the
// per-entry localization/example lookups used by the general coverage report.
const nativeQuery = `
  SELECT
    e.id AS source_entry_id,
    e.word,
    e.normalized_key,
    e.source_lang,
    e.frequency_rank,
    e.status AS source_status
  FROM entries e
  WHERE e.frequency_rank IS NOT NULL
    AND e.frequency_rank <= ?
    AND e.source_lang IN ('en', 'pt-BR', 'zh', 'ja')
    AND e.status <> 'deprecated'
    AND EXISTS (
      SELECT 1
      FROM senses s
      WHERE s.entry_id = e.id
        AND s.needs_review = 0
        AND NULLIF(TRIM(s.gloss_key), '') IS NOT NULL
        AND lower(TRIM(s.gloss_key)) <> 'missing gloss'
        AND (
          (e.source_lang = 'zh' AND lower(COALESCE(s.source, '')) LIKE '%cc-cedict%')
          OR (e.source_lang = 'ja' AND lower(COALESCE(s.source, '')) LIKE '%jmdict%')
          OR (
            e.source_lang = 'pt-BR'
            AND (
              lower(COALESCE(s.source, '')) LIKE '%freedict-por-eng%'
              OR lower(COALESCE(s.source, '')) LIKE '%wikdict-pt-%'
              OR lower(COALESCE(s.source, '')) LIKE '%dicionario%'
            )
          )
          OR (
            e.source_lang = 'en'
            AND (
              lower(COALESCE(s.source, '')) LIKE '%freedict-eng-por%'
              OR lower(COALESCE(s.source, '')) LIKE '%wikdict-en-%'
              OR lower(COALESCE(s.source, '')) LIKE '%ecdict%'
            )
          )
        )
    )
  -- Match idx_entries_frequency exactly so SQLite can stream rows instead of
  -- materializing a large temporary sort for deep coverage scans.
  ORDER BY e.frequency_rank, e.normalized_key, e.id
  LIMIT ?
`;
if (args.explain === 'true') {
  const plan = sourceDb.prepare(`EXPLAIN QUERY PLAN ${nativeQuery}`).all(maxRank, scanLimit);
  sourceDb.close();
  console.log(JSON.stringify({ ok: true, query_plan: plan }, null, 2));
  process.exit(0);
}
const nativeEntries = sourceDb.prepare(nativeQuery);

const selected = [];
const counts = Object.fromEntries(Object.keys(targets).map((lang) => [lang, 0]));
let represented = 0;
let scriptMismatch = 0;
let scanned = 0;
for (const row of nativeEntries.iterate(maxRank, scanLimit)) {
  scanned += 1;
  if (counts[row.source_lang] >= targets[row.source_lang]) continue;
  if (excludedCandidateIds.has(String(row.source_entry_id))) continue;
  if (!sourceScriptOk(row.word, row.source_lang)) {
    scriptMismatch += 1;
    continue;
  }
  const normalized = normalize(row.normalized_key || row.word);
  if (
    productCoverage.has(coverageKey(row.source_lang, normalized)) ||
    productCoverage.has(coverageKey(row.source_lang, normalize(row.word)))
  ) {
    represented += 1;
    continue;
  }
  selected.push({
    ...row,
    normalized_key: normalized,
    candidate_key: String(row.source_entry_id),
    selection_reason: 'uncovered_native_daily_dictionary_entry',
    native_source_family: nativeSourceFamily(row.source_lang)
  });
  counts[row.source_lang] += 1;
  if (targetsSatisfied(counts, targets)) break;
}
sourceDb.close();

const report = {
  ok: true,
  generated_at: new Date().toISOString(),
  summary: {
    source_db: relative(sourceDbPath),
    product_db: relative(productDbPath),
    max_rank: maxRank,
    scan_limit: scanLimit,
    requested_by_lang: targets,
    scanned_native_entries: scanned,
    represented,
    excluded_candidate_ids: excludedCandidateIds.size,
    skipped_source_script_mismatch: scriptMismatch,
    selected_by_lang: counts,
    targets_satisfied: targetsSatisfied(counts, targets)
  },
  selected_count: selected.length,
  selected,
  notes: [
    'Read-only candidate report; no database rows were modified.',
    'Eligible native sources are CC-CEDICT (zh), JMdict (ja), FreeDict/WikDict/Dicionario (pt-BR), and FreeDict/WikDict/ECDICT (en).',
    'Latin-script candidates exclude single-letter forms, all-caps abbreviations, and unexpected symbols.',
    'Specific daily senses and localizations must be loaded by the downstream daily-primary selector.',
    'LLM output must remain draft-only until deterministic validation and independent review pass.'
  ]
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
console.log(
  JSON.stringify(
    {
      ok: true,
      out: relative(outPath),
      summary: report.summary,
      selected_count: selected.length,
      sample: selected.slice(0, 20).map(({ source_entry_id, source_lang, word, frequency_rank }) => ({
        source_entry_id,
        source_lang,
        word,
        frequency_rank
      }))
    },
    null,
    2
  )
);

function loadProductCoverage(db) {
  const coverage = new Set();
  for (const row of db.prepare('SELECT primary_lang AS lang, normalized_key AS form FROM product_entries').iterate()) {
    const normalized = normalize(row.form);
    if (normalized) coverage.add(coverageKey(row.lang, normalized));
  }
  for (const row of db
    .prepare('SELECT lang, term AS form FROM product_localizations WHERE needs_review = 0')
    .iterate()) {
    const normalized = normalize(row.form);
    if (normalized) coverage.add(coverageKey(row.lang, normalized));
  }
  return coverage;
}

function parseTargets(value) {
  const targets = { en: 0, 'pt-BR': 0, zh: 0, ja: 0 };
  for (const item of String(value).split(',')) {
    const [rawLang, rawCount] = item.split('=');
    const lang = String(rawLang || '').trim();
    const count = Number(rawCount);
    if (!Object.hasOwn(targets, lang)) throw new Error(`Unsupported target language: ${lang}`);
    if (!Number.isInteger(count) || count < 0) throw new Error(`Invalid target count: ${item}`);
    targets[lang] = count;
  }
  if (!Object.values(targets).some((count) => count > 0)) {
    throw new Error('At least one positive language target is required');
  }
  return targets;
}

function loadExcludedCandidateIds(value) {
  const ids = new Set();
  if (!value) return ids;
  for (const rawPath of String(value).split(',')) {
    const reportPath = path.resolve(rawPath.trim());
    if (!rawPath.trim()) continue;
    if (!fs.existsSync(reportPath)) throw new Error(`Excluded report not found: ${reportPath}`);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const rows = Array.isArray(report) ? report : report.selected || report.items || [];
    for (const row of rows) {
      const id = row?.source_entry_id ?? row?.entry_id;
      if (id !== null && id !== undefined) ids.add(String(id));
    }
  }
  return ids;
}

function targetsSatisfied(counts, targets) {
  return Object.keys(targets).every((lang) => counts[lang] >= targets[lang]);
}

function sourceScriptOk(word, lang) {
  const text = String(word || '').trim();
  if (!text) return false;
  const hasHan = /\p{Script=Han}/u.test(text);
  const hasKana = /[\p{Script=Hiragana}\p{Script=Katakana}\u30fc\uff70]/u.test(text);
  if (lang === 'zh') return hasHan && !hasKana;
  if (lang === 'ja') return hasHan || hasKana;
  if (lang === 'en' || lang === 'pt-BR') {
    if (text.length < 2 || text.length > 80) return false;
    if (!/^\p{L}[\p{L}\p{M}' -]*\p{L}$/u.test(text)) return false;
    if (/^[A-Z\p{M}]{2,}$/u.test(text)) return false;
    return /\p{Script=Latin}/u.test(text) && !hasHan && !hasKana;
  }
  return false;
}

function nativeSourceFamily(lang) {
  if (lang === 'zh') return 'cc-cedict';
  if (lang === 'ja') return 'jmdict';
  if (lang === 'pt-BR') return 'freedict-wikdict-dicionario';
  if (lang === 'en') return 'freedict-wikdict-ecdict';
  throw new Error(`Unsupported source language: ${lang}`);
}

function coverageKey(lang, normalized) {
  return `${lang}\u0000${normalized}`;
}

function normalize(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase();
}

function positiveInteger(value, fallback) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`Expected a positive integer, got: ${value}`);
  return number;
}

function relative(value) {
  return path.relative(process.cwd(), value);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) result[key] = true;
    else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}
