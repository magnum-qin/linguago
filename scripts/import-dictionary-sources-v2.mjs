import Database from "better-sqlite3";
import csvParser from "csv-parser";
import { XMLParser } from "fast-xml-parser";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import zlib from "node:zlib";

const LANGUAGE_CODES = new Set(["en", "zh", "ja", "pt-BR"]);
const DEFAULT_DB = "data/processed/linguago_v2_staging.db";
const DEFAULT_SOURCES = ["ecdict", "kaikki-zh", "cedict", "jmdict"];

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const sourceNames = (args.sources || DEFAULT_SOURCES.join(","))
  .split(",")
  .map((source) => source.trim())
  .filter(Boolean);
const limit = args.limit ? Number(args.limit) : 0;

if (!fs.existsSync(dbPath)) {
  throw new Error(`Database not found. Run scripts/init-dictionary-v2.mjs first: ${dbPath}`);
}

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

const statements = {
  upsertSource: db.prepare(`
    INSERT INTO dictionary_sources (source_key, source_name, source_url, license, metadata_json)
    VALUES (@source_key, @source_name, @source_url, @license, @metadata_json)
    ON CONFLICT(source_key) DO UPDATE SET
      source_name = excluded.source_name,
      source_url = excluded.source_url,
      license = excluded.license,
      metadata_json = excluded.metadata_json
  `),
  getSource: db.prepare("SELECT id FROM dictionary_sources WHERE source_key = ?"),
  insertEntry: db.prepare(`
    INSERT OR IGNORE INTO source_entries
      (source_id, source_entry_key, word, normalized_key, lang, raw_json)
    VALUES
      (@source_id, @source_entry_key, @word, @normalized_key, @lang, @raw_json)
  `),
  getEntry: db.prepare(`
    SELECT id FROM source_entries
    WHERE source_id = ? AND source_entry_key = ?
  `),
  insertSense: db.prepare(`
    INSERT OR IGNORE INTO source_senses
      (source_entry_id, source_sense_key, sense_order, part_of_speech, domain, register_label, gloss, raw_json)
    VALUES
      (@source_entry_id, @source_sense_key, @sense_order, @part_of_speech, @domain, @register_label, @gloss, @raw_json)
  `)
};

const importers = {
  ecdict: importEcDict,
  "kaikki-zh": importKaikkiChinese,
  cedict: importCcCedict,
  jmdict: importJmDict
};

const summary = [];
for (const sourceName of sourceNames) {
  const importer = importers[sourceName];
  if (!importer) {
    throw new Error(`Unknown source "${sourceName}". Valid sources: ${Object.keys(importers).join(", ")}`);
  }
  const started = performance.now();
  const result = await importer({ limit });
  summary.push({
    source: sourceName,
    ...result,
    ms: Math.round(performance.now() - started)
  });
}

db.close();
console.log(JSON.stringify({ ok: true, db: path.relative(process.cwd(), dbPath), summary }, null, 2));

async function importEcDict({ limit }) {
  const sourceId = ensureSource({
    source_key: "ecdict",
    source_name: "ECDICT",
    source_url: "https://github.com/skywind3000/ECDICT",
    license: "Verify upstream license before redistribution",
    metadata_json: JSON.stringify({ file: "data/raw/ecdict.csv" })
  });
  const file = path.resolve("data/raw/ecdict.csv");
  if (!fs.existsSync(file)) return { skipped: true, reason: "missing data/raw/ecdict.csv" };

  let entries = 0;
  let senses = 0;
  const insertBatch = db.transaction((rows) => {
    for (const row of rows) {
      const word = cleanText(row.word);
      if (!word) continue;
      const sourceEntryKey = word;
      const raw = compactJson(row);
      insertSourceEntry({
        source_id: sourceId,
        source_entry_key: sourceEntryKey,
        word,
        normalized_key: normalizeKey(word),
        lang: "en",
        raw_json: raw
      });
      const entryId = getSourceEntryId(sourceId, sourceEntryKey);
      const glosses = splitEcDictDefinitions(row.definition, row.translation);
      glosses.forEach((gloss, index) => {
        insertSourceSense({
          source_entry_id: entryId,
          source_sense_key: `${sourceEntryKey}:${index + 1}`,
          sense_order: index + 1,
          part_of_speech: cleanText(row.pos),
          gloss,
          raw_json: compactJson({
            definition: row.definition || "",
            translation: row.translation || "",
            phonetic: row.phonetic || "",
            pos: row.pos || ""
          })
        });
        senses++;
      });
      entries++;
    }
  });

  let batch = [];
  await new Promise((resolve, reject) => {
    fs.createReadStream(file)
      .pipe(csvParser())
      .on("data", (row) => {
        if (limit && entries + batch.length >= limit) return;
        batch.push(row);
        if (batch.length >= 500) {
          insertBatch(batch);
          batch = [];
        }
      })
      .on("error", reject)
      .on("end", () => {
        if (batch.length) insertBatch(batch);
        resolve();
      });
  });

  return { entries, senses };
}

