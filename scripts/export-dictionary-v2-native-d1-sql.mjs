import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || 'data/processed/linguago_v2_full.db');
const outDir = path.resolve(args['out-dir'] || 'output/d1-v2-native-export');
const chunkBytes = Number(args['chunk-bytes'] || 7_000_000);
const limitEntries = Number(args['limit-entries'] || 0);

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
fs.mkdirSync(outDir, { recursive: true });

const db = new Database(dbPath, { readonly: true });
db.pragma('busy_timeout = 30000');

const completeSenseWhere = `
  s.needs_review = 0
  AND s.id IN (
    SELECT sense_id
    FROM sense_localizations
    WHERE needs_review = 0
      AND NULLIF(TRIM(term), '') IS NOT NULL
      AND NULLIF(TRIM(definition), '') IS NOT NULL
    GROUP BY sense_id
    HAVING COUNT(DISTINCT lang) = 4
  )
`;
const entryLimit =
  limitEntries > 0
    ? `AND e.id IN (
      SELECT DISTINCT e2.id
      FROM entries e2
      JOIN senses s2 ON s2.entry_id = e2.id
      WHERE e2.status <> 'deprecated'
        AND s2.needs_review = 0
        AND s2.id IN (
          SELECT sense_id
          FROM sense_localizations
          WHERE needs_review = 0
            AND NULLIF(TRIM(term), '') IS NOT NULL
            AND NULLIF(TRIM(definition), '') IS NOT NULL
          GROUP BY sense_id
          HAVING COUNT(DISTINCT lang) = 4
        )
      ORDER BY e2.frequency_rank IS NULL, e2.frequency_rank, e2.id
      LIMIT ${limitEntries}
    )`
    : '';

const schemaPath = path.join(outDir, '000_schema.sql');
fs.writeFileSync(
  schemaPath,
  [
    'PRAGMA foreign_keys=OFF;',
    'DROP TABLE IF EXISTS v2_example_localizations;',
    'DROP TABLE IF EXISTS v2_examples;',
    'DROP TABLE IF EXISTS v2_sense_localizations;',
    'DROP TABLE IF EXISTS v2_senses;',
    'DROP TABLE IF EXISTS v2_entry_forms;',
    'DROP TABLE IF EXISTS v2_entries;',
    'DROP TABLE IF EXISTS v2_meta;',
    'CREATE TABLE v2_entries (id INTEGER PRIMARY KEY, word TEXT NOT NULL, normalized_key TEXT NOT NULL, source_lang TEXT NOT NULL, script_variant TEXT, frequency_rank INTEGER, status TEXT NOT NULL);',
    'CREATE TABLE v2_entry_forms (id INTEGER PRIMARY KEY, entry_id INTEGER NOT NULL, lang TEXT NOT NULL, form TEXT NOT NULL, form_type TEXT NOT NULL, normalized_form TEXT NOT NULL, source TEXT, confidence REAL);',
    'CREATE TABLE v2_senses (id INTEGER PRIMARY KEY, entry_id INTEGER NOT NULL, sense_order INTEGER NOT NULL, part_of_speech TEXT, domain TEXT, register_label TEXT, gloss_key TEXT NOT NULL, source TEXT, confidence REAL);',
    'CREATE TABLE v2_sense_localizations (id INTEGER PRIMARY KEY, sense_id INTEGER NOT NULL, lang TEXT NOT NULL, term TEXT NOT NULL, normalized_term TEXT, reading TEXT, reading_system TEXT, pronunciation TEXT, pronunciation_system TEXT, definition TEXT NOT NULL, usage_note TEXT, source TEXT, confidence REAL);',
    'CREATE TABLE v2_examples (id INTEGER PRIMARY KEY, sense_id INTEGER NOT NULL, example_order INTEGER NOT NULL, source_lang TEXT NOT NULL, source_text TEXT NOT NULL, source_reading TEXT, difficulty TEXT, register_label TEXT, source TEXT, confidence REAL);',
    'CREATE TABLE v2_example_localizations (id INTEGER PRIMARY KEY, example_id INTEGER NOT NULL, lang TEXT NOT NULL, text TEXT NOT NULL, reading TEXT, source TEXT, confidence REAL);',
    'CREATE TABLE v2_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);',
    'CREATE INDEX idx_v2_entries_word ON v2_entries(word);',
    'CREATE INDEX idx_v2_entries_normalized ON v2_entries(normalized_key);',
    'CREATE INDEX idx_v2_entry_forms_normalized ON v2_entry_forms(normalized_form);',
    'CREATE INDEX idx_v2_senses_entry_id ON v2_senses(entry_id);',
    'CREATE INDEX idx_v2_sense_localizations_sense_lang ON v2_sense_localizations(sense_id, lang);',
    'CREATE INDEX idx_v2_sense_localizations_term ON v2_sense_localizations(normalized_term, lang);',
    'CREATE INDEX idx_v2_examples_sense_id ON v2_examples(sense_id);',
    'CREATE INDEX idx_v2_example_localizations_example_lang ON v2_example_localizations(example_id, lang);'
  ].join('\n') + '\n',
  'utf8'
);

