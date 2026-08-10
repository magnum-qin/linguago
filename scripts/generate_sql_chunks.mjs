import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = 'data/processed/linguago_d1_ready.db';
const db = new Database(dbPath, { readonly: true });
const outputDir = 'data/processed/sql_chunks';

if (fs.existsSync(outputDir)) {
  fs.rmSync(outputDir, { recursive: true, force: true });
}
fs.mkdirSync(outputDir, { recursive: true });

const tables = ['entries', 'senses', 'definitions', 'examples'];
const MAX_LINES_PER_CHUNK = 20000;

let currentChunk = 1;
let currentLine = 0;
let fileStream = createChunkStream(currentChunk);

function createChunkStream(index) {
  const file = path.join(outputDir, `chunk_${String(index).padStart(3, '0')}.sql`);
  const stream = fs.createWriteStream(file, { encoding: 'utf8' });
  stream.write('PRAGMA defer_foreign_keys=TRUE;\n');
  if (index === 1) {
    // Write schema in the first chunk
    stream.write(`
DROP TABLE IF EXISTS examples;
DROP TABLE IF EXISTS definitions;
DROP TABLE IF EXISTS senses;
DROP TABLE IF EXISTS entries;

CREATE TABLE entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL,
  source_lang TEXT NOT NULL,
  UNIQUE(word, source_lang)
);

CREATE TABLE senses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  sense_order INTEGER NOT NULL,
  pos TEXT,
  gloss TEXT,
  pronunciation TEXT,
  FOREIGN KEY(entry_id) REFERENCES entries(id)
);

CREATE TABLE definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sense_id INTEGER NOT NULL,
  lang TEXT NOT NULL,
  translation TEXT NOT NULL,
  FOREIGN KEY(sense_id) REFERENCES senses(id)
);

CREATE TABLE examples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sense_id INTEGER NOT NULL,
  source_sentence TEXT NOT NULL,
  translation_zh TEXT,
  translation_en TEXT,
  translation_ja TEXT,
  translation_pt TEXT,
  FOREIGN KEY(sense_id) REFERENCES senses(id)
);
`);
  }
  return stream;
}

function escapeSql(str) {
  if (str === null || str === undefined) return 'NULL';
  return "'" + String(str).replace(/'/g, "''") + "'";
}

for (const table of tables) {
  const rows = db.prepare(`SELECT * FROM ${table}`).iterate();
  let cols;

  for (const row of rows) {
    if (!cols) {
      cols = Object.keys(row);
    }

    const values = cols.map((c) => escapeSql(row[c])).join(', ');
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${values});\n`;

    fileStream.write(sql);
    currentLine++;

    if (currentLine >= MAX_LINES_PER_CHUNK) {
      fileStream.end();

      currentChunk++;
      currentLine = 0;
      fileStream = createChunkStream(currentChunk);
    }
  }
}

fileStream.end();

console.log(`Successfully generated ${currentChunk} SQL chunks in ${outputDir}.`);
