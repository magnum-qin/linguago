import Database from 'better-sqlite3';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db');
const provider = args.provider || 'ollama';
const model = args.model || 'qwen3.6:latest';
const promptVersion = args['prompt-version'] || 'dictionary-v2-product-needs-review-repair-v2';
const limit = args.limit ? Number(args.limit) : 0;
const dryRun = args['dry-run'] === 'true';
const errorLike = args['error-like'] || '';

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000');
ensureSchema(db);

const statements = {
  candidates: db.prepare(`
    SELECT
      j.id AS source_job_id,
      j.target_id AS product_sense_id,
      j.lang,
      j.input_json,
      j.output_json,
      j.error,
      ps.sense_order,
      ps.part_of_speech,
      ps.gloss_key,
      ps.confidence,
      pe.id AS product_entry_id,
      pe.headword,
      pe.normalized_key,
      pe.primary_lang,
      pe.frequency_rank,
      pe.group_method
    FROM product_llm_completion_jobs j
    JOIN product_senses ps ON ps.id = j.target_id
    JOIN product_entries pe ON pe.id = ps.product_entry_id
    WHERE j.target_type = 'product_sense_localization'
      AND j.status = 'needs_review'
      AND (? = '' OR j.error LIKE ?)
      AND NOT EXISTS (
        SELECT 1
        FROM product_llm_completion_jobs accepted_job
        WHERE accepted_job.target_type = j.target_type
          AND accepted_job.target_id = j.target_id
          AND accepted_job.lang = j.lang
          AND accepted_job.status = 'accepted'
      )
      AND j.id = (
        SELECT MAX(latest_job.id)
        FROM product_llm_completion_jobs latest_job
        WHERE latest_job.target_type = j.target_type
          AND latest_job.target_id = j.target_id
          AND latest_job.lang = j.lang
          AND latest_job.status = 'needs_review'
      )
    ORDER BY pe.frequency_rank IS NULL, pe.frequency_rank, j.lang, j.id
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
    LIMIT 2
  `),
  exampleLocalizations: db.prepare(`
    SELECT lang, text, reading, source, confidence
    FROM product_example_localizations
    WHERE product_example_id = ?
    ORDER BY lang
  `)
};

const candidateParams = [`%${errorLike}%`];
const candidates = limit
  ? statements.candidates.all(errorLike, ...candidateParams, limit)
  : statements.candidates.all(errorLike, ...candidateParams);
const jobs = [];
const stats = {
  db: path.relative(process.cwd(), dbPath),
  candidates: candidates.length,
  jobs_created: 0,
  skipped_existing_job: 0,
  skipped_bad_json: 0,
  dry_run: dryRun
};

for (const row of candidates) {
  if (statements.existingJob.get(row.product_sense_id, row.lang, provider, model, promptVersion)) {
    stats.skipped_existing_job++;
    continue;
  }
  const originalInput = parseMaybeJson(row.input_json);
  const badOutput = parseMaybeJson(row.output_json);
  if (!originalInput || !badOutput?.sense_localization) {
    stats.skipped_bad_json++;
    continue;
  }
  jobs.push({
    target_id: row.product_sense_id,
    lang: row.lang,
    provider,
    model,
    prompt_version: promptVersion,
    input_json: JSON.stringify(buildInput({ row, originalInput, badOutput }), null, 2)
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
      provider,
      model,
      prompt_version: promptVersion,
      error_like: errorLike,
      stats,
      queued_by_lang: queuedByLang
    },
    null,
    2
  )
);
db.close();

