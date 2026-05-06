import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";

const term = process.argv[2];
const DB_FILE = path.resolve(process.argv[3] || "data/dictionary.sqlite");
const SQL_WASM = path.resolve("node_modules/sql.js/dist/sql-wasm.wasm");
const LANGS = ["zh", "en", "pt-BR", "ja"];

if (!term) {
  console.error("Usage: node scripts/query-dictionary.mjs <term> [db-file]");
  process.exit(1);
}

if (!fs.existsSync(DB_FILE)) {
  throw new Error(`Database file not found: ${DB_FILE}`);
}

const SQL = await initSqlJs({ wasmBinary: fs.readFileSync(SQL_WASM) });
const db = new SQL.Database(fs.readFileSync(DB_FILE));
const normalized = normalize(term);

const directMatches = selectAll(
  db,
  `
    SELECT id, 'headword' AS match_type
    FROM dictionary_entries
    WHERE normalized_headword = ?
      AND status = 'accepted'
    ORDER BY quality_score DESC, id ASC
    LIMIT 10
  `,
  [normalized]
);

const translationMatches = selectAll(
  db,
  `
    SELECT e.id, 'translation:' || t.lang AS match_type
    FROM dictionary_translations t
    JOIN dictionary_entries e ON e.id = t.entry_id
    WHERE t.normalized_text = ?
      AND e.status = 'accepted'
    ORDER BY e.quality_score DESC, e.id ASC
    LIMIT 10
  `,
  [normalized]
);

const matchById = new Map();
for (const match of [...directMatches, ...translationMatches]) {
  if (!matchById.has(match.id)) matchById.set(match.id, match.match_type);
}

const entries = [...matchById.entries()].map(([id, matchType]) => ({
  ...selectOne(
    db,
    `
      SELECT id, entry_type, source_lang, headword, normalized_headword, status, quality_score
      FROM dictionary_entries
      WHERE id = ?
    `,
    [id]
  ),
  match_type: matchType
}));

const result = entries.map((entry) => {
  const definitions = selectAll(
    db,
    "SELECT sense_order, lang, definition FROM dictionary_definitions WHERE entry_id = ? ORDER BY sense_order, lang",
    [entry.id]
  );
  const definitionsBySense = new Map();
  for (const definition of definitions) {
    if (!definitionsBySense.has(definition.sense_order)) {
      definitionsBySense.set(definition.sense_order, Object.fromEntries(LANGS.map((lang) => [lang, null])));
    }
    definitionsBySense.get(definition.sense_order)[definition.lang] = { definition: definition.definition };
  }

  const senses = selectAll(
    db,
    `
      SELECT sense_order, part_of_speech, gloss_key, register_label, domain_label,
             frequency_rank, confidence, metadata_json
      FROM dictionary_senses
      WHERE entry_id = ?
      ORDER BY sense_order
    `,
    [entry.id]
  ).map((sense) => ({
    ...sense,
    definitions: definitionsBySense.get(sense.sense_order) || Object.fromEntries(LANGS.map((lang) => [lang, null]))
  }));

  return {
    ...entry,
    senses,
    translations: byLang(
      selectAll(
        db,
        "SELECT lang, text, confidence FROM dictionary_translations WHERE entry_id = ?",
        [entry.id]
      )
    ),
    definitions: byLang(
      definitions
        .filter((definition) => definition.sense_order === 1)
        .map(({ lang, definition }) => ({ lang, definition }))
    ),
    pronunciations: byLang(
      selectAll(
        db,
        "SELECT lang, phonetic, audio_text FROM dictionary_pronunciations WHERE entry_id = ?",
        [entry.id]
      )
    ),
    examples: selectAll(
      db,
      "SELECT sense_order, example_order, source_sentence, zh, en, pt_br AS 'pt-BR', ja FROM dictionary_examples WHERE entry_id = ? ORDER BY sense_order, example_order",
      [entry.id]
    )
  };
});

console.log(JSON.stringify({ term, normalized, count: result.length, entries: result }, null, 2));
db.close();

function selectAll(db, sql, params = []) {
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

function selectOne(db, sql, params = []) {
  return selectAll(db, sql, params)[0] || null;
}

function byLang(rows) {
  const output = Object.fromEntries(LANGS.map((lang) => [lang, null]));
  for (const row of rows) {
    output[row.lang] = Object.fromEntries(Object.entries(row).filter(([key]) => key !== "lang"));
  }
  return output;
}

function normalize(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase();
}
