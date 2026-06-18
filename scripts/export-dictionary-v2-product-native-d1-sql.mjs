import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || "data/processed/linguago_v2_product_top5000_fused_only_pilot.db");
const outDir = path.resolve(args["out-dir"] || "outputs/d1-v2-product-native-export");
const chunkBytes = Number(args["chunk-bytes"] || 7_000_000);
const limitEntries = Number(args["limit-entries"] || 0);

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
fs.mkdirSync(outDir, { recursive: true });

const db = new Database(dbPath, { readonly: true });
db.pragma("busy_timeout = 30000");

const completeSenseWhere = `
  s.status = 'accepted'
  AND s.id IN (
    SELECT product_sense_id
    FROM product_localizations
    WHERE needs_review = 0
      AND NULLIF(TRIM(term), '') IS NOT NULL
      AND NULLIF(TRIM(definition), '') IS NOT NULL
    GROUP BY product_sense_id
    HAVING COUNT(DISTINCT lang) = 4
  )
`;
const entryLimit =
  limitEntries > 0
    ? `AND e.id IN (
      SELECT DISTINCT e2.id
      FROM product_entries e2
      JOIN product_senses s2 ON s2.product_entry_id = e2.id
      WHERE ${completeSenseWhere.replaceAll("s.", "s2.")}
      ORDER BY e2.frequency_rank IS NULL, e2.frequency_rank, e2.id
      LIMIT ${limitEntries}
    )`
    : "";

const schemaPath = path.join(outDir, "000_schema.sql");
fs.writeFileSync(
  schemaPath,
  [
    "PRAGMA foreign_keys=OFF;",
    "DROP TABLE IF EXISTS v2_example_localizations;",
    "DROP TABLE IF EXISTS v2_examples;",
    "DROP TABLE IF EXISTS v2_sense_localizations;",
    "DROP TABLE IF EXISTS v2_senses;",
    "DROP TABLE IF EXISTS v2_pronunciation_groups;",
    "DROP TABLE IF EXISTS v2_entry_forms;",
    "DROP TABLE IF EXISTS v2_entries;",
    "DROP TABLE IF EXISTS v2_meta;",
    "CREATE TABLE v2_entries (id INTEGER PRIMARY KEY, word TEXT NOT NULL, normalized_key TEXT NOT NULL, source_lang TEXT NOT NULL, script_variant TEXT, frequency_rank INTEGER, status TEXT NOT NULL);",
    "CREATE TABLE v2_entry_forms (id INTEGER PRIMARY KEY, entry_id INTEGER NOT NULL, lang TEXT NOT NULL, form TEXT NOT NULL, form_type TEXT NOT NULL, normalized_form TEXT NOT NULL, source TEXT, confidence REAL);",
    "CREATE TABLE v2_pronunciation_groups (id INTEGER PRIMARY KEY, entry_id INTEGER NOT NULL, lang TEXT NOT NULL, reading TEXT NOT NULL, reading_key TEXT NOT NULL, reading_system TEXT NOT NULL, display_order INTEGER NOT NULL, source TEXT, confidence REAL);",
    "CREATE TABLE v2_senses (id INTEGER PRIMARY KEY, entry_id INTEGER NOT NULL, pronunciation_group_id INTEGER, sense_order INTEGER NOT NULL, part_of_speech TEXT, domain TEXT, register_label TEXT, gloss_key TEXT NOT NULL, source TEXT, confidence REAL);",
    "CREATE TABLE v2_sense_localizations (id INTEGER PRIMARY KEY, sense_id INTEGER NOT NULL, lang TEXT NOT NULL, term TEXT NOT NULL, normalized_term TEXT, reading TEXT, reading_system TEXT, pronunciation TEXT, pronunciation_system TEXT, definition TEXT NOT NULL, usage_note TEXT, source TEXT, confidence REAL);",
    "CREATE TABLE v2_examples (id INTEGER PRIMARY KEY, sense_id INTEGER NOT NULL, example_order INTEGER NOT NULL, source_lang TEXT NOT NULL, source_text TEXT NOT NULL, source_reading TEXT, difficulty TEXT, register_label TEXT, source TEXT, confidence REAL);",
    "CREATE TABLE v2_example_localizations (id INTEGER PRIMARY KEY, example_id INTEGER NOT NULL, lang TEXT NOT NULL, text TEXT NOT NULL, reading TEXT, source TEXT, confidence REAL);",
    "CREATE TABLE v2_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    "CREATE INDEX idx_v2_entries_word ON v2_entries(word);",
    "CREATE INDEX idx_v2_entries_normalized ON v2_entries(normalized_key);",
    "CREATE INDEX idx_v2_entry_forms_normalized ON v2_entry_forms(normalized_form);",
    "CREATE INDEX idx_v2_pronunciation_groups_entry ON v2_pronunciation_groups(entry_id, display_order);",
    "CREATE INDEX idx_v2_pronunciation_groups_key ON v2_pronunciation_groups(lang, reading_key);",
    "CREATE INDEX idx_v2_senses_entry_id ON v2_senses(entry_id);",
    "CREATE INDEX idx_v2_sense_localizations_sense_lang ON v2_sense_localizations(sense_id, lang);",
    "CREATE INDEX idx_v2_sense_localizations_term ON v2_sense_localizations(normalized_term, lang);",
    "CREATE INDEX idx_v2_examples_sense_id ON v2_examples(sense_id);",
    "CREATE INDEX idx_v2_example_localizations_example_lang ON v2_example_localizations(example_id, lang);"
  ].join("\n") + "\n",
  "utf8"
);

