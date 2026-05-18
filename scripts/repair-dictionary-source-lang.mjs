import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";

const LANGS = new Set(["zh", "en", "pt-BR", "ja"]);
const DB_FILE = path.resolve(process.argv[2] || "data/dictionary.sqlite");
const INPUT_DIR = path.resolve(process.argv[3] || "incoming");
const SOURCE_CANDIDATES_FILE = path.resolve(process.argv[4] || "data/processed/frequency_candidates.jsonl");
const SQL_WASM = path.resolve("node_modules/sql.js/dist/sql-wasm.wasm");

if (!fs.existsSync(DB_FILE)) throw new Error(`Database not found: ${DB_FILE}`);
if (!fs.existsSync(INPUT_DIR)) throw new Error(`Incoming directory not found: ${INPUT_DIR}`);

const SQL = await initSqlJs({ wasmBinary: fs.readFileSync(SQL_WASM) });
const db = new SQL.Database(fs.readFileSync(DB_FILE));

const files = fs
  .readdirSync(INPUT_DIR)
  .filter((name) => name.endsWith(".accepted.jsonl"))
  .sort()
  .map((name) => path.join(INPUT_DIR, name));
const sourceLangHintsByFile = loadSourceLangHintsByFile(files, SOURCE_CANDIDATES_FILE);

const selectWrong = db.prepare(`
  SELECT id, source_lang, headword
  FROM dictionary_entries
  WHERE normalized_headword = ?
    AND source_lang <> ?
    AND metadata_json LIKE ?
`);

const childTables = [
  "dictionary_senses",
  "dictionary_translations",
  "dictionary_definitions",
  "dictionary_examples",
  "dictionary_pronunciations"
];

const deleteChildren = childTables.map((table) => db.prepare(`DELETE FROM ${table} WHERE entry_id = ?`));
const deleteEntry = db.prepare("DELETE FROM dictionary_entries WHERE id = ?");

let scanned = 0;
let deleted = 0;
const byWrongLang = {};

db.run("BEGIN");
try {
  for (const file of files) {
    const basename = path.basename(file);
    const importedLike = `%${basename}%`;
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);

    for (const line of lines) {
      const row = JSON.parse(line);
      if (!row.entry) continue;
      const sourceLang = LANGS.has(row.source_lang)
        ? row.source_lang
        : sourceLangHintsByFile.get(basename)?.get(normalize(row.term || row.entry.source_text));
      if (!LANGS.has(sourceLang)) continue;

      const normalized = normalize(row.entry.normalized_text || row.entry.source_text);
      if (!normalized) continue;
      scanned += 1;

      selectWrong.bind([normalized, sourceLang, importedLike]);
      try {
        while (selectWrong.step()) {
          const wrong = selectWrong.getAsObject();
          for (const statement of deleteChildren) statement.run([wrong.id]);
          deleteEntry.run([wrong.id]);
          deleted += 1;
          byWrongLang[wrong.source_lang] = (byWrongLang[wrong.source_lang] || 0) + 1;
        }
      } finally {
        selectWrong.reset();
      }
    }
  }

  db.run("COMMIT");
} catch (error) {
  db.run("ROLLBACK");
  throw error;
} finally {
  selectWrong.free();
  deleteEntry.free();
  for (const statement of deleteChildren) statement.free();
}

fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
db.close();

console.log(JSON.stringify({ scanned, deleted, by_wrong_lang: byWrongLang }, null, 2));

function normalize(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase();
}

function loadSourceLangHintsByFile(files, candidatesFile) {
  const out = new Map();
  if (!fs.existsSync(candidatesFile)) return out;

  const candidateLines = fs.readFileSync(candidatesFile, "utf8").split(/\r?\n/).filter(Boolean);
  for (const file of files) {
    const basename = path.basename(file);
    const match = basename.match(/qwen35b-prod-(\d+)-(\d+)\.accepted\.jsonl$/);
    if (!match) continue;

    const start = Number(match[1]);
    const end = Number(match[2]);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) continue;

    const hints = new Map();
    for (const line of candidateLines.slice(start - 1, end)) {
      const candidate = JSON.parse(line);
      if (!LANGS.has(candidate.source_lang)) continue;
      const key = normalize(candidate.headword || candidate.normalized_headword);
      if (key) hints.set(key, candidate.source_lang);
    }
    out.set(basename, hints);
  }
  return out;
}
