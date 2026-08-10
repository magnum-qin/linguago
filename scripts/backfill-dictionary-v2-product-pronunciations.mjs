import Database from 'better-sqlite3';
import csv from 'csv-parser';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB = 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const DEFAULT_ECDICT = 'data/raw/ecdict.csv';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const ecdictPath = path.resolve(args.ecdict || DEFAULT_ECDICT);
const dryRun = args['dry-run'] !== 'false';
const minSameTermCount = args['min-same-term-count'] ? Number(args['min-same-term-count']) : 2;
const allowUniqueSameTerm = args['allow-unique-same-term'] === 'true';
const sameTermSourceAllowRegex = args['same-term-source-allow-regex']
  ? new RegExp(args['same-term-source-allow-regex'], 'i')
  : null;
const useEcdict = args['use-ecdict'] !== 'false';
const limit = args.limit ? Number(args.limit) : 0;

if (!Number.isInteger(minSameTermCount) || minSameTermCount < 1) {
  throw new Error(`Invalid --min-same-term-count: ${args['min-same-term-count']}`);
}
if (limit && (!Number.isInteger(limit) || limit < 1)) throw new Error(`Invalid --limit: ${args.limit}`);

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000');

const ecdict = useEcdict ? await loadEcdict(ecdictPath) : new Map();

const missingRows = db
  .prepare(
    `
    SELECT
      pl.id AS localization_id,
      pl.product_sense_id,
      pl.lang,
      pl.term,
      pl.definition,
      pe.headword,
      pe.frequency_rank
    FROM product_localizations pl
    JOIN product_senses ps ON ps.id = pl.product_sense_id
    JOIN product_entries pe ON pe.id = ps.product_entry_id
    WHERE ps.status = 'accepted'
      AND pl.lang IN ('en', 'pt-BR')
      AND (pl.pronunciation IS NULL OR TRIM(pl.pronunciation) = '')
      AND NULLIF(TRIM(pl.term), '') IS NOT NULL
    ORDER BY pe.frequency_rank IS NULL, pe.frequency_rank, pe.normalized_key, ps.sense_order, ps.id,
      CASE pl.lang WHEN 'en' THEN 1 ELSE 2 END
    ${limit ? 'LIMIT ?' : ''}
  `
  )
  .all(...(limit ? [limit] : []));

const sameTermPronunciations = buildSameTermPronunciations(
  db,
  minSameTermCount,
  allowUniqueSameTerm,
  sameTermSourceAllowRegex
);
const updates = [];
const skipped = [];

for (const row of missingRows) {
  const sameTerm = sameTermPronunciations.get(`${row.lang}\t${normalizeTerm(row.term)}`);
  if (sameTerm) {
    updates.push({
      ...row,
      pronunciation: sameTerm.pronunciation,
      pronunciation_system: sameTerm.pronunciation_system || 'inferred',
      source: `deterministic:same-term:n${sameTerm.count}`
    });
    continue;
  }

  if (row.lang === 'en' && ecdict.has(normalizeTerm(row.term))) {
    const phonetic = ecdict.get(normalizeTerm(row.term));
    updates.push({
      ...row,
      pronunciation: phonetic,
      pronunciation_system: 'ecdict-phonetic',
      source: 'deterministic:ecdict'
    });
    continue;
  }

  skipped.push(row);
}

if (!dryRun && updates.length) {
  const update = db.prepare(`
    UPDATE product_localizations
    SET pronunciation = @pronunciation,
        pronunciation_system = @pronunciation_system,
        source = CASE
          WHEN source IS NULL OR source = '' THEN @source
          ELSE source || ';' || @source
        END,
        confidence = MAX(COALESCE(confidence, 0), 0.86),
        needs_review = 0
    WHERE id = @localization_id
      AND (pronunciation IS NULL OR TRIM(pronunciation) = '')
  `);
  const tx = db.transaction((items) => items.forEach((item) => update.run(item)));
  tx(updates);
}