let chunkIndex = 1;
let current = "";
let currentBytes = 0;
const chunkPaths = [];
const stats = {
  entries: 0,
  entry_forms: 0,
  pronunciation_groups: 0,
  senses: 0,
  sense_localizations: 0,
  examples: 0,
  example_localizations: 0,
  chunks: 0
};

const PINYIN_TONE_MARKS = Object.freeze({
  ā: { base: "a", tone: "1" },
  á: { base: "a", tone: "2" },
  ǎ: { base: "a", tone: "3" },
  à: { base: "a", tone: "4" },
  ē: { base: "e", tone: "1" },
  é: { base: "e", tone: "2" },
  ě: { base: "e", tone: "3" },
  è: { base: "e", tone: "4" },
  ī: { base: "i", tone: "1" },
  í: { base: "i", tone: "2" },
  ǐ: { base: "i", tone: "3" },
  ì: { base: "i", tone: "4" },
  ō: { base: "o", tone: "1" },
  ó: { base: "o", tone: "2" },
  ǒ: { base: "o", tone: "3" },
  ò: { base: "o", tone: "4" },
  ū: { base: "u", tone: "1" },
  ú: { base: "u", tone: "2" },
  ǔ: { base: "u", tone: "3" },
  ù: { base: "u", tone: "4" },
  ǖ: { base: "v", tone: "1" },
  ǘ: { base: "v", tone: "2" },
  ǚ: { base: "v", tone: "3" },
  ǜ: { base: "v", tone: "4" },
  ü: { base: "v", tone: "" }
});

function append(sql) {
  const bytes = Buffer.byteLength(sql, "utf8");
  if (currentBytes > 0 && currentBytes + bytes > chunkBytes) flush();
  current += sql;
  currentBytes += bytes;
}

function flush() {
  if (!currentBytes) return;
  const file = path.join(outDir, `${String(chunkIndex).padStart(3, "0")}_data.sql`);
  fs.writeFileSync(file, current, "utf8");
  chunkPaths.push(file);
  chunkIndex++;
  current = "";
  currentBytes = 0;
}

