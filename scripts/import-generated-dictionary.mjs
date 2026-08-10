import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';

const INPUT = path.resolve(process.argv[2] || 'data/processed/generated_dictionary.accepted.jsonl');
const DB_FILE = path.resolve(process.argv[3] || 'data/dictionary.sqlite');
const SCHEMA_FILE = path.resolve('data/schema/dictionary.sql');
const SOURCE_CANDIDATES_FILE = path.resolve(
  process.env.DICTIONARY_CANDIDATES_FILE || 'data/processed/frequency_candidates.jsonl'
);
const SQL_WASM = path.resolve('node_modules/sql.js/dist/sql-wasm.wasm');
const LANGS = ['zh', 'en', 'pt-BR', 'ja'];
const sourceLangHints = loadSourceLangHints(INPUT, SOURCE_CANDIDATES_FILE);

if (!fs.existsSync(INPUT)) throw new Error(`Input file not found: ${INPUT}`);
if (!fs.existsSync(SCHEMA_FILE)) throw new Error(`Schema file not found: ${SCHEMA_FILE}`);

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const SQL = await initSqlJs({ wasmBinary: fs.readFileSync(SQL_WASM) });
const db = fs.existsSync(DB_FILE) ? new SQL.Database(fs.readFileSync(DB_FILE)) : new SQL.Database();

db.run(fs.readFileSync(SCHEMA_FILE, 'utf8'));
runMigrations(db);

