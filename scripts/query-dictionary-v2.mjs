import Database from 'better-sqlite3';
import path from 'node:path';

const DEFAULT_DB = 'data/processed/linguago_v2_pilot.db';
const LANGS = ['zh', 'en', 'pt-BR', 'ja'];

const term = process.argv[2];
const dbPath = path.resolve(process.argv[3] || DEFAULT_DB);

if (!term) {
  console.error('Usage: node scripts/query-dictionary-v2.mjs <term> [db-file]');
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
const normalized = normalize(term);

const entryRows = db
  .prepare(
    `
    SELECT DISTINCT e.id, e.word, e.normalized_key, e.source_lang, e.status
    FROM entries e
    LEFT JOIN entry_forms ef ON ef.entry_id = e.id
    LEFT JOIN senses s ON s.entry_id = e.id
    LEFT JOIN sense_localizations sl ON sl.sense_id = s.id
    WHERE e.normalized_key = ?
       OR ef.normalized_form = ?
       OR lower(sl.term) = ?
    ORDER BY e.id
    LIMIT 10
  `
  )
  .all(normalized, normalized, normalized);

const entries = entryRows.map((entry) => {
  const senses = db
    .prepare(
      `
      SELECT id, sense_order, part_of_speech, domain, register_label, gloss_key, source, confidence, needs_review
      FROM senses
      WHERE entry_id = ?
      ORDER BY sense_order
    `
    )
    .all(entry.id)
    .map((sense) => buildSense(sense));

  return {
    id: entry.id,
    word: entry.word,
    normalized_key: entry.normalized_key,
    source_lang: entry.source_lang,
    status: entry.status,
    translations: primaryTranslations(senses),
    senses
  };
});

console.log(
  JSON.stringify(
    {
      term,
      normalized,
      db: path.relative(process.cwd(), dbPath),
      count: entries.length,
      entries
    },
    null,
    2
  )
);

db.close();

function buildSense(sense) {
  const localizations = byLang(
    db
      .prepare(
        `
        SELECT lang, term, reading, reading_system, pronunciation, pronunciation_system,
               definition, usage_note, source, confidence, needs_review
        FROM sense_localizations
        WHERE sense_id = ?
        ORDER BY lang
      `
      )
      .all(sense.id)
  );

  const examples = db
    .prepare(
      `
      SELECT id, example_order, source_lang, source_text, source_reading, source, confidence, needs_review
      FROM examples
      WHERE sense_id = ?
      ORDER BY example_order
      LIMIT 5
    `
    )
    .all(sense.id)
    .map((example) => ({
      id: example.id,
      example_order: example.example_order,
      source_lang: example.source_lang,
      source_text: example.source_text,
      source_reading: example.source_reading,
      localizations: byLang(
        db
          .prepare(
            `
            SELECT lang, text, reading, source, confidence, needs_review
            FROM example_localizations
            WHERE example_id = ?
            ORDER BY lang
          `
          )
          .all(example.id)
      )
    }));

  return {
    id: sense.id,
    sense_order: sense.sense_order,
    part_of_speech: sense.part_of_speech,
    domain: sense.domain,
    register_label: sense.register_label,
    gloss_key: sense.gloss_key,
    source: sense.source,
    confidence: sense.confidence,
    needs_review: Boolean(sense.needs_review),
    localizations,
    examples
  };
}

function primaryTranslations(senses) {
  const output = emptyLangObject();
  for (const lang of LANGS) {
    for (const sense of senses) {
      if (sense.localizations[lang]) {
        output[lang] = sense.localizations[lang];
        break;
      }
    }
  }
  return output;
}

function byLang(rows) {
  const output = emptyLangObject();
  for (const row of rows) {
    output[row.lang] = Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'lang'));
  }
  return output;
}

function emptyLangObject() {
  return Object.fromEntries(LANGS.map((lang) => [lang, null]));
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase();
}