const entryRows = db
  .prepare(
    `
    SELECT DISTINCT e.id, e.headword, e.normalized_key, e.primary_lang, e.frequency_rank, e.status
    FROM product_entries e
    JOIN product_senses s ON s.product_entry_id = e.id
    WHERE ${completeSenseWhere}
      ${entryLimit}
    ORDER BY e.frequency_rank IS NULL, e.frequency_rank, e.id
  `
  )
  .all();

const entryIds = new Set(entryRows.map((row) => row.id));
const entryPrimaryLangById = new Map(entryRows.map((row) => [row.id, row.primary_lang]));
const senseIds = new Set();
const exampleIds = new Set();
const entryFormKeys = new Set();
const pronunciationGroupKeys = new Map();
let entryFormId = 1;
let pronunciationGroupId = 1;

for (const row of entryRows) {
  append(`INSERT INTO v2_entries (id, word, normalized_key, source_lang, script_variant, frequency_rank, status) VALUES (${n(row.id)}, ${q(row.headword)}, ${q(row.normalized_key)}, ${q(row.primary_lang)}, NULL, ${n(row.frequency_rank)}, ${q(row.status)});\n`);
  stats.entries++;
  addEntryForm(row.id, row.primary_lang, row.headword, "headword", "product_entry", 1);
}

for (const row of db
  .prepare(
    `
    SELECT
      s.id,
      s.product_entry_id,
      ROW_NUMBER() OVER (
        PARTITION BY s.product_entry_id
        ORDER BY s.sense_order, s.id
      ) AS publish_sense_order,
      s.part_of_speech,
      s.gloss_key,
      s.confidence,
      e.primary_lang,
      src.reading AS source_reading,
      src.reading_system AS source_reading_system,
      src.pronunciation AS source_pronunciation,
      src.pronunciation_system AS source_pronunciation_system,
      zh.term AS zh_term,
      zh.reading AS zh_reading,
      zh.reading_system AS zh_reading_system
    FROM product_senses s
    JOIN product_entries e ON e.id = s.product_entry_id
    LEFT JOIN product_localizations src
      ON src.product_sense_id = s.id
      AND src.lang = e.primary_lang
      AND src.needs_review = 0
    LEFT JOIN product_localizations zh
      ON zh.product_sense_id = s.id
      AND zh.lang = 'zh'
      AND zh.needs_review = 0
    WHERE ${completeSenseWhere}
      ${entryLimit}
    ORDER BY s.product_entry_id, publish_sense_order, s.id
  `
  )
  .iterate()) {
  if (!entryIds.has(row.product_entry_id)) continue;
  senseIds.add(row.id);
  const pronunciationGroup = ensurePronunciationGroup({
    entryId: row.product_entry_id,
    lang: row.primary_lang,
    reading: row.source_reading || row.source_pronunciation,
    readingSystem: row.source_reading_system || row.source_pronunciation_system,
    displayOrder: row.publish_sense_order,
    source: "product-source-localization",
    confidence: row.confidence
  });
  append(`INSERT INTO v2_senses (id, entry_id, pronunciation_group_id, sense_order, part_of_speech, domain, register_label, gloss_key, source, confidence) VALUES (${n(row.id)}, ${n(row.product_entry_id)}, ${n(pronunciationGroup?.id)}, ${n(row.publish_sense_order)}, ${q(cleanPartOfSpeech(row.part_of_speech))}, NULL, NULL, ${q(row.gloss_key)}, 'product-layer', ${n(row.confidence)});\n`);
  stats.senses++;
}