const rows = fs
  .readFileSync(INPUT, 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const insertEntry = db.prepare(`
  INSERT INTO dictionary_entries (
    entry_type, source_lang, headword, normalized_headword, status,
    quality_score, schema_version, raw_hash, metadata_json, updated_at
  )
  VALUES (?, ?, ?, ?, 'accepted', ?, 1, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(source_lang, normalized_headword) DO UPDATE SET
    headword = excluded.headword,
    status = excluded.status,
    quality_score = excluded.quality_score,
    raw_hash = excluded.raw_hash,
    metadata_json = excluded.metadata_json,
    updated_at = CURRENT_TIMESTAMP
`);

const selectEntry = db.prepare(`
  SELECT id FROM dictionary_entries
  WHERE source_lang = ? AND normalized_headword = ?
`);

const upsertTranslation = db.prepare(`
  INSERT INTO dictionary_translations (
    entry_id, lang, text, normalized_text, confidence, metadata_json, updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(entry_id, lang) DO UPDATE SET
    text = excluded.text,
    normalized_text = excluded.normalized_text,
    confidence = excluded.confidence,
    metadata_json = excluded.metadata_json,
    updated_at = CURRENT_TIMESTAMP
`);

const upsertSense = db.prepare(`
  INSERT INTO dictionary_senses (
    entry_id, sense_order, part_of_speech, gloss_key, register_label,
    domain_label, frequency_rank, confidence, metadata_json, updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(entry_id, sense_order) DO UPDATE SET
    part_of_speech = excluded.part_of_speech,
    gloss_key = excluded.gloss_key,
    register_label = excluded.register_label,
    domain_label = excluded.domain_label,
    frequency_rank = excluded.frequency_rank,
    confidence = excluded.confidence,
    metadata_json = excluded.metadata_json,
    updated_at = CURRENT_TIMESTAMP
`);

const upsertDefinition = db.prepare(`
  INSERT INTO dictionary_definitions (
    entry_id, lang, sense_order, definition, metadata_json, updated_at
  )
  VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(entry_id, lang, sense_order) DO UPDATE SET
    definition = excluded.definition,
    metadata_json = excluded.metadata_json,
    updated_at = CURRENT_TIMESTAMP
`);

const upsertExample = db.prepare(`
  INSERT INTO dictionary_examples (
    entry_id, sense_order, example_order, source_sentence, zh, en, pt_br, ja, metadata_json, updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(entry_id, sense_order, example_order) DO UPDATE SET
    source_sentence = excluded.source_sentence,
    zh = excluded.zh,
    en = excluded.en,
    pt_br = excluded.pt_br,
    ja = excluded.ja,
    metadata_json = excluded.metadata_json,
    updated_at = CURRENT_TIMESTAMP
`);

const upsertPronunciation = db.prepare(`
  INSERT INTO dictionary_pronunciations (
    entry_id, lang, phonetic, audio_text, audio_url, voice, metadata_json, updated_at
  )
  VALUES (?, ?, ?, ?, '', 'default', ?, CURRENT_TIMESTAMP)
  ON CONFLICT(entry_id, lang, voice) DO UPDATE SET
    phonetic = excluded.phonetic,
    audio_text = excluded.audio_text,
    metadata_json = excluded.metadata_json,
    updated_at = CURRENT_TIMESTAMP
`);

db.run('BEGIN');
let imported = 0;
try {
  for (const row of rows) {
    const entry = row.entry;
    if (!entry || entry.type !== 'word') continue;

    const normalized = normalize(entry.normalized_text || entry.source_text);
    const sourceLang = sourceLangFromRow(row, entry.source_text);
    const metadata = {
      imported_from: path.relative(process.cwd(), INPUT),
      validation: {
        quality_score: row.quality_score,
        warnings: row.validation_warnings || []
      }
    };

    insertEntry.run([
      'word',
      sourceLang,
      entry.source_text,
      normalized,
      row.quality_score || 100,
      row.raw_hash || hash(JSON.stringify(entry)),
      JSON.stringify(metadata)
    ]);

    const entryId = getEntryId(selectEntry, sourceLang, normalized);
    if (!entryId) throw new Error(`Failed to read inserted entry id for ${entry.source_text}`);

    for (const lang of LANGS) {
      const translation = entry.translations?.[lang] || {};
      const detail = entry.word_details?.[lang] || {};

      upsertTranslation.run([
        entryId,
        lang,
        translation.text || detail.word || '',
        normalize(translation.text || detail.word || ''),
        0.9,
        JSON.stringify({ source: 'model' })
      ]);

      upsertPronunciation.run([
        entryId,
        lang,
        translation.phonetic || '',
        translation.audio_text || translation.text || '',
        JSON.stringify({ source: 'model' })
      ]);
    }

    const senses = upsertSensesAndDefinitions(entryId, entry, metadata);

    for (const [index, example] of (entry.examples || []).entries()) {
      const senseOrder = Number(example.sense_order || example.sense || senses[0]?.sense_order || 1);
      upsertExample.run([
        entryId,
        Number.isFinite(senseOrder) ? senseOrder : 1,
        index + 1,
        example.sentence || '',
        example.translations?.zh || '',
        example.translations?.en || '',
        example.translations?.['pt-BR'] || '',
        example.translations?.ja || '',
        JSON.stringify({ source: 'model' })
      ]);
    }

    imported += 1;
  }
  db.run('COMMIT');
} catch (error) {
  db.run('ROLLBACK');
  throw error;
} finally {
  insertEntry.free();
  selectEntry.free();
  upsertTranslation.free();
  upsertSense.free();
  upsertDefinition.free();
  upsertExample.free();
  upsertPronunciation.free();
}

function upsertSensesAndDefinitions(entryId, entry, metadata) {
  const senses = Array.isArray(entry.senses) && entry.senses.length ? entry.senses : [senseFromLegacyEntry(entry)];

  const normalizedSenses = [];
  for (const [index, sense] of senses.entries()) {
    const senseOrder = Number(sense.sense_order || sense.order || index + 1);
    const normalizedSenseOrder = Number.isFinite(senseOrder) ? senseOrder : index + 1;
    upsertSense.run([
      entryId,
      normalizedSenseOrder,
      stringOrNull(sense.part_of_speech || sense.pos),
      stringOrNull(sense.gloss_key || sense.key || summarizeSense(sense)),
      stringOrNull(sense.register_label || sense.register),
      stringOrNull(sense.domain_label || sense.domain),
      Number.isFinite(Number(sense.frequency_rank)) ? Number(sense.frequency_rank) : null,
      Number.isFinite(Number(sense.confidence)) ? Number(sense.confidence) : 0.85,
      JSON.stringify({ source: 'model', imported_from: metadata.imported_from })
    ]);

    for (const lang of LANGS) {
      const definition =
        stringOrNull(sense.definitions?.[lang]) ||
        stringOrNull(sense.word_details?.[lang]?.definition) ||
        (normalizedSenseOrder === 1 ? stringOrNull(entry.word_details?.[lang]?.definition) : null) ||
        '';

      upsertDefinition.run([
        entryId,
        lang,
        normalizedSenseOrder,
        definition,
        JSON.stringify({ source: 'model', imported_from: metadata.imported_from })
      ]);
    }

    normalizedSenses.push({ ...sense, sense_order: normalizedSenseOrder });
  }

  return normalizedSenses;
}

function senseFromLegacyEntry(entry) {
  return {
    sense_order: 1,
    part_of_speech: entry.part_of_speech || null,
    gloss_key:
      entry.word_details?.en?.definition ||
      entry.word_details?.zh?.definition ||
      entry.translations?.en?.text ||
      entry.source_text,
    confidence: 0.85
  };
}

function summarizeSense(sense) {
  for (const lang of LANGS) {
    const definition = sense.definitions?.[lang] || sense.word_details?.[lang]?.definition;
    if (definition) return definition;
  }
  return '';
}

function stringOrNull(value) {
  const text = String(value || '').trim();
  return text || null;
}

function runMigrations(db) {
  ensureColumn(db, 'dictionary_examples', 'sense_order', 'INTEGER NOT NULL DEFAULT 1');
  ensureUniqueIndex(
    db,
    'idx_dictionary_examples_entry_sense_example',
    'dictionary_examples',
    'entry_id, sense_order, example_order'
  );
}

function ensureColumn(db, tableName, columnName, columnSql) {
  const columns = tableInfo(db, tableName).map((column) => column.name);
  if (columns.includes(columnName)) return;
  db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnSql}`);
}

function ensureUniqueIndex(db, indexName, tableName, columnsSql) {
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${tableName}(${columnsSql})`);
}

