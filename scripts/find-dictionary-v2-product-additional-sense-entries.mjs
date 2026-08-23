#!/usr/bin/env node

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const sourceDbPath = requiredPath(
  args['source-db'] || 'data/processed/linguago_v2_full.db',
  'source-db'
);
const productDbPath = requiredPath(
  args['product-db'] ||
    'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db',
  'product-db'
);
const outPath = path.resolve(
  args.out || 'logs/product-additional-sense-entry-candidates.json'
);
const maxRank = positiveInteger(args['max-rank'], 500_000);
const limit = positiveInteger(args.limit, 50_000);
const langs = new Set(
  String(args.langs || 'zh,ja,pt-BR,en')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);

const sourceDb = new Database(sourceDbPath, { readonly: true, fileMustExist: true });
const productDb = new Database(productDbPath, { readonly: true, fileMustExist: true });
sourceDb.pragma('query_only = ON');
productDb.pragma('query_only = ON');

const representedSourceEntries = new Map();
for (const row of productDb.prepare(`
  SELECT link.source_entry_id,
         pe.id AS product_entry_id,
         pe.headword,
         pe.normalized_key,
         pe.primary_lang,
         ps.id AS product_sense_id,
         pl.lang AS localization_lang,
         pl.term AS localization_term
  FROM product_sense_source_links link
  JOIN product_senses ps ON ps.id = link.product_sense_id
  JOIN product_entries pe ON pe.id = ps.product_entry_id
  LEFT JOIN product_localizations pl
    ON pl.product_sense_id = ps.id
   AND pl.needs_review = 0
  WHERE ps.status = 'accepted'
    AND pe.status = 'accepted'
`).iterate()) {
  const sourceEntryId = Number(row.source_entry_id);
  const productEntryId = Number(row.product_entry_id);
  let byProductEntry = representedSourceEntries.get(sourceEntryId);
  if (!byProductEntry) {
    byProductEntry = new Map();
    representedSourceEntries.set(sourceEntryId, byProductEntry);
  }
  let represented = byProductEntry.get(productEntryId);
  if (!represented) {
    represented = {
      product_entry_id: productEntryId,
      headword: row.headword,
      normalized_key: row.normalized_key,
      primary_lang: row.primary_lang,
      accepted_linked_sense_ids: new Set(),
      localized_terms: []
    };
    byProductEntry.set(productEntryId, represented);
  }
  represented.accepted_linked_sense_ids.add(Number(row.product_sense_id));
  if (row.localization_lang && row.localization_term) {
    represented.localized_terms.push({
      lang: row.localization_lang,
      term: row.localization_term
    });
  }
}

const sourceEntries = sourceDb.prepare(`
  SELECT id, word, normalized_key, source_lang, frequency_rank, status
  FROM entries
  WHERE frequency_rank IS NOT NULL
    AND frequency_rank <= ?
    AND status <> 'deprecated'
  ORDER BY frequency_rank, id
`).all(maxRank);

const selected = [];
let skippedUnmatchedProductEntry = 0;
for (const entry of sourceEntries) {
  if (!langs.has(entry.source_lang)) continue;
  const representations = [...(representedSourceEntries.get(Number(entry.id))?.values() || [])];
  if (representations.length === 0) continue;
  const sourceKey = normalizeKey(entry.normalized_key || entry.word);
  const matching = representations
    .map((represented) => ({
      represented,
      primary_match:
        represented.primary_lang === entry.source_lang &&
        normalizeKey(represented.normalized_key || represented.headword) === sourceKey,
      localization_match: represented.localized_terms.some(
        (localized) =>
          localized.lang === entry.source_lang &&
          normalizeKey(localized.term) === sourceKey
      )
    }))
    .filter((match) => match.primary_match)
    .sort((left, right) =>
      Number(right.primary_match) - Number(left.primary_match) ||
      Number(right.localization_match) - Number(left.localization_match) ||
      right.represented.accepted_linked_sense_ids.size -
        left.represented.accepted_linked_sense_ids.size ||
      left.represented.product_entry_id - right.represented.product_entry_id
    );
  if (matching.length === 0) {
    skippedUnmatchedProductEntry += 1;
    continue;
  }
  const represented = matching[0].represented;
  selected.push({
    source_entry_id: entry.id,
    word: entry.word,
    normalized_key: entry.normalized_key,
    source_lang: entry.source_lang,
    frequency_rank: entry.frequency_rank,
    source_status: entry.status,
    product_entry_id: represented.product_entry_id,
    accepted_linked_senses: represented.accepted_linked_sense_ids.size,
    candidate_lane: 'additional_unlinked_source_sense'
  });
  if (selected.length >= limit) break;
}

sourceDb.close();
productDb.close();

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_db: relative(sourceDbPath),
  product_db: relative(productDbPath),
  policy: {
    accepted_product_entries_only: true,
    accepted_source_links_only: true,
    source_sense_selection_deferred_to_daily_primary_selector: true,
    automatic_database_write: false
  },
  summary: {
    represented_source_entries: representedSourceEntries.size,
    scanned_ranked_source_entries: sourceEntries.length,
    selected: selected.length,
    skipped_unmatched_product_entry: skippedUnmatchedProductEntry,
    selected_by_lang: countBy(selected, (row) => row.source_lang),
    max_rank: maxRank,
    limit
  },
  selected_count: selected.length,
  selected
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary: output.summary }, null, 2));

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    parsed[token.slice(2)] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return parsed;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || fallback, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Expected positive integer, got ${value}`);
  return parsed;
}

function requiredPath(value, name) {
  const filePath = path.resolve(value);
  if (!fs.existsSync(filePath)) throw new Error(`Missing --${name}: ${filePath}`);
  return filePath;
}

function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = String(selector(row) || 'unknown');
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('und');
}

function relative(filePath) {
  return path.relative(process.cwd(), filePath);
}
