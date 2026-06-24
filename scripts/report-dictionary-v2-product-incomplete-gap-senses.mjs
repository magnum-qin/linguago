import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const LANGS = ["en", "pt-BR", "zh", "ja"];
const DEFAULT_SOURCE_DB = "data/processed/linguago_v2_full.db";
const DEFAULT_PRODUCT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";

const args = parseArgs(process.argv.slice(2));
const sourceDbPath = path.resolve(args["source-db"] || DEFAULT_SOURCE_DB);
const productDbPath = path.resolve(args["product-db"] || DEFAULT_PRODUCT_DB);
const outPath = path.resolve(args.out || "logs/product-incomplete-gap-senses-20260622.json");
const maxRank = Number(args["max-rank"] || 50_000);
const limit = Number(args.limit || 300);

if (!fs.existsSync(sourceDbPath)) throw new Error(`Source DB not found: ${sourceDbPath}`);
if (!fs.existsSync(productDbPath)) throw new Error(`Product DB not found: ${productDbPath}`);

const productDb = new Database(productDbPath, { readonly: true });
const productCoverage = loadProductCoverage(productDb);
productDb.close();

const sourceDb = new Database(sourceDbPath, { readonly: true });
sourceDb.pragma("busy_timeout = 30000");

const rankedEntries = sourceDb
  .prepare(
    `
    SELECT id, word, normalized_key, source_lang, frequency_rank, status
    FROM entries
    WHERE frequency_rank IS NOT NULL
      AND frequency_rank <= ?
      AND source_lang IN (${LANGS.map(() => "?").join(", ")})
      AND status <> 'deprecated'
    ORDER BY frequency_rank, source_lang, id
  `
  )
  .all(maxRank, ...LANGS);

const firstUsefulSense = sourceDb.prepare(`
  SELECT id, sense_order, part_of_speech, gloss_key, source, confidence, needs_review
  FROM senses
  WHERE entry_id = ?
    AND NULLIF(TRIM(gloss_key), '') IS NOT NULL
    AND lower(TRIM(gloss_key)) <> 'missing gloss'
  ORDER BY sense_order, id
  LIMIT 1
`);

const usefulSenses = sourceDb.prepare(`
  SELECT id, sense_order, part_of_speech, gloss_key, source, confidence, needs_review
  FROM senses
  WHERE entry_id = ?
    AND NULLIF(TRIM(gloss_key), '') IS NOT NULL
    AND lower(TRIM(gloss_key)) <> 'missing gloss'
  ORDER BY sense_order, id
  LIMIT 12
`);

const localizationsBySense = sourceDb.prepare(`
  SELECT lang, term, reading, reading_system, pronunciation, pronunciation_system, definition, source, confidence, needs_review
  FROM sense_localizations
  WHERE sense_id = ?
  ORDER BY needs_review, lang
`);

const entryLocalizationTerms = sourceDb.prepare(`
  SELECT sl.lang, sl.term, COUNT(*) AS rows
  FROM sense_localizations sl
  JOIN senses s ON s.id = sl.sense_id
  WHERE s.entry_id = ?
    AND sl.needs_review = 0
    AND NULLIF(TRIM(sl.term), '') IS NOT NULL
    AND NULLIF(TRIM(sl.definition), '') IS NOT NULL
  GROUP BY sl.lang, sl.term
  ORDER BY sl.lang, rows DESC, sl.term
`);

const stats = {
  source_db: path.relative(process.cwd(), sourceDbPath),
  product_db: path.relative(process.cwd(), productDbPath),
  max_rank: maxRank,
  scanned_ranked_entries: rankedEntries.length,
  represented: 0,
  source_script_mismatch: 0,
  no_useful_sense: 0,
  first_sense_complete: 0,
  first_sense_incomplete: 0,
  entry_level_four_lang_available: 0,
  missing_lang_sets: {},
  by_source_lang: {},
  by_status: {},
  same_entry_repair_candidates: 0
};

const rows = [];
for (const entry of rankedEntries) {
  if (!sourceScriptOk(entry.word, entry.source_lang)) {
    stats.source_script_mismatch++;
    continue;
  }
  if (isCovered(entry, productCoverage)) {
    stats.represented++;
    continue;
  }

  const first = firstUsefulSense.get(entry.id);
  if (!first) {
    stats.no_useful_sense++;
    continue;
  }

  const firstLocs = localizationsBySense.all(first.id).map(compactLoc);
  const firstCleanLangs = cleanLangs(firstLocs);
  if (firstCleanLangs.length >= 4) {
    stats.first_sense_complete++;
    continue;
  }

  const allTerms = entryLocalizationTerms.all(entry.id);
  const entryCleanLangs = [...new Set(allTerms.map((row) => row.lang))];
  const missing = LANGS.filter((lang) => !firstCleanLangs.includes(lang));
  const missingKey = missing.join(",");
  stats.first_sense_incomplete++;
  stats.missing_lang_sets[missingKey] = (stats.missing_lang_sets[missingKey] || 0) + 1;
  stats.by_source_lang[entry.source_lang] = (stats.by_source_lang[entry.source_lang] || 0) + 1;
  stats.by_status[entry.status] = (stats.by_status[entry.status] || 0) + 1;
  if (entryCleanLangs.length >= 4) stats.entry_level_four_lang_available++;

  const senses = usefulSenses.all(entry.id).map((sense) => {
    const locs = localizationsBySense.all(sense.id).map(compactLoc);
    return {
      id: sense.id,
      sense_order: sense.sense_order,
      part_of_speech: sense.part_of_speech,
      gloss_key: preview(sense.gloss_key, 160),
      needs_review: Boolean(sense.needs_review),
      clean_langs: cleanLangs(locs),
      localizations: locs
    };
  });
  const repairableFromSameEntry = missing.every((lang) =>
    senses.some((sense) => sense.clean_langs.includes(lang) && compatibleGloss(first.gloss_key, sense.gloss_key))
  );
  if (repairableFromSameEntry) stats.same_entry_repair_candidates++;

  rows.push({
    source_entry_id: entry.id,
    word: entry.word,
    normalized_key: normalize(entry.normalized_key || entry.word),
    source_lang: entry.source_lang,
    frequency_rank: entry.frequency_rank,
    source_status: entry.status,
    first_sense_id: first.id,
    first_sense_order: first.sense_order,
    first_gloss_key: first.gloss_key,
    first_gloss_preview: preview(first.gloss_key, 180),
    first_clean_langs: firstCleanLangs,
    missing_langs: missing,
    entry_clean_langs: entryCleanLangs,
    entry_level_four_lang_available: entryCleanLangs.length >= 4,
    repairable_from_same_entry: repairableFromSameEntry,
    entry_terms_by_lang: summarizeTermsByLang(allTerms),
    useful_senses: senses
  });
}