async function importKaikkiChinese({ limit }) {
  const sourceId = ensureSource({
    source_key: "kaikki-zh",
    source_name: "Kaikki Chinese Wiktionary extraction",
    source_url: "https://kaikki.org/dictionary/Chinese/",
    license: "CC BY-SA; verify upstream metadata before redistribution",
    metadata_json: JSON.stringify({ file: "data/raw/kaikki_Chinese.jsonl" })
  });
  const file = path.resolve("data/raw/kaikki_Chinese.jsonl");
  if (!fs.existsSync(file)) return { skipped: true, reason: "missing data/raw/kaikki_Chinese.jsonl" };

  let entries = 0;
  let senses = 0;
  const stream = fs.createReadStream(file, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const insertOne = db.transaction((item) => {
    const word = cleanText(item.word);
    if (!word) return;
    const sourceEntryKey = item.id || `${word}:${item.pos || "unknown"}:${entries + 1}`;
    insertSourceEntry({
      source_id: sourceId,
      source_entry_key: sourceEntryKey,
      word,
      normalized_key: normalizeKey(word),
      lang: "zh",
      raw_json: compactJson(item)
    });
    const entryId = getSourceEntryId(sourceId, sourceEntryKey);
    const itemSenses = Array.isArray(item.senses) ? item.senses : [];
    itemSenses.forEach((sense, index) => {
      insertSourceSense({
        source_entry_id: entryId,
        source_sense_key: sense.id || `${sourceEntryKey}:${index + 1}`,
        sense_order: index + 1,
        part_of_speech: cleanText(sense.pos || item.pos),
        domain: firstNonEmpty([...(sense.topics || []), ...(sense.categories || []).map((c) => c.name)]),
        register_label: firstNonEmpty([...(sense.tags || []), ...(sense.raw_tags || [])]),
        gloss: firstNonEmpty(sense.glosses || sense.raw_glosses || []),
        raw_json: compactJson(sense)
      });
      senses++;
    });
    entries++;
  });

  for await (const line of rl) {
    if (limit && entries >= limit) break;
    if (!line.trim()) continue;
    try {
      insertOne(JSON.parse(line));
    } catch {
      // Keep malformed source rows out of staging; raw source is still available on disk.
    }
  }

  rl.close();
  stream.destroy();
  return { entries, senses };
}

async function importCcCedict({ limit }) {
  const sourceId = ensureSource({
    source_key: "cc-cedict",
    source_name: "CC-CEDICT",
    source_url: "https://cc-cedict.org/wiki/",
    license: "CC BY-SA 4.0",
    metadata_json: JSON.stringify({ file: "data/raw/CC-CEDICT.txt.gz" })
  });
  const file = path.resolve("data/raw/CC-CEDICT.txt.gz");
  if (!fs.existsSync(file)) return { skipped: true, reason: "missing data/raw/CC-CEDICT.txt.gz" };

  let entries = 0;
  let senses = 0;
  const rl = readline.createInterface({
    input: fs.createReadStream(file).pipe(zlib.createGunzip()),
    crlfDelay: Infinity
  });
  const insertOne = db.transaction((parsed) => {
    const sourceEntryKey = `${parsed.traditional}|${parsed.simplified}`;
    insertSourceEntry({
      source_id: sourceId,
      source_entry_key: sourceEntryKey,
      word: parsed.simplified,
      normalized_key: normalizeKey(parsed.simplified),
      lang: "zh",
      raw_json: compactJson(parsed)
    });
    const entryId = getSourceEntryId(sourceId, sourceEntryKey);
    parsed.definitions.forEach((definition, index) => {
      insertSourceSense({
        source_entry_id: entryId,
        source_sense_key: `${sourceEntryKey}:${index + 1}`,
        sense_order: index + 1,
        part_of_speech: null,
        gloss: definition,
        raw_json: compactJson({ definition, pinyin: parsed.pinyin })
      });
      senses++;
    });
    entries++;
  });

  for await (const line of rl) {
    if (limit && entries >= limit) break;
    const parsed = parseCedictLine(line);
    if (parsed) insertOne(parsed);
  }
  rl.close();
  return { entries, senses };
}

async function importJmDict({ limit }) {
  const sourceId = ensureSource({
    source_key: "jmdict",
    source_name: "JMdict English",
    source_url: "https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project",
    license: "CC BY-SA 4.0",
    metadata_json: JSON.stringify({ file: "data/raw/JMdict_e.gz" })
  });
  const file = path.resolve("data/raw/JMdict_e.gz");
  if (!fs.existsSync(file)) return { skipped: true, reason: "missing data/raw/JMdict_e.gz" };

  const xml = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    processEntities: false,
    trimValues: true
  });
  const parsed = parser.parse(xml);
  const sourceEntries = asArray(parsed?.JMdict?.entry);
  let entries = 0;
  let senses = 0;
  const insertMany = db.transaction((items) => {
    for (const item of items) {
      if (limit && entries >= limit) break;
      const word = cleanText(firstText(asArray(item.k_ele).map((k) => k.keb)) || firstText(asArray(item.r_ele).map((r) => r.reb)));
      if (!word) continue;
      const sourceEntryKey = String(item.ent_seq || word);
      insertSourceEntry({
        source_id: sourceId,
        source_entry_key: sourceEntryKey,
        word,
        normalized_key: normalizeKey(word),
        lang: "ja",
        raw_json: compactJson(item)
      });
      const entryId = getSourceEntryId(sourceId, sourceEntryKey);
      asArray(item.sense).forEach((sense, index) => {
        insertSourceSense({
          source_entry_id: entryId,
          source_sense_key: `${sourceEntryKey}:${index + 1}`,
          sense_order: index + 1,
          part_of_speech: firstText(asArray(sense.pos)),
          gloss: firstText(asArray(sense.gloss).map((gloss) => (typeof gloss === "string" ? gloss : gloss?.["#text"]))),
          raw_json: compactJson(sense)
        });
        senses++;
      });
      entries++;
    }
  });
  insertMany(sourceEntries);
  return { entries, senses };
}

