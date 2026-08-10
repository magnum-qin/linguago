import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || 'data/processed/linguago_v2_full.db');
const outDir = path.resolve(args['out-dir'] || 'output/d1-v2-export');
const chunkBytes = Number(args['chunk-bytes'] || 7_000_000);
const limitEntries = Number(args['limit-entries'] || 0);

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
fs.mkdirSync(outDir, { recursive: true });

const db = new Database(dbPath, { readonly: true });
db.pragma('busy_timeout = 30000');

const publishableEntryStatus = "e.status <> 'deprecated'";
const whereEntryLimit =
  limitEntries > 0
    ? `AND e.id IN (SELECT id FROM entries WHERE status <> 'deprecated' ORDER BY frequency_rank IS NULL, frequency_rank, id LIMIT ${limitEntries})`
    : '';

const schemaPath = path.join(outDir, '000_schema.sql');
fs.writeFileSync(
  schemaPath,
  [
    'PRAGMA foreign_keys=OFF;',
    'DROP TABLE IF EXISTS examples;',
    'DROP TABLE IF EXISTS definitions;',
    'DROP TABLE IF EXISTS senses;',
    'DROP TABLE IF EXISTS entries;',
    'CREATE TABLE entries (id INTEGER PRIMARY KEY, word TEXT NOT NULL, source_lang TEXT NOT NULL, UNIQUE(word, source_lang));',
    'CREATE TABLE senses (id INTEGER PRIMARY KEY, entry_id INTEGER NOT NULL, sense_order INTEGER NOT NULL, pos TEXT, gloss TEXT, pronunciation TEXT, FOREIGN KEY(entry_id) REFERENCES entries(id));',
    'CREATE TABLE definitions (id INTEGER PRIMARY KEY, sense_id INTEGER NOT NULL, lang TEXT NOT NULL, translation TEXT NOT NULL, FOREIGN KEY(sense_id) REFERENCES senses(id));',
    'CREATE TABLE examples (id INTEGER PRIMARY KEY, sense_id INTEGER NOT NULL, source_sentence TEXT NOT NULL, translation_zh TEXT, translation_en TEXT, translation_ja TEXT, translation_pt TEXT, FOREIGN KEY(sense_id) REFERENCES senses(id));',
    'CREATE INDEX idx_entries_word ON entries(word);',
    'CREATE INDEX idx_senses_entry_id ON senses(entry_id);',
    'CREATE INDEX idx_definitions_sense_lang ON definitions(sense_id, lang);',
    'CREATE INDEX idx_examples_sense_id ON examples(sense_id);'
  ].join('\n') + '\n',
  'utf8'
);

let chunkIndex = 1;
let current = '';
let currentBytes = 0;
let insertCount = 0;
const chunkPaths = [];

function append(sql) {
  const bytes = Buffer.byteLength(sql, 'utf8');
  if (currentBytes > 0 && currentBytes + bytes > chunkBytes) flush();
  current += sql;
  currentBytes += bytes;
  insertCount++;
}

function flush() {
  if (!currentBytes) return;
  const file = path.join(outDir, `${String(chunkIndex).padStart(3, '0')}_data.sql`);
  fs.writeFileSync(file, `BEGIN TRANSACTION;\n${current}COMMIT;\n`, 'utf8');
  chunkPaths.push(file);
  chunkIndex++;
  current = '';
  currentBytes = 0;
}

const stats = {
  entries: 0,
  senses: 0,
  definitions: 0,
  examples: 0,
  chunks: 0
};

for (const row of db
  .prepare(
    `
      SELECT e.id, e.word, e.source_lang
      FROM entries e
      WHERE ${publishableEntryStatus}
      ${whereEntryLimit}
      ORDER BY e.id
    `
  )
  .iterate()) {
  append(`INSERT INTO entries (id, word, source_lang) VALUES (${n(row.id)}, ${q(row.word)}, ${q(row.source_lang)});\n`);
  stats.entries++;
}

for (const row of db
  .prepare(
    `
      SELECT
        s.id,
        s.entry_id,
        s.sense_order,
        s.part_of_speech,
        s.gloss_key,
        COALESCE(NULLIF(src.pronunciation, ''), NULLIF(src.reading, '')) AS pronunciation
      FROM senses s
      JOIN entries e ON e.id = s.entry_id
      LEFT JOIN sense_localizations src ON src.sense_id = s.id AND src.lang = e.source_lang AND src.needs_review = 0
      WHERE ${publishableEntryStatus}
      ${whereEntryLimit}
      ORDER BY s.id
    `
  )
  .iterate()) {
  append(
    `INSERT INTO senses (id, entry_id, sense_order, pos, gloss, pronunciation) VALUES (${n(row.id)}, ${n(row.entry_id)}, ${n(row.sense_order)}, ${q(row.part_of_speech)}, ${q(row.gloss_key)}, ${q(row.pronunciation)});\n`
  );
  stats.senses++;
}

for (const row of db
  .prepare(
    `
      SELECT sl.id, sl.sense_id, sl.lang, sl.term
      FROM sense_localizations sl
      JOIN senses s ON s.id = sl.sense_id
      JOIN entries e ON e.id = s.entry_id
      WHERE ${publishableEntryStatus}
        AND sl.needs_review = 0
        AND NULLIF(TRIM(sl.term), '') IS NOT NULL
      ${whereEntryLimit}
      ORDER BY sl.id
    `
  )
  .iterate()) {
  append(
    `INSERT INTO definitions (id, sense_id, lang, translation) VALUES (${n(row.id)}, ${n(row.sense_id)}, ${q(row.lang)}, ${q(row.term)});\n`
  );
  stats.definitions++;
}

for (const row of db
  .prepare(
    `
      SELECT
        ex.id,
        ex.sense_id,
        ex.source_text,
        COALESCE(MAX(CASE WHEN el.lang = 'zh' THEN el.text END), CASE WHEN ex.source_lang = 'zh' THEN ex.source_text END) AS translation_zh,
        COALESCE(MAX(CASE WHEN el.lang = 'en' THEN el.text END), CASE WHEN ex.source_lang = 'en' THEN ex.source_text END) AS translation_en,
        COALESCE(MAX(CASE WHEN el.lang = 'ja' THEN el.text END), CASE WHEN ex.source_lang = 'ja' THEN ex.source_text END) AS translation_ja,
        COALESCE(MAX(CASE WHEN el.lang = 'pt-BR' THEN el.text END), CASE WHEN ex.source_lang = 'pt-BR' THEN ex.source_text END) AS translation_pt
      FROM examples ex
      JOIN senses s ON s.id = ex.sense_id
      JOIN entries e ON e.id = s.entry_id
      LEFT JOIN example_localizations el ON el.example_id = ex.id AND el.needs_review = 0
      WHERE ${publishableEntryStatus}
      ${whereEntryLimit}
      GROUP BY ex.id
      ORDER BY ex.id
    `
  )
  .iterate()) {
  append(
    `INSERT INTO examples (id, sense_id, source_sentence, translation_zh, translation_en, translation_ja, translation_pt) VALUES (${n(row.id)}, ${n(row.sense_id)}, ${q(row.source_text)}, ${q(row.translation_zh)}, ${q(row.translation_en)}, ${q(row.translation_ja)}, ${q(row.translation_pt)});\n`
  );
  stats.examples++;
}

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
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log(JSON.stringify(manifest, null, 2));

function q(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function n(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'NULL';
  return String(Math.trunc(number));
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const next = argv[i + 1];
    result[arg.slice(2)] = next && !next.startsWith('--') ? next : 'true';
    if (next && !next.startsWith('--')) i++;
  }
  return result;
}
