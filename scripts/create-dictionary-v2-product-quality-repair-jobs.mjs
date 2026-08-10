import Database from 'better-sqlite3';
import path from 'node:path';

const DEFAULT_DB = 'data/processed/linguago_v2_product_top5000_fused_only_pilot.db';
const DEFAULT_PROVIDER = 'ollama';
const DEFAULT_MODEL = 'qwen3.6:latest';
const DEFAULT_PROMPT_VERSION = 'dictionary-v2-product-quality-repair-v2';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const provider = args.provider || DEFAULT_PROVIDER;
const model = args.model || DEFAULT_MODEL;
const promptVersion = args['prompt-version'] || DEFAULT_PROMPT_VERSION;
const limit = args.limit ? Number(args.limit) : 0;
const dryRun = args['dry-run'] === 'true';
const targetLangs = String(args['target-langs'] || 'zh,ja')
  .split(',')
  .map((lang) => lang.trim())
  .filter(Boolean);

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 10000');
ensureSchema(db);

const statements = {
  candidates: db.prepare(`
    SELECT
      ps.id AS product_sense_id,
      pl.lang,
      pl.id AS localization_id,
      pl.term,
      pl.reading,
      pl.definition,
      pe.frequency_rank,
      pe.normalized_key
    FROM product_localizations pl
    JOIN product_senses ps ON ps.id = pl.product_sense_id
    JOIN product_entries pe ON pe.id = ps.product_entry_id
    WHERE pl.needs_review = 0
      AND pl.lang IN (${targetLangs.map(() => '?').join(', ')})
      AND (
        (pl.lang = 'zh' AND (pl.term GLOB '*[ぁ-んァ-ン]*' OR pl.definition GLOB '*[ぁ-んァ-ン]*'))
        OR
        (pl.lang = 'ja' AND pl.term GLOB '*[A-Za-z]*' AND pl.term NOT GLOB '*[ぁ-んァ-ン一-龯]*')
      )
    ORDER BY pe.frequency_rank IS NULL, pe.frequency_rank, pe.normalized_key, ps.sense_order, ps.id, pl.lang
    ${limit ? 'LIMIT ?' : ''}
  `),
  existingJob: db.prepare(`
    SELECT id, status
    FROM product_llm_completion_jobs
    WHERE target_type = 'product_sense_localization'
      AND target_id = ?
      AND lang = ?
      AND provider = ?
      AND model = ?
      AND prompt_version = ?
      AND status IN ('queued', 'running', 'accepted', 'needs_review')
  `),
  insertJob: db.prepare(`
    INSERT INTO product_llm_completion_jobs
      (target_type, target_id, lang, provider, model, prompt_version, status, input_json)
    VALUES
      ('product_sense_localization', @target_id, @lang, @provider, @model, @prompt_version, 'queued', @input_json)
  `),
  sense: db.prepare(`
    SELECT
      ps.id AS product_sense_id,
      ps.sense_order,
      ps.part_of_speech,
      ps.gloss_key,
      ps.status,
      ps.confidence,
      pe.id AS product_entry_id,
      pe.headword,
      pe.normalized_key,
      pe.primary_lang,
      pe.frequency_rank,
      pe.group_method
    FROM product_senses ps
    JOIN product_entries pe ON pe.id = ps.product_entry_id
    WHERE ps.id = ?
  `),
  sourceLinks: db.prepare(`
    SELECT source_lang, source_word, source_frequency_rank, match_method, confidence
    FROM product_sense_source_links
    WHERE product_sense_id = ?
    ORDER BY source_frequency_rank IS NULL, source_frequency_rank, source_lang, source_sense_id, id
  `),
  localizations: db.prepare(`
    SELECT lang, term, reading, reading_system, pronunciation, pronunciation_system, definition, source, confidence
    FROM product_localizations
    WHERE product_sense_id = ?
    ORDER BY lang
  `),
  examples: db.prepare(`
    SELECT id, example_order, source_lang, source_text, source, confidence
    FROM product_examples
    WHERE product_sense_id = ?
    ORDER BY example_order
    LIMIT 3
  `),
  exampleLocalizations: db.prepare(`
    SELECT lang, text, reading, source, confidence
    FROM product_example_localizations
    WHERE product_example_id = ?
    ORDER BY lang
  `)
};