let chunkIndex = 1;
let current = '';
let currentBytes = 0;
const chunkPaths = [];
const stats = {
  entries: 0,
  entry_forms: 0,
  senses: 0,
  sense_localizations: 0,
  examples: 0,
  example_localizations: 0,
  chunks: 0
};

function append(sql) {
  const bytes = Buffer.byteLength(sql, 'utf8');
  if (currentBytes > 0 && currentBytes + bytes > chunkBytes) flush();
  current += sql;
  currentBytes += bytes;
}

function flush() {
  if (!currentBytes) return;
  const file = path.join(outDir, `${String(chunkIndex).padStart(3, '0')}_data.sql`);
  fs.writeFileSync(file, current, 'utf8');
  chunkPaths.push(file);
  chunkIndex++;
  current = '';
  currentBytes = 0;
}

const entryRows = db
  .prepare(
    `
  SELECT DISTINCT e.id, e.word, e.normalized_key, e.source_lang, e.script_variant, e.frequency_rank, e.status
  FROM entries e
  JOIN senses s ON s.entry_id = e.id
  WHERE e.status <> 'deprecated'
    AND ${completeSenseWhere}
    ${entryLimit}
  ORDER BY e.frequency_rank IS NULL, e.frequency_rank, e.id
`
  )
  .all();
const entryIds = new Set(entryRows.map((row) => row.id));
const senseIds = new Set();
const exampleIds = new Set();

for (const row of entryRows) {
  append(
    `INSERT INTO v2_entries (id, word, normalized_key, source_lang, script_variant, frequency_rank, status) VALUES (${n(row.id)}, ${q(row.word)}, ${q(row.normalized_key)}, ${q(row.source_lang)}, ${q(row.script_variant)}, ${n(row.frequency_rank)}, ${q(row.status)});\n`
  );
  stats.entries++;
}

for (const row of db
  .prepare(
    `
  SELECT id, entry_id, lang, form, form_type, normalized_form, source, confidence
  FROM entry_forms
  ORDER BY id
`
  )
  .iterate()) {
  if (!entryIds.has(row.entry_id)) continue;
  append(
    `INSERT INTO v2_entry_forms (id, entry_id, lang, form, form_type, normalized_form, source, confidence) VALUES (${n(row.id)}, ${n(row.entry_id)}, ${q(row.lang)}, ${q(row.form)}, ${q(row.form_type)}, ${q(row.normalized_form)}, ${q(row.source)}, ${n(row.confidence)});\n`
  );
  stats.entry_forms++;
}

