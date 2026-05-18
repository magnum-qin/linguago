import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";

const DB_FILE = path.resolve(process.argv[2] || "data/dictionary.sqlite");
const ENTRY_ID_OR_HEADWORD = process.argv[3];
const SQL_WASM = path.resolve("node_modules/sql.js/dist/sql-wasm.wasm");

if (!ENTRY_ID_OR_HEADWORD) throw new Error("Usage: node scripts/dump-dictionary-entry.mjs <db> <entry-id-or-headword>");
if (!fs.existsSync(DB_FILE)) throw new Error(`Database not found: ${DB_FILE}`);

const SQL = await initSqlJs({ wasmBinary: fs.readFileSync(SQL_WASM) });
const db = new SQL.Database(fs.readFileSync(DB_FILE));
const entry = Number.isFinite(Number(ENTRY_ID_OR_HEADWORD))
  ? one("SELECT * FROM dictionary_entries WHERE id = ?", [Number(ENTRY_ID_OR_HEADWORD)])
  : one(
      "SELECT * FROM dictionary_entries WHERE normalized_headword = ? OR headword = ? ORDER BY quality_score DESC LIMIT 1",
      [normalize(ENTRY_ID_OR_HEADWORD), ENTRY_ID_OR_HEADWORD]
    );

if (!entry) {
  console.log(JSON.stringify({ found: false, query: ENTRY_ID_OR_HEADWORD }, null, 2));
  process.exit(1);
}

const senses = all(
  `
    SELECT sense_order, part_of_speech, gloss_key
    FROM dictionary_senses
    WHERE entry_id = ?
    ORDER BY sense_order
  `,
  [entry.id]
).map((sense) => ({
  ...sense,
  definitions: Object.fromEntries(
    all(
      `
        SELECT lang, definition
        FROM dictionary_definitions
        WHERE entry_id = ? AND sense_order = ?
        ORDER BY lang
      `,
      [entry.id, sense.sense_order]
    ).map((row) => [row.lang, row.definition])
  ),
  examples: all(
    `
      SELECT example_order, source_sentence, zh, en, pt_br AS "pt-BR", ja
      FROM dictionary_examples
      WHERE entry_id = ? AND sense_order = ?
      ORDER BY example_order
    `,
    [entry.id, sense.sense_order]
  )
}));

console.log(JSON.stringify({ entry, senses }, null, 2));

function one(sql, params = []) {
  const rows = all(sql, params);
  return rows[0] || null;
}

function all(sql, params = []) {
  const statement = db.prepare(sql);
  statement.bind(params);
  const rows = [];
  try {
    while (statement.step()) rows.push(statement.getAsObject());
  } finally {
    statement.free();
  }
  return rows;
}

function normalize(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase();
}