const rows = limit ? statements.candidates.all(...targetLangs, limit) : statements.candidates.all(...targetLangs);
const jobs = [];
const stats = {
  candidates: rows.length,
  jobs_created: 0,
  skipped_existing_job: 0,
  dry_run: dryRun
};

for (const row of rows) {
  const existing = statements.existingJob.get(row.product_sense_id, row.lang, provider, model, promptVersion);
  if (existing) {
    stats.skipped_existing_job++;
    continue;
  }
  const sense = statements.sense.get(row.product_sense_id);
  if (!sense) continue;
  jobs.push({
    target_id: row.product_sense_id,
    lang: row.lang,
    provider,
    model,
    prompt_version: promptVersion,
    input_json: JSON.stringify(buildInput({ sense, lang: row.lang, issue: issueFor(row) }), null, 2)
  });
}

if (!dryRun && jobs.length) {
  const insert = db.transaction((items) => items.forEach((job) => statements.insertJob.run(job)));
  insert(jobs);
}
stats.jobs_created = jobs.length;

const queuedByLang = db
  .prepare(
    `
    SELECT lang, COUNT(*) AS count
    FROM product_llm_completion_jobs
    WHERE target_type = 'product_sense_localization'
      AND provider = ?
      AND model = ?
      AND prompt_version = ?
      AND status = 'queued'
    GROUP BY lang
    ORDER BY lang
  `
  )
  .all(provider, model, promptVersion);

console.log(
  JSON.stringify(
    {
      ok: true,
      db: path.relative(process.cwd(), dbPath),
      provider,
      model,
      prompt_version: promptVersion,
      target_langs: targetLangs,
      stats,
      queued_by_lang: queuedByLang,
      sample_candidates: rows.slice(0, 10).map((row) => ({
        sense_id: row.product_sense_id,
        lang: row.lang,
        term: row.term,
        reading: row.reading,
        definition: row.definition
      }))
    },
    null,
    2
  )
);

db.close();

function buildInput({ sense, lang, issue }) {
  const knownLocalizations = Object.fromEntries(
    statements.localizations.all(sense.product_sense_id).map((row) => [row.lang, row])
  );
  const examples = statements.examples.all(sense.product_sense_id).map((example) => ({
    ...example,
    localizations: Object.fromEntries(statements.exampleLocalizations.all(example.id).map((row) => [row.lang, row]))
  }));

  return {
    task: 'repair_product_sense_localization_quality_warning',
    target_lang: lang,
    issue,
    requirements: {
      output_json_only: true,
      complete_only_target_lang: true,
      replace_existing_target_localization: true,
      keep_same_sense: true,
      use_brazilian_portuguese_for_pt_BR: lang === 'pt-BR',
      include_reading: lang === 'zh' || lang === 'ja',
      include_pronunciation: lang === 'en' || lang === 'pt-BR',
      include_example_localizations: true,
      zh_term_must_be_simplified_chinese_without_kana: lang === 'zh',
      ja_term_must_be_natural_japanese_not_plain_english: lang === 'ja'
    },
    product_entry: {
      id: sense.product_entry_id,
      headword: sense.headword,
      normalized_key: sense.normalized_key,
      primary_lang: sense.primary_lang,
      frequency_rank: sense.frequency_rank,
      group_method: sense.group_method
    },
    product_sense: {
      id: sense.product_sense_id,
      sense_order: sense.sense_order,
      part_of_speech: sense.part_of_speech,
      gloss_key: sense.gloss_key,
      confidence: sense.confidence
    },
    source_links: statements.sourceLinks.all(sense.product_sense_id).slice(0, 4),
    known_localizations: compactLocalizations(knownLocalizations),
    examples: examples.slice(0, 1).map((example) => ({
      id: example.id,
      source_lang: example.source_lang,
      source_text: example.source_text,
      localizations: compactLocalizations(example.localizations || {})
    })),
    expected_output_schema: outputSchema(lang)
  };
}