for (const row of db
  .prepare(
    `
  SELECT
    s.id,
    s.entry_id,
    ROW_NUMBER() OVER (
      PARTITION BY s.entry_id
      ORDER BY s.sense_order, s.id
    ) AS publish_sense_order,
    s.part_of_speech,
    s.domain,
    s.register_label,
    s.gloss_key,
    s.source,
    s.confidence
  FROM senses s
  JOIN entries e ON e.id = s.entry_id
  WHERE e.status <> 'deprecated'
    AND ${completeSenseWhere}
    ${entryLimit}
  ORDER BY s.entry_id, publish_sense_order, s.id
`
  )
  .iterate()) {
  senseIds.add(row.id);
  append(
    `INSERT INTO v2_senses (id, entry_id, sense_order, part_of_speech, domain, register_label, gloss_key, source, confidence) VALUES (${n(row.id)}, ${n(row.entry_id)}, ${n(row.publish_sense_order)}, ${q(row.part_of_speech)}, ${q(row.domain)}, ${q(row.register_label)}, ${q(row.gloss_key)}, ${q(row.source)}, ${n(row.confidence)});\n`
  );
  stats.senses++;
}

for (const row of db
  .prepare(
    `
  SELECT id, sense_id, lang, term, normalized_term, reading, reading_system, pronunciation, pronunciation_system, definition, usage_note, source, confidence
  FROM sense_localizations
  WHERE needs_review = 0
  ORDER BY id
`
  )
  .iterate()) {
  if (!senseIds.has(row.sense_id)) continue;
  append(
    `INSERT INTO v2_sense_localizations (id, sense_id, lang, term, normalized_term, reading, reading_system, pronunciation, pronunciation_system, definition, usage_note, source, confidence) VALUES (${n(row.id)}, ${n(row.sense_id)}, ${q(row.lang)}, ${q(row.term)}, ${q(row.normalized_term)}, ${q(row.reading)}, ${q(row.reading_system)}, ${q(row.pronunciation)}, ${q(row.pronunciation_system)}, ${q(row.definition)}, ${q(row.usage_note)}, ${q(row.source)}, ${n(row.confidence)});\n`
  );
  stats.sense_localizations++;
}

for (const row of db
  .prepare(
    `
  SELECT id, sense_id, example_order, source_lang, source_text, source_reading, difficulty, register_label, source, confidence
  FROM examples
  WHERE needs_review = 0
  ORDER BY id
`
  )
  .iterate()) {
  if (!senseIds.has(row.sense_id)) continue;
  exampleIds.add(row.id);
  append(
    `INSERT INTO v2_examples (id, sense_id, example_order, source_lang, source_text, source_reading, difficulty, register_label, source, confidence) VALUES (${n(row.id)}, ${n(row.sense_id)}, ${n(row.example_order)}, ${q(row.source_lang)}, ${q(row.source_text)}, ${q(row.source_reading)}, ${q(row.difficulty)}, ${q(row.register_label)}, ${q(row.source)}, ${n(row.confidence)});\n`
  );
  stats.examples++;
}

for (const row of db
  .prepare(
    `
  SELECT id, example_id, lang, text, reading, source, confidence
  FROM example_localizations
  WHERE needs_review = 0
  ORDER BY id
`
  )
  .iterate()) {
  if (!exampleIds.has(row.example_id)) continue;
  append(
    `INSERT INTO v2_example_localizations (id, example_id, lang, text, reading, source, confidence) VALUES (${n(row.id)}, ${n(row.example_id)}, ${q(row.lang)}, ${q(row.text)}, ${q(row.reading)}, ${q(row.source)}, ${n(row.confidence)});\n`
  );
  stats.example_localizations++;
}

append(`INSERT INTO v2_meta (key, value) VALUES ('published_at', ${q(new Date().toISOString())});\n`);
append(`INSERT INTO v2_meta (key, value) VALUES ('source_db', ${q(path.relative(process.cwd(), dbPath))});\n`);
append(`INSERT INTO v2_meta (key, value) VALUES ('policy', 'complete_4_lang_accepted_senses_only');\n`);
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
  return String(number);
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