function buildInput({ row, originalInput, badOutput }) {
  const examples = statements.examples.all(row.product_sense_id).map((example) => ({
    ...example,
    localizations: Object.fromEntries(statements.exampleLocalizations.all(example.id).map((item) => [item.lang, item]))
  }));
  const knownLocalizations = Object.fromEntries(
    statements.localizations.all(row.product_sense_id).map((item) => [item.lang, item])
  );

  return {
    task: 'repair_product_sense_localization_quality_warning',
    target_lang: row.lang,
    issue: {
      code: 'needs_review_validation_error',
      validation_error: row.error,
      current_term: badOutput.sense_localization.term,
      current_reading: badOutput.sense_localization.reading,
      current_definition: badOutput.sense_localization.definition,
      bad_output: badOutput.sense_localization,
      instruction: repairInstruction(row.lang, row.error, row.primary_lang)
    },
    requirements: {
      output_json_only: true,
      complete_only_target_lang: true,
      replace_existing_target_localization: true,
      keep_same_sense: true,
      include_reading: row.lang === 'zh' || row.lang === 'ja',
      include_pronunciation: row.lang === 'en' || row.lang === 'pt-BR',
      use_brazilian_portuguese_for_pt_BR: row.lang === 'pt-BR'
    },
    product_entry: {
      id: row.product_entry_id,
      headword: row.headword,
      normalized_key: row.normalized_key,
      primary_lang: row.primary_lang,
      frequency_rank: row.frequency_rank,
      group_method: row.group_method
    },
    product_sense: {
      id: row.product_sense_id,
      sense_order: row.sense_order,
      part_of_speech: row.part_of_speech,
      gloss_key: row.gloss_key,
      confidence: row.confidence
    },
    source_links: statements.sourceLinks.all(row.product_sense_id).slice(0, 4),
    known_localizations: compactLocalizations(knownLocalizations),
    examples: examples.map((example) => ({
      id: example.id,
      source_lang: example.source_lang,
      source_text: example.source_text,
      localizations: compactLocalizations(example.localizations || {})
    })),
    previous_input_excerpt: {
      source_links: originalInput.source_links,
      product_sense: originalInput.product_sense
    },
    expected_output_schema: outputSchema(row.lang)
  };
}

function repairInstruction(lang, error, primaryLang) {
  const sourceTermRule =
    primaryLang === lang
      ? 'If the target language is also the source language, keep the term exactly as the source word and put the sense distinction in the definition.'
      : '';
  const termLanguageRule = /term language/i.test(error)
    ? [
        'The term field must be a concise dictionary headword in the target language.',
        "Do not put explanations, romanization, source-language notes, 'alternative form of', 'variant of', or 'used in' phrases in the term field.",
        'Move cross-reference details into the definition field, and choose the closest plain target-language headword when a lexical equivalent exists.'
      ].join(' ')
    : '';
  if (lang === 'ja') {
    return [
      'Rewrite as natural Japanese.',
      'The term must contain Japanese kana or kanji.',
      'Do not copy an English, Portuguese, pinyin, or romaji term as the Japanese term unless it is a widely used proper noun or acronym.',
      'The reading must contain kana, not romaji.',
      'The definition must be Japanese, not English.',
      termLanguageRule,
      sourceTermRule,
      `Fix this validation error: ${error}`
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (lang === 'zh') {
    return [
      'Rewrite as natural Simplified Chinese.',
      'The term must contain Chinese characters and no Japanese kana.',
      'Do not copy Latin words, romaji, pinyin-only strings, or Japanese source forms as the Chinese term.',
      'The reading must be pinyin in Latin letters.',
      'The definition must be Chinese, not English or Japanese.',
      termLanguageRule,
      sourceTermRule,
      `Fix this validation error: ${error}`
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (lang === 'pt-BR') {
    return [
      'Rewrite as natural Brazilian Portuguese.',
      'The term must not contain Chinese or Japanese characters.',
      'Do not include source-language characters or cross-reference wording in the Portuguese term.',
      'The pronunciation must match the Portuguese term.',
      termLanguageRule,
      sourceTermRule,
      `Fix this validation error: ${error}`
    ]
      .filter(Boolean)
      .join(' ');
  }
  return [
    'Rewrite as natural English.',
    'The term must be an English dictionary headword or short English phrase.',
    "Do not include Chinese/Japanese characters, pinyin, romanization, 'alternative form of', 'variant of', or 'used in' in the term field.",
    termLanguageRule,
    sourceTermRule,
    `Fix this validation error: ${error}`
  ]
    .filter(Boolean)
    .join(' ');
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
          definition: { type: 'string', minLength: 1 }
        }
      },
      example_localizations: { type: 'array' }
    }
  };
}

function parseMaybeJson(value) {
  try {
    return JSON.parse(String(value || ''));
  } catch {
    return null;
  }
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
    const key = arg.slice(2);
    const next = argv[i + 1];
    result[key] = next && !next.startsWith('--') ? next : 'true';
    if (next && !next.startsWith('--')) i++;
  }
  return result;
}
