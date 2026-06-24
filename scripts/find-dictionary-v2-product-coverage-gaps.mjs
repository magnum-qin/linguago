import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_SOURCE_DB = "data/processed/linguago_v2_full.db";
const DEFAULT_PRODUCT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";
const LANGS = ["en", "pt-BR", "zh", "ja"];

const args = parseArgs(process.argv.slice(2));
const sourceDbPath = path.resolve(args["source-db"] || DEFAULT_SOURCE_DB);
const productDbPath = path.resolve(args["product-db"] || DEFAULT_PRODUCT_DB);
const outPath = path.resolve(args.out || "logs/product-coverage-gaps-20260622.json");
const maxRank = Number(args["max-rank"] || 50_000);
const limit = Number(args.limit || 200);
const minGlossLength = Number(args["min-gloss-length"] || 4);
const requireSourceScript = args["require-source-script"] !== "false";
const includeDetails = args["include-details"] === true || args["include-details"] === "true";
const requireFirstSenseComplete = args["require-first-sense-complete"] === true || args["require-first-sense-complete"] === "true";

if (!fs.existsSync(sourceDbPath)) throw new Error(`Source DB not found: ${sourceDbPath}`);
if (!fs.existsSync(productDbPath)) throw new Error(`Product DB not found: ${productDbPath}`);

const productDb = new Database(productDbPath, { readonly: true });
const productCoverage = loadProductCoverage(productDb);
productDb.close();

const sourceDb = new Database(sourceDbPath, { readonly: true });
sourceDb.pragma("busy_timeout = 30000");

const sourceEntries = sourceDb
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

const senseSummary = sourceDb.prepare(`
  SELECT
    COUNT(*) AS sense_count,
    SUM(CASE WHEN needs_review = 0 THEN 1 ELSE 0 END) AS clean_sense_count,
    SUM(CASE WHEN NULLIF(TRIM(gloss_key), '') IS NOT NULL AND lower(TRIM(gloss_key)) <> 'missing gloss' THEN 1 ELSE 0 END) AS useful_gloss_count,
    MIN(CASE WHEN NULLIF(TRIM(gloss_key), '') IS NOT NULL AND lower(TRIM(gloss_key)) <> 'missing gloss' THEN sense_order ELSE NULL END) AS first_useful_sense_order
  FROM senses
  WHERE entry_id = ?
`);

const firstUsefulSense = sourceDb.prepare(`
  SELECT id, sense_order, part_of_speech, gloss_key, source, confidence, needs_review
  FROM senses
  WHERE entry_id = ?
    AND NULLIF(TRIM(gloss_key), '') IS NOT NULL
    AND lower(TRIM(gloss_key)) <> 'missing gloss'
  ORDER BY sense_order, id
  LIMIT 1
`);

const localizationSummary = sourceDb.prepare(`
  SELECT lang, COUNT(*) AS rows
  FROM sense_localizations sl
  JOIN senses s ON s.id = sl.sense_id
  WHERE s.entry_id = ?
    AND sl.needs_review = 0
    AND NULLIF(TRIM(sl.term), '') IS NOT NULL
    AND NULLIF(TRIM(sl.definition), '') IS NOT NULL
  GROUP BY lang
  ORDER BY lang
`);

const senseLocalizations = sourceDb.prepare(`
  SELECT lang, term, reading, reading_system, pronunciation, pronunciation_system, definition, source, confidence, needs_review
  FROM sense_localizations
  WHERE sense_id = ?
  ORDER BY needs_review, lang
`);

const exampleCount = sourceDb.prepare(`
  SELECT COUNT(*) AS n
  FROM examples ex
  JOIN senses s ON s.id = ex.sense_id
  WHERE s.entry_id = ?
    AND ex.needs_review = 0
`);

const exampleSamples = sourceDb.prepare(`
  SELECT id, example_order, source_lang, source_text, source_reading, source, confidence, needs_review
  FROM examples
  WHERE sense_id = ?
  ORDER BY needs_review, example_order, id
  LIMIT 2
`);

const exampleLocalizations = sourceDb.prepare(`
  SELECT lang, text, reading, source, confidence, needs_review
  FROM example_localizations
  WHERE example_id = ?
  ORDER BY needs_review, lang
`);

const stats = {
  source_db: path.relative(process.cwd(), sourceDbPath),
  product_db: path.relative(process.cwd(), productDbPath),
  max_rank: maxRank,
  scanned_ranked_entries: sourceEntries.length,
  represented: 0,
  gaps: 0,
  skipped_no_useful_gloss: 0,
  by_lang: {},
  by_status: {}
};