rows.sort(compareRows);
const selected = rows.slice(0, limit);
sourceDb.close();

const report = {
  ok: true,
  generated_at: new Date().toISOString(),
  summary: stats,
  selected_count: selected.length,
  selected,
  next_step: "Review same_entry_repair_candidates first; do not copy localizations across incompatible glosses."
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
console.log(
  JSON.stringify(
    {
      ok: true,
      out: path.relative(process.cwd(), outPath),
      summary: stats,
      selected_count: selected.length,
      top: selected.slice(0, 20).map((row) => ({
        rank: row.frequency_rank,
        lang: row.source_lang,
        word: row.word,
        missing: row.missing_langs.join(","),
        entry4: row.entry_level_four_lang_available,
        same_entry_repair: row.repairable_from_same_entry,
        gloss: row.first_gloss_preview
      }))
    },
    null,
    2
  )
);

function loadProductCoverage(db) {
  const coverage = new Set();
  for (const row of db.prepare("SELECT primary_lang AS lang, normalized_key AS form FROM product_entries").iterate()) {
    const normalized = normalize(row.form);
    if (normalized) coverage.add(key(row.lang, normalized));
  }
  for (const row of db.prepare("SELECT lang, term AS form FROM product_localizations WHERE needs_review = 0").iterate()) {
    const normalized = normalize(row.form);
    if (normalized) coverage.add(key(row.lang, normalized));
  }
  return coverage;
}

function isCovered(entry, coverage) {
  return coverage.has(key(entry.source_lang, normalize(entry.normalized_key || entry.word))) ||
    coverage.has(key(entry.source_lang, normalize(entry.word)));
}

function cleanLangs(localizations) {
  return [
    ...new Set(
      localizations
        .filter((row) => !row.needs_review && row.term && row.definition)
        .map((row) => row.lang)
    )
  ].sort();
}

function compactLoc(row) {
  return {
    lang: row.lang,
    term: row.term,
    reading: row.reading,
    reading_system: row.reading_system,
    pronunciation: row.pronunciation,
    pronunciation_system: row.pronunciation_system,
    definition: preview(row.definition, 180),
    source: row.source,
    confidence: row.confidence,
    needs_review: Boolean(row.needs_review)
  };
}

function summarizeTermsByLang(rows) {
  const out = {};
  for (const row of rows) {
    if (!out[row.lang]) out[row.lang] = [];
    if (out[row.lang].length < 8) out[row.lang].push({ term: row.term, rows: row.rows });
  }
  return out;
}

function compatibleGloss(a, b) {
  const left = normalizeGloss(a);
  const right = normalizeGloss(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 5 && right.includes(left)) return true;
  if (right.length >= 5 && left.includes(right)) return true;
  return false;
}

function normalizeGloss(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/gu, " ")
    .trim();
}

function compareRows(a, b) {
  if (a.repairable_from_same_entry !== b.repairable_from_same_entry) return a.repairable_from_same_entry ? -1 : 1;
  if (a.entry_level_four_lang_available !== b.entry_level_four_lang_available) return a.entry_level_four_lang_available ? -1 : 1;
  if (a.frequency_rank !== b.frequency_rank) return a.frequency_rank - b.frequency_rank;
  return a.word.localeCompare(b.word);
}

function sourceScriptOk(word, lang) {
  const text = String(word || "").trim();
  if (!text) return false;
  const hasLatin = /\p{Script=Latin}/u.test(text);
  const hasHan = /\p{Script=Han}/u.test(text);
  const hasHiragana = /\p{Script=Hiragana}/u.test(text);
  const hasKatakana = /\p{Script=Katakana}/u.test(text);
  const hasKana = hasHiragana || hasKatakana || /[\u30fc\uff70]/u.test(text);
  if (lang === "zh") return hasHan && !hasKana;
  if (lang === "ja") return hasHan || hasKana;
  if (lang === "en" || lang === "pt-BR") return !hasHan && !hasKana && hasLatin;
  return true;
}

function key(lang, normalized) {
  return `${lang}\u0000${normalized}`;
}

function normalize(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase();
}

function preview(value, length) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const keyName = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) result[keyName] = true;
    else {
      result[keyName] = next;
      index++;
    }
  }
  return result;
}