function compactLocalizations(localizations) {
  return Object.fromEntries(
    Object.entries(localizations).map(([lang, value]) => [
      lang,
      {
        term: value.term,
        reading: value.reading,
        pronunciation: value.pronunciation,
        definition: value.definition
      }
    ])
  );
}

function issueFor(row) {
  if (row.lang === 'zh') {
    return {
      code: 'zh_term_or_definition_contains_japanese_kana',
      current_term: row.term,
      current_reading: row.reading,
      current_definition: row.definition,
      instruction:
        'Rewrite the Chinese localization as a natural Simplified Chinese dictionary term and Chinese definition. Do not copy Japanese kana into the Chinese term. For Japanese particles or auxiliary forms, use a concise Chinese grammatical label such as 条件助词, 接续助词, 过去助动词, 引用助词, or the best matching Chinese explanation.'
    };
  }
  return {
    code: 'ja_term_is_plain_latin_text',
    current_term: row.term,
    current_reading: row.reading,
    current_definition: row.definition,
    instruction:
      'Rewrite the Japanese localization as a natural Japanese dictionary term. Do not leave the term as plain English unless it is an official acronym/proper name such as WHO. For English function words, use a Japanese gloss such as 〜のために, 意志, 義務, or another concise Japanese equivalent.'
  };
}

function outputSchema(lang) {
  const required = ['lang', 'term', 'definition'];
  const readingSchema = { type: ['string', 'null'] };
  const readingSystemSchema = { type: ['string', 'null'] };
  const pronunciationSchema = { type: ['string', 'null'] };
  const pronunciationSystemSchema = { type: ['string', 'null'] };

  if (lang === 'zh' || lang === 'ja') {
    required.push('reading', 'reading_system');
    readingSchema.type = 'string';
    readingSchema.minLength = 1;
    readingSystemSchema.type = 'string';
    readingSystemSchema.minLength = 1;
  }
  if (lang === 'en' || lang === 'pt-BR') {
    required.push('pronunciation', 'pronunciation_system');
    pronunciationSchema.type = 'string';
    pronunciationSchema.minLength = 1;
    pronunciationSystemSchema.type = 'string';
    pronunciationSystemSchema.minLength = 1;
  }

  return {
    type: 'object',
    required: ['sense_localization', 'example_localizations'],
    properties: {
      sense_localization: {
        type: 'object',
        required,
        properties: {
          lang: { const: lang },
          term: { type: 'string', minLength: 1 },
          reading: readingSchema,
          reading_system: readingSystemSchema,
          pronunciation: pronunciationSchema,
          pronunciation_system: pronunciationSystemSchema,
          definition: { type: 'string', minLength: 1 },
          usage_note: { type: ['string', 'null'] }
        }
      },
      example_localizations: {
        type: 'array',
        items: {
          type: 'object',
          required: ['example_id', 'lang', 'text'],
          properties: {
            example_id: { type: 'number' },
            lang: { const: lang },
            text: { type: 'string', minLength: 1 },
            reading: { type: ['string', 'null'] }
          }
        }
      }
    }
  };
}

function ensureSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS product_llm_completion_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK (target_type IN ('product_sense_localization')),
      target_id INTEGER NOT NULL,
      lang TEXT NOT NULL CHECK (lang IN ('zh', 'en', 'pt-BR', 'ja')),
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'accepted', 'needs_review', 'failed')),
      input_json TEXT NOT NULL,
      output_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (target_id) REFERENCES product_senses(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_product_llm_jobs_pick
      ON product_llm_completion_jobs(provider, model, prompt_version, status, lang, id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_llm_jobs_unique_active
      ON product_llm_completion_jobs(target_type, target_id, lang, provider, model, prompt_version)
      WHERE status IN ('queued', 'running', 'accepted', 'needs_review');
  `);
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
