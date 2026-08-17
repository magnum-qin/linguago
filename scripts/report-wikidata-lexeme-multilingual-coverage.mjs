#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';
import * as OpenCC from 'opencc-js';

const args = parseArgs(process.argv.slice(2));
const dumpPath = requiredPath(args.input || 'data/raw/wikidata-latest-lexemes.json.gz');
const productDbPath = requiredPath(
  args['product-db'] || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db'
);
const outPath = path.resolve(args.out || 'logs/wikidata-lexeme-multilingual-coverage.json');
const tempDbPath = path.resolve(args['temp-db'] || '.tmp/wikidata/wikidata-lexeme-multilingual-coverage.db');
const sampleLimit = boundedInteger(args['sample-limit'], 50, 1);
const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });

fs.mkdirSync(path.dirname(tempDbPath), { recursive: true });
fs.rmSync(tempDbPath, { force: true });
const db = new Database(tempDbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.exec(`
  CREATE TABLE item_terms (
    item_id TEXT NOT NULL,
    lang TEXT NOT NULL,
    term TEXT NOT NULL,
    normalized_key TEXT NOT NULL,
    lexeme_id TEXT NOT NULL,
    sense_id TEXT NOT NULL,
    english_gloss TEXT,
    language_variant TEXT NOT NULL,
    PRIMARY KEY(item_id, lang, normalized_key, sense_id)
  );
  CREATE INDEX idx_item_terms_item ON item_terms(item_id, lang);
  CREATE TABLE translation_edges (
    source_sense_id TEXT NOT NULL,
    target_sense_id TEXT NOT NULL,
    PRIMARY KEY(source_sense_id, target_sense_id)
  );
`);
const insertItemTerm = db.prepare(`
  INSERT OR IGNORE INTO item_terms
    (item_id, lang, term, normalized_key, lexeme_id, sense_id, english_gloss, language_variant)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertTranslation = db.prepare(`
  INSERT OR IGNORE INTO translation_edges(source_sense_id, target_sense_id) VALUES (?, ?)
`);
const stats = {
  entities: 0,
  relevant_lexemes: 0,
  senses: 0,
  senses_with_items: 0,
  senses_with_translations: 0
};

db.exec('BEGIN IMMEDIATE');
await scanDump((entity) => {
  stats.entities += 1;
  const lemmas = bestLemmas(entity.lemmas || {});
  if (!lemmas.length) return;
  stats.relevant_lexemes += 1;
  for (const sense of entity.senses || []) {
    stats.senses += 1;
    const itemIds = claimEntityIds(sense, 'P5137', 'item');
    const targetSenseIds = claimEntityIds(sense, 'P5972', 'sense');
    if (itemIds.length) stats.senses_with_items += 1;
    if (targetSenseIds.length) stats.senses_with_translations += 1;
    const englishGloss = glossValue(sense, ['en', 'en-gb', 'en-ca']);
    for (const itemId of itemIds) {
      for (const lemma of lemmas) {
        const term = cleanTerm(lemma.value, lemma.lang);
        if (!term) continue;
        insertItemTerm.run(
          itemId,
          lemma.lang,
          term,
          normalize(term),
          entity.id,
          sense.id,
          englishGloss,
          lemma.variant
        );
      }
    }
    for (const targetSenseId of targetSenseIds) insertTranslation.run(sense.id, targetSenseId);
  }
});
db.exec('COMMIT');
db.pragma('journal_mode = DELETE');

const languageRows = db.prepare(`
  SELECT lang, COUNT(*) rows, COUNT(DISTINCT item_id) items
  FROM item_terms GROUP BY lang ORDER BY lang
`).all();
const combinations = db.prepare(`
  WITH item_langs AS (
    SELECT item_id, GROUP_CONCAT(lang, ',') langs
    FROM (SELECT DISTINCT item_id, lang FROM item_terms ORDER BY item_id, lang)
    GROUP BY item_id
  )
  SELECT langs, COUNT(*) items FROM item_langs GROUP BY langs ORDER BY items DESC, langs
`).all();
const fourLanguageCount = db.prepare(`
  SELECT COUNT(*) count FROM (
    SELECT item_id FROM item_terms GROUP BY item_id HAVING COUNT(DISTINCT lang) = 4
  )
`).get().count;
const explicitBrazilianPortugueseCount = db.prepare(`
  SELECT COUNT(*) count FROM (
    SELECT item_id
    FROM item_terms
    GROUP BY item_id
    HAVING COUNT(DISTINCT lang) = 4
      AND SUM(CASE WHEN lang = 'pt-BR' AND language_variant = 'pt-br' THEN 1 ELSE 0 END) > 0
  )
`).get().count;
const conservativeUniqueCount = db.prepare(`
  SELECT COUNT(*) count FROM (
    SELECT item_id
    FROM item_terms
    GROUP BY item_id
    HAVING COUNT(DISTINCT lang) = 4
      AND COUNT(DISTINCT CASE WHEN lang = 'en' THEN normalized_key END) = 1
      AND COUNT(DISTINCT CASE WHEN lang = 'pt-BR' THEN normalized_key END) = 1
      AND COUNT(DISTINCT CASE WHEN lang = 'zh' THEN normalized_key END) = 1
      AND COUNT(DISTINCT CASE WHEN lang = 'ja' THEN normalized_key END) = 1
      AND MIN(CASE WHEN lang = 'zh' THEN LENGTH(term) ELSE 999 END) >= 2
  )
`).get().count;
const conservativeExplicitBrazilianCount = db.prepare(`
  SELECT COUNT(*) count FROM (
    SELECT item_id
    FROM item_terms
    GROUP BY item_id
    HAVING COUNT(DISTINCT lang) = 4
      AND COUNT(DISTINCT CASE WHEN lang = 'en' THEN normalized_key END) = 1
      AND COUNT(DISTINCT CASE WHEN lang = 'pt-BR' THEN normalized_key END) = 1
      AND COUNT(DISTINCT CASE WHEN lang = 'zh' THEN normalized_key END) = 1
      AND COUNT(DISTINCT CASE WHEN lang = 'ja' THEN normalized_key END) = 1
      AND MIN(CASE WHEN lang = 'zh' THEN LENGTH(term) ELSE 999 END) >= 2
      AND SUM(CASE WHEN lang = 'pt-BR' AND language_variant = 'pt-br' THEN 1 ELSE 0 END) > 0
  )
`).get().count;
db.exec(`ATTACH DATABASE ${JSON.stringify(productDbPath)} AS product`);
db.exec(`
  CREATE TEMP TABLE product_terms (
    lang TEXT NOT NULL,
    normalized_key TEXT NOT NULL,
    PRIMARY KEY(lang, normalized_key)
  ) WITHOUT ROWID;
  INSERT OR IGNORE INTO product_terms(lang, normalized_key)
    SELECT primary_lang, LOWER(TRIM(normalized_key)) FROM product.product_entries
    WHERE normalized_key IS NOT NULL AND TRIM(normalized_key) <> '';
  INSERT OR IGNORE INTO product_terms(lang, normalized_key)
    SELECT lang, LOWER(TRIM(term)) FROM product.product_localizations
    WHERE term IS NOT NULL AND TRIM(term) <> '';
`);
const productCoverage = db.prepare(`
  WITH four_items AS (
    SELECT item_id FROM item_terms GROUP BY item_id HAVING COUNT(DISTINCT lang) = 4
  ), item_coverage AS (
    SELECT t.item_id,
           COUNT(DISTINCT t.lang) source_langs,
           COUNT(DISTINCT CASE WHEN p.normalized_key IS NOT NULL THEN t.lang END) covered_langs,
           COUNT(DISTINCT CASE WHEN p.normalized_key IS NULL THEN t.lang END) missing_langs
    FROM item_terms t
    JOIN four_items f ON f.item_id = t.item_id
    LEFT JOIN product_terms p ON p.lang = t.lang AND p.normalized_key = t.normalized_key
    GROUP BY t.item_id
  )
  SELECT
    COUNT(*) four_language_concepts,
    SUM(CASE WHEN covered_langs = 4 THEN 1 ELSE 0 END) fully_exact_covered,
    SUM(CASE WHEN covered_langs BETWEEN 1 AND 3 THEN 1 ELSE 0 END) partially_exact_covered,
    SUM(CASE WHEN covered_langs = 0 THEN 1 ELSE 0 END) no_exact_coverage
  FROM item_coverage
`).get();
const samples = db.prepare(`
  SELECT item_id, lang, GROUP_CONCAT(term, ' | ') terms
  FROM (
    SELECT DISTINCT item_id, lang, term FROM item_terms
    WHERE item_id IN (
      SELECT item_id FROM item_terms GROUP BY item_id HAVING COUNT(DISTINCT lang) = 4
      ORDER BY item_id LIMIT ?
    )
    ORDER BY item_id, lang, term
  )
  GROUP BY item_id, lang
`).all(sampleLimit);
const groupedSamples = [];
for (const row of samples) {
  let sample = groupedSamples.find((item) => item.item_id === row.item_id);
  if (!sample) {
    sample = { item_id: row.item_id, terms: {} };
    groupedSamples.push(sample);
  }
  sample.terms[row.lang] = row.terms;
}
const report = {
  ok: db.pragma('integrity_check', { simple: true }) === 'ok',
  generated_at: new Date().toISOString(),
  source: path.relative(process.cwd(), dumpPath),
  policy: {
    evidence_scope: 'Wikidata Lexeme senses sharing P5137 items',
    item_labels_are_not_used: true,
    chinese_normalization: 'Simplified Chinese',
    portuguese_variants: 'pt-BR preferred over generic pt when both exist; generic pt is counted separately and is not pt-BR publication evidence',
    source_family: 'wikidata-lexeme'
  },
  counts: {
    ...stats,
    item_terms: db.prepare('SELECT COUNT(*) count FROM item_terms').get().count,
    concepts: db.prepare('SELECT COUNT(DISTINCT item_id) count FROM item_terms').get().count,
    four_language_concepts: fourLanguageCount,
    four_language_concepts_with_explicit_pt_br: explicitBrazilianPortugueseCount,
    conservative_unique_four_language_concepts: conservativeUniqueCount,
    conservative_unique_four_language_concepts_with_explicit_pt_br: conservativeExplicitBrazilianCount,
    translation_edges: db.prepare('SELECT COUNT(*) count FROM translation_edges').get().count,
    product_exact_coverage: productCoverage,
    by_language: languageRows,
    language_combinations: combinations
  },
  samples: groupedSamples
};
db.close();
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: report.ok, out: path.relative(process.cwd(), outPath), counts: report.counts }, null, 2));

async function scanDump(visit) {
  const input = fs.createReadStream(dumpPath).pipe(zlib.createGunzip());
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line || line === '[' || line === ']') continue;
    if (line.startsWith('[')) line = line.slice(1).trim();
    if (line.endsWith(',')) line = line.slice(0, -1).trim();
    if (line.endsWith(']')) line = line.slice(0, -1).trim();
    if (line) visit(JSON.parse(line));
  }
}

function bestLemmas(lemmas) {
  const rows = Object.values(lemmas).map((lemma) => ({
    lang: normalizeLang(lemma.language),
    value: String(lemma.value || '').trim(),
    variant: String(lemma.language || '').toLowerCase(),
    priority: languageVariantPriority(lemma.language)
  })).filter((row) => row.lang && row.value);
  const bestByLang = new Map();
  for (const row of rows) {
    const best = bestByLang.get(row.lang);
    if (best === undefined || row.priority < best) bestByLang.set(row.lang, row.priority);
  }
  return rows.filter((row) => row.priority === bestByLang.get(row.lang));
}

function normalizeLang(lang) {
  const value = String(lang || '').toLowerCase();
  if (value === 'pt' || value === 'pt-br') return 'pt-BR';
  if (['zh', 'zh-cn', 'zh-hans', 'zh-hant', 'zh-tw'].includes(value)) return 'zh';
  if (value === 'ja' || value === 'en') return value;
  return null;
}

function languageVariantPriority(lang) {
  const value = String(lang || '').toLowerCase();
  if (value === 'pt-br' || value === 'zh-cn' || value === 'zh-hans') return 0;
  if (value === 'pt' || value === 'zh') return 1;
  if (value === 'zh-hant' || value === 'zh-tw') return 2;
  return 0;
}

function cleanTerm(value, lang) {
  let term = String(value || '').normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!term || term === '-' || /<[^>]+>/u.test(term)) return null;
  if (lang === 'zh') {
    if (!/\p{Script=Han}/u.test(term)) return null;
    term = toSimplified(term);
  } else if (lang === 'ja' && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(term)) {
    return null;
  }
  return term;
}

function glossValue(sense, languages) {
  for (const lang of languages) {
    const value = sense?.glosses?.[lang]?.value;
    if (value) return String(value).trim();
  }
  return null;
}

function claimEntityIds(entity, property, type) {
  return (entity?.claims?.[property] || [])
    .map((claim) => claim?.mainsnak?.datavalue?.value)
    .filter((value) => value?.['entity-type'] === type && typeof value.id === 'string')
    .map((value) => value.id);
}

function normalize(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ');
}

function requiredPath(value) {
  const resolved = path.resolve(String(value || ''));
  if (!value || !fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  return resolved;
}

function boundedInteger(value, fallback, minimum) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum ? number : fallback;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith('--') ? argv[++index] : true;
  }
  return parsed;
}