function ensureSource(source) {
  statements.upsertSource.run(source);
  return statements.getSource.get(source.source_key).id;
}

function insertSourceEntry(entry) {
  if (!LANGUAGE_CODES.has(entry.lang)) throw new Error(`Invalid source entry lang: ${entry.lang}`);
  statements.insertEntry.run(entry);
}

function getSourceEntryId(sourceId, sourceEntryKey) {
  return statements.getEntry.get(sourceId, sourceEntryKey).id;
}

function insertSourceSense(sense) {
  statements.insertSense.run({
    part_of_speech: null,
    domain: null,
    register_label: null,
    ...sense,
    gloss: cleanText(sense.gloss) || "",
    raw_json: sense.raw_json || "{}"
  });
}

function splitEcDictDefinitions(definition, translation) {
  const source = cleanText(definition) || cleanText(translation) || "";
  if (!source) return ["missing definition"];
  return source
    .split(/\n+/u)
    .map(cleanText)
    .filter(Boolean)
    .slice(0, 12);
}

function parseCedictLine(line) {
  if (!line || line.startsWith("#")) return null;
  const match = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/$/u);
  if (!match) return null;
  const definitions = match[4].split("/").map(cleanText).filter(Boolean);
  if (!definitions.length) return null;
  return {
    traditional: match[1],
    simplified: match[2],
    pinyin: match[3],
    definitions
  };
}

function normalizeKey(value) {
  return cleanText(value).normalize("NFKC").toLocaleLowerCase();
}

function cleanText(value) {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

function compactJson(value) {
  return JSON.stringify(value ?? {});
}

function firstNonEmpty(values) {
  return firstText(values);
}

function firstText(values) {
  for (const value of asArray(values)) {
    const text = cleanText(value);
    if (text) return text;
  }
  return null;
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      result[arg.slice(2)] = argv[++i];
    }
  }
  return result;
}