function tableInfo(db, tableName) {
  const statement = db.prepare(`PRAGMA table_info(${tableName})`);
  const rows = [];
  try {
    while (statement.step()) rows.push(statement.getAsObject());
  } finally {
    statement.free();
  }
  return rows;
}

const bytes = db.export();
fs.writeFileSync(DB_FILE, Buffer.from(bytes));
db.close();

console.log(`[done] imported=${imported}/${rows.length}`);
console.log(`[done] wrote ${path.relative(process.cwd(), DB_FILE)}`);

function getEntryId(statement, sourceLang, normalized) {
  statement.bind([sourceLang, normalized]);
  try {
    if (!statement.step()) return null;
    return statement.getAsObject().id;
  } finally {
    statement.reset();
  }
}

function sourceLangFromRow(row, text) {
  if (LANGS.includes(row.source_lang)) return row.source_lang;
  const hinted = sourceLangHints.get(normalize(row.term || text));
  if (LANGS.includes(hinted)) return hinted;
  return detectSourceLang(text);
}

function loadSourceLangHints(inputFile, candidatesFile) {
  const match = path.basename(inputFile).match(/qwen35b-prod-(\d+)-(\d+)\.accepted\.jsonl$/);
  if (!match || !fs.existsSync(candidatesFile)) return new Map();

  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return new Map();

  const hints = new Map();
  const lines = fs.readFileSync(candidatesFile, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const line of lines.slice(start - 1, end)) {
    const candidate = JSON.parse(line);
    if (!LANGS.includes(candidate.source_lang)) continue;
    const key = normalize(candidate.headword || candidate.normalized_headword);
    if (key) hints.set(key, candidate.source_lang);
  }
  return hints;
}

function detectSourceLang(text) {
  if (/[\u3040-\u30ff]/u.test(text)) return 'ja';
  if (/[\u3400-\u9fff]/u.test(text)) return 'zh';
  if (/[ãõáéíóúâêôç]/iu.test(text)) return 'pt-BR';
  if (/^[a-z' -]+$/i.test(text)) return 'en';
  return 'unknown';
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase();
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