for (const row of db
  .prepare(
    `
    SELECT id, product_sense_id, lang, term, reading, reading_system, pronunciation, pronunciation_system, definition, source, confidence
    FROM product_localizations
    WHERE needs_review = 0
    ORDER BY id
  `
  )
  .iterate()) {
  if (!senseIds.has(row.product_sense_id)) continue;
  append(`INSERT INTO v2_sense_localizations (id, sense_id, lang, term, normalized_term, reading, reading_system, pronunciation, pronunciation_system, definition, usage_note, source, confidence) VALUES (${n(row.id)}, ${n(row.product_sense_id)}, ${q(row.lang)}, ${q(row.term)}, ${q(normalizeKey(row.term))}, ${q(row.reading)}, ${q(row.reading_system)}, ${q(row.pronunciation)}, ${q(row.pronunciation_system)}, ${q(row.definition)}, NULL, ${q(row.source)}, ${n(row.confidence)});\n`);
  stats.sense_localizations++;

  const entryId = db.prepare("SELECT product_entry_id FROM product_senses WHERE id = ?").get(row.product_sense_id)?.product_entry_id;
  if (entryId && entryIds.has(entryId)) {
    addEntryForm(entryId, row.lang, row.term, "localized_term", row.source, row.confidence);
    if (row.lang === entryPrimaryLangById.get(entryId)) {
      addReadingEntryForms(entryId, row.lang, row.reading, row.source, row.confidence);
    }
  }
}

for (const row of db
  .prepare(
    `
    SELECT id, product_sense_id, example_order, source_lang, source_text, source, confidence
    FROM product_examples
    WHERE needs_review = 0
    ORDER BY id
  `
  )
  .iterate()) {
  if (!senseIds.has(row.product_sense_id)) continue;
  exampleIds.add(row.id);
  append(`INSERT INTO v2_examples (id, sense_id, example_order, source_lang, source_text, source_reading, difficulty, register_label, source, confidence) VALUES (${n(row.id)}, ${n(row.product_sense_id)}, ${n(row.example_order)}, ${q(row.source_lang)}, ${q(row.source_text)}, NULL, NULL, NULL, ${q(row.source)}, ${n(row.confidence)});\n`);
  stats.examples++;
}

for (const row of db
  .prepare(
    `
    SELECT id, product_example_id, lang, text, reading, source, confidence
    FROM product_example_localizations
    WHERE needs_review = 0
    ORDER BY id
  `
  )
  .iterate()) {
  if (!exampleIds.has(row.product_example_id)) continue;
  append(`INSERT INTO v2_example_localizations (id, example_id, lang, text, reading, source, confidence) VALUES (${n(row.id)}, ${n(row.product_example_id)}, ${q(row.lang)}, ${q(row.text)}, ${q(row.reading)}, ${q(row.source)}, ${n(row.confidence)});\n`);
  stats.example_localizations++;
}

append(`INSERT INTO v2_meta (key, value) VALUES ('published_at', ${q(new Date().toISOString())});\n`);
append(`INSERT INTO v2_meta (key, value) VALUES ('source_db', ${q(path.relative(process.cwd(), dbPath))});\n`);
append("INSERT INTO v2_meta (key, value) VALUES ('policy', 'product_complete_4_lang_accepted_senses_only');\n");
append(`INSERT INTO v2_meta (key, value) VALUES ('source_tables', 'product_entries,product_senses,product_localizations,product_examples');\n`);
flush();
db.close();
stats.chunks = chunkPaths.length;

const manifest = {
  ok: true,
  db: path.relative(process.cwd(), dbPath),
  out_dir: path.relative(process.cwd(), outDir),
  schema: path.relative(process.cwd(), schemaPath),
  chunks: chunkPaths.map((file) => path.relative(process.cwd(), file)),
  stats
};
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
console.log(JSON.stringify(manifest, null, 2));