const summary = {
  ok: true,
  db: path.relative(process.cwd(), dbPath),
  dry_run: dryRun,
  min_same_term_count: minSameTermCount,
  allow_unique_same_term: allowUniqueSameTerm,
  same_term_source_allow_regex: args['same-term-source-allow-regex'] || null,
  use_ecdict: useEcdict,
  candidates: missingRows.length,
  updates_planned: updates.length,
  updates_by_lang: countBy(updates, 'lang'),
  updates_by_source: countBy(updates, 'source'),
  skipped: skipped.length,
  samples: updates.slice(0, 30).map((item) => ({
    sense_id: item.product_sense_id,
    lang: item.lang,
    term: item.term,
    pronunciation: item.pronunciation,
    pronunciation_system: item.pronunciation_system,
    source: item.source
  }))
};

console.log(JSON.stringify(summary, null, 2));
db.close();

function buildSameTermPronunciations(database, minCount, allowUnique, sourceAllowRegex) {
  const rows = database
    .prepare(
      `
      WITH source_rows AS (
        SELECT
          lang,
          lower(trim(term)) AS normalized_term,
          pronunciation,
          pronunciation_system,
          source
        FROM product_localizations
        WHERE lang IN ('en', 'pt-BR')
          AND pronunciation IS NOT NULL
          AND TRIM(pronunciation) <> ''
          AND term IS NOT NULL
          AND TRIM(term) <> ''
      ),
      grouped AS (
        SELECT
          lang,
          normalized_term,
          pronunciation,
          pronunciation_system,
          COUNT(*) AS count,
          GROUP_CONCAT(DISTINCT source) AS sources
        FROM source_rows
        GROUP BY lang, normalized_term, pronunciation, pronunciation_system
      ),
      variant_counts AS (
        SELECT
          lang,
          normalized_term,
          COUNT(*) AS pronunciation_variants,
          SUM(count) AS total_count
        FROM grouped
        GROUP BY lang, normalized_term
      ),
      eligible AS (
        SELECT grouped.*
        FROM grouped
        JOIN variant_counts USING (lang, normalized_term)
        WHERE grouped.count >= ?
          OR (? = 1 AND variant_counts.pronunciation_variants = 1)
      ),
      ranked AS (
        SELECT
          *,
          ROW_NUMBER() OVER (
            PARTITION BY lang, normalized_term
            ORDER BY count DESC, length(pronunciation) ASC, pronunciation
          ) AS rn
        FROM eligible
      )
      SELECT lang, normalized_term, pronunciation, pronunciation_system, count, sources
      FROM ranked
      WHERE rn = 1
    `
    )
    .all(minCount, allowUnique ? 1 : 0);
  return new Map(
    rows
      .filter((row) => !sourceAllowRegex || sourceAllowRegex.test(row.sources || ''))
      .map((row) => [`${row.lang}\t${row.normalized_term}`, row])
  );
}

function loadEcdict(file) {
  return new Promise((resolve, reject) => {
    const map = new Map();
    fs.createReadStream(file)
      .pipe(csv())
      .on('data', (row) => {
        const word = normalizeTerm(row.word);
        const phonetic = cleanPhonetic(row.phonetic);
        if (!word || !phonetic) return;
        if (!map.has(word)) map.set(word, phonetic);
      })
      .on('error', reject)
      .on('end', () => resolve(map));
  });
}

function cleanPhonetic(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length > 80) return '';
  return text;
}

function normalizeTerm(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
}

function countBy(items, key) {
  const counts = new Map();
  for (const item of items) counts.set(item[key], (counts.get(item[key]) || 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ [key]: value, count }))
    .sort((a, b) => b.count - a.count || String(a[key]).localeCompare(String(b[key])));
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) parsed[key] = 'true';
    else {
      parsed[key] = next;
      index++;
    }
  }
  return parsed;
}