const gaps = [];
for (const entry of sourceEntries) {
  const normalized = normalize(entry.normalized_key || entry.word);
  if (requireSourceScript && !sourceScriptOk(entry.word, entry.source_lang)) {
    stats.skipped_source_script_mismatch = (stats.skipped_source_script_mismatch || 0) + 1;
    continue;
  }
  const directKey = key(entry.source_lang, normalized);
  const wordKey = key(entry.source_lang, normalize(entry.word));
  if (productCoverage.has(directKey) || productCoverage.has(wordKey)) {
    stats.represented++;
    continue;
  }

  const summary = senseSummary.get(entry.id);
  if (!summary?.useful_gloss_count) {
    stats.skipped_no_useful_gloss++;
    continue;
  }

  const sense = firstUsefulSense.get(entry.id);
  const firstSenseLocs = sense ? senseLocalizations.all(sense.id).map(compactLocalization) : [];
  const firstSenseCleanLangs = [
    ...new Set(
      firstSenseLocs
        .filter((row) => !row.needs_review && cleanText(row.term) && cleanText(row.definition))
        .map((row) => row.lang)
    )
  ];
  if (requireFirstSenseComplete && firstSenseCleanLangs.length < 4) {
    stats.skipped_first_sense_incomplete = (stats.skipped_first_sense_incomplete || 0) + 1;
    continue;
  }
  const gloss = cleanText(sense?.gloss_key);
  if (gloss.length < minGlossLength) {
    stats.skipped_no_useful_gloss++;
    continue;
  }

  const locRows = localizationSummary.all(entry.id);
  const cleanLangs = locRows.map((row) => row.lang);
  const gap = {
    source_entry_id: entry.id,
    word: entry.word,
    normalized_key: normalized,
    source_lang: entry.source_lang,
    frequency_rank: entry.frequency_rank,
    source_status: entry.status,
    sense_count: Number(summary.sense_count || 0),
    clean_sense_count: Number(summary.clean_sense_count || 0),
    useful_gloss_count: Number(summary.useful_gloss_count || 0),
    first_sense_id: sense?.id || null,
    first_sense_order: sense?.sense_order || null,
    part_of_speech: cleanText(sense?.part_of_speech) || null,
    gloss_key: gloss,
    gloss_preview: preview(gloss, 180),
    clean_localization_langs: cleanLangs,
    clean_localization_lang_count: cleanLangs.length,
    first_sense_clean_localization_langs: firstSenseCleanLangs,
    first_sense_clean_localization_lang_count: firstSenseCleanLangs.length,
    clean_example_count: Number(exampleCount.get(entry.id)?.n || 0),
    priority_score: scoreGap(entry, summary, cleanLangs)
  };
  if (includeDetails) {
    gap.first_sense_localizations = firstSenseLocs;
    gap.example_samples = exampleSamples.all(sense.id).map((example) => ({
      ...example,
      localizations: exampleLocalizations.all(example.id).map(compactExampleLocalization)
    }));
  }
  gaps.push(gap);
  stats.gaps++;
  stats.by_lang[entry.source_lang] = (stats.by_lang[entry.source_lang] || 0) + 1;
  stats.by_status[entry.status] = (stats.by_status[entry.status] || 0) + 1;
}

sourceDb.close();

gaps.sort(compareGaps);
const selected = gaps.slice(0, limit);
const report = {
  ok: true,
  generated_at: new Date().toISOString(),
  summary: stats,
  selected_count: selected.length,
  selected,
  notes: [
    "This is a read-only gap report; it does not modify either database.",
    "A term is considered covered if product_entries or product_localizations already contain the same normalized form in the same language.",
    "Review selected rows before promoting them into product coverage supplements."
  ]
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

console.log(
  JSON.stringify(
    {
      ok: true,
      out: path.relative(process.cwd(), outPath),
      summary: report.summary,
      selected_count: report.selected_count,
      top: selected.slice(0, 20).map((row) => ({
        rank: row.frequency_rank,
        lang: row.source_lang,
        word: row.word,
        status: row.source_status,
        gloss: row.gloss_preview,
        clean_langs: row.clean_localization_langs.join(",")
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

function scoreGap(entry, summary, cleanLangs) {
  const rankScore = Math.max(0, maxRank + 1 - Number(entry.frequency_rank || maxRank + 1));
  const langScore = cleanLangs.length * 500;
  const cleanSenseScore = Number(summary.clean_sense_count || 0) * 100;
  const statusScore = entry.status === "accepted" ? 1000 : entry.status === "needs_review" ? 250 : 0;
  return rankScore + langScore + cleanSenseScore + statusScore;
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

function compareGaps(a, b) {
  if (b.priority_score !== a.priority_score) return b.priority_score - a.priority_score;
  if (a.frequency_rank !== b.frequency_rank) return a.frequency_rank - b.frequency_rank;
  return a.word.localeCompare(b.word);
}

function key(lang, normalized) {
  return `${lang}\u0000${normalized}`;
}

function normalize(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase();
}

function cleanText(value) {
  return String(value || "").trim();
}

function preview(value, length) {
  const text = cleanText(value).replace(/\s+/g, " ");
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

function compactLocalization(row) {
  return {
    lang: row.lang,
    term: row.term,
    reading: row.reading,
    reading_system: row.reading_system,
    pronunciation: row.pronunciation,
    pronunciation_system: row.pronunciation_system,
    definition: preview(row.definition, 240),
    source: row.source,
    confidence: row.confidence,
    needs_review: Boolean(row.needs_review)
  };
}

function compactExampleLocalization(row) {
  return {
    lang: row.lang,
    text: row.text,
    reading: row.reading,
    source: row.source,
    confidence: row.confidence,
    needs_review: Boolean(row.needs_review)
  };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else {
      result[key] = next;
      index++;
    }
  }
  return result;
}