function ensurePronunciationGroup({ entryId, lang, reading, readingSystem, displayOrder, source, confidence }) {
  const cleanReading = cleanText(reading);
  if (!cleanReading) return null;
  const readingKey = readingKeyFor(lang, cleanReading);
  if (!readingKey) return null;
  const key = `${entryId}\u0000${lang}\u0000${readingKey}`;
  const existing = pronunciationGroupKeys.get(key);
  if (existing) return existing;

  const group = {
    id: pronunciationGroupId++,
    entryId,
    lang,
    reading: cleanReading,
    readingKey,
    readingSystem: cleanText(readingSystem) || (lang === "zh" ? "pinyin" : "reading"),
    displayOrder
  };
  pronunciationGroupKeys.set(key, group);
  append(`INSERT INTO v2_pronunciation_groups (id, entry_id, lang, reading, reading_key, reading_system, display_order, source, confidence) VALUES (${n(group.id)}, ${n(entryId)}, ${q(lang)}, ${q(group.reading)}, ${q(group.readingKey)}, ${q(group.readingSystem)}, ${n(displayOrder)}, ${q(source)}, ${n(confidence)});\n`);
  addEntryForm(entryId, lang, group.reading, "reading", source, confidence);
  if (group.readingKey !== normalizeKey(group.reading)) {
    addEntryForm(entryId, lang, group.readingKey, "reading_key", source, confidence);
  }
  stats.pronunciation_groups++;
  return group;
}

function addEntryForm(entryId, lang, form, formType, source, confidence) {
  const normalized = normalizeKey(form);
  if (!normalized) return;
  const key = `${entryId}\u0000${lang}\u0000${formType}\u0000${normalized}`;
  if (entryFormKeys.has(key)) return;
  entryFormKeys.add(key);
  append(`INSERT INTO v2_entry_forms (id, entry_id, lang, form, form_type, normalized_form, source, confidence) VALUES (${n(entryFormId++)}, ${n(entryId)}, ${q(lang)}, ${q(form)}, ${q(formType)}, ${q(normalized)}, ${q(source)}, ${n(confidence)});\n`);
  stats.entry_forms++;
}

function addReadingEntryForms(entryId, lang, reading, source, confidence) {
  const cleanReading = cleanText(reading);
  if (!cleanReading) return;
  addEntryForm(entryId, lang, cleanReading, "reading", source, confidence);
  const readingKey = readingKeyFor(lang, cleanReading);
  if (readingKey && readingKey !== normalizeKey(cleanReading)) {
    addEntryForm(entryId, lang, readingKey, "reading_key", source, confidence);
  }
}

function readingKeyFor(lang, reading) {
  const normalized = normalizeKey(reading);
  if (!normalized) return "";
  if (lang !== "zh") return normalized;
  return pinyinToneKey(normalized);
}

function pinyinToneKey(value) {
  return String(value || "")
    .normalize("NFC")
    .split(/(\s+|[^A-Za-z0-9\u00C0-\u024FǖǘǚǜüÜ]+)/u)
    .map((part) => {
      if (!part.trim()) return " ";
      if (!/[A-Za-z0-9\u00C0-\u024FǖǘǚǜüÜ]/u.test(part)) return " ";
      let tone = "";
      let output = "";
      for (const char of part) {
        const mapped = PINYIN_TONE_MARKS[char];
        if (mapped) {
          output += mapped.base;
          tone ||= mapped.tone;
          continue;
        }
        output += char;
      }
      output = output
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .normalize("NFC")
        .toLocaleLowerCase()
        .replace(/[^a-z0-9v]+/g, "");
      if (!output) return "";
      if (/\d/.test(output)) return output;
      return tone ? `${output}${tone}` : output;
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function cleanPartOfSpeech(value) {
  const text = cleanText(value).replace(/^&(.+);$/, "$1").toLowerCase();
  if (!text || text === "n") return text === "n" ? "noun" : "";
  if (text === "v") return "verb";
  if (text === "adj" || text === "a") return "adjective";
  if (text === "adv") return "adverb";
  return text;
}

function cleanText(value) {
  return String(value || "").trim();
}

function q(value) {
  if (value === null || value === undefined || value === "") return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function n(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "NULL";
  return String(number);
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const next = argv[i + 1];
    result[arg.slice(2)] = next && !next.startsWith("--") ? next : "true";
    if (next && !next.startsWith("--")) i++;
  }
  return result;
}
