import Database from "better-sqlite3";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";
const DEFAULT_PROVIDER = "ollama";
const DEFAULT_MODEL = "qwen3.6:latest";
const DEFAULT_PROMPT_VERSION = "dictionary-v2-product-pronunciation-repair-v1";
const LANGS = ["en", "pt-BR"];

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const provider = args.provider || DEFAULT_PROVIDER;
const model = args.model || DEFAULT_MODEL;
const promptVersion = args["prompt-version"] || DEFAULT_PROMPT_VERSION;
const limit = args.limit ? Number(args.limit) : 0;
const dryRun = args["dry-run"] === "true";
const targetLangs = String(args["target-langs"] || LANGS.join(","))
  .split(",")
  .map((lang) => lang.trim())
  .filter(Boolean);

for (const lang of targetLangs) {
  if (!LANGS.includes(lang)) throw new Error(`Unsupported target language for pronunciation repair: ${lang}`);
}
if (limit && (!Number.isInteger(limit) || limit < 1)) throw new Error(`Invalid --limit: ${args.limit}`);

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 10000");
ensureSchema(db);

const targetLangClause = targetLangs.map(() => "?").join(", ");
const statements = {
  candidates: db.prepare(`
    SELECT
      ps.id AS product_sense_id,
      ps.sense_order,
      ps.part_of_speech,
      ps.gloss_key,
      ps.confidence,
      pe.id AS product_entry_id,
      pe.headword,
      pe.normalized_key,
      pe.primary_lang,
      pe.frequency_rank,
      pe.group_method,
      pl.lang,
      pl.term,
      pl.reading,
      pl.reading_system,
      pl.pronunciation,
      pl.pronunciation_system,
      pl.definition,
      pl.source,
      pl.confidence AS localization_confidence
    FROM product_senses ps
    JOIN product_entries pe ON pe.id = ps.product_entry_id
    JOIN product_localizations pl ON pl.product_sense_id = ps.id
    WHERE ps.status = 'accepted'
      AND pl.needs_review = 0
      AND pl.lang IN (${targetLangClause})
      AND (pl.pronunciation IS NULL OR TRIM(pl.pronunciation) = '')
      AND NULLIF(TRIM(pl.term), '') IS NOT NULL
      AND NULLIF(TRIM(pl.definition), '') IS NOT NULL
    ORDER BY pe.frequency_rank IS NULL, pe.frequency_rank, pe.normalized_key, ps.sense_order, ps.id,
      CASE pl.lang WHEN 'en' THEN 1 ELSE 2 END
    ${limit ? "LIMIT ?" : ""}
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
    LIMIT 1
  `),
  exampleLocalizations: db.prepare(`
    SELECT lang, text, reading, source, confidence
    FROM product_example_localizations
    WHERE product_example_id = ?
    ORDER BY lang
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
  `)
};

const params = [...targetLangs];
if (limit) params.push(limit);
const rows = statements.candidates.all(...params);
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
  jobs.push({
    target_id: row.product_sense_id,
    lang: row.lang,
    provider,
    model,
    prompt_version: promptVersion,
    input_json: JSON.stringify(buildInput(row), null, 2)
  });
}

if (!dryRun && jobs.length) {
  const insert = db.transaction((items) => items.forEach((job) => statements.insertJob.run(job)));
  insert(jobs);
}
stats.jobs_created = jobs.length;

const queuedByLang = db
  .prepare(`
    SELECT lang, COUNT(*) AS count
    FROM product_llm_completion_jobs
    WHERE target_type = 'product_sense_localization'
      AND provider = ?
      AND model = ?
      AND prompt_version = ?
      AND status = 'queued'
    GROUP BY lang
    ORDER BY lang
  `)
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
        definition: row.definition
      }))
    },
    null,
    2
  )
);

db.close();

function buildInput(row) {
  const examples = statements.examples.all(row.product_sense_id).map((example) => ({
    ...example,
    localizations: Object.fromEntries(
      statements.exampleLocalizations.all(example.id).map((item) => [item.lang, item])
    )
  }));
  return {
    task: "repair_product_sense_localization_quality_warning",
    target_lang: row.lang,
    issue: {
      code: "missing_pronunciation",
      current_term: row.term,
      current_definition: row.definition,
      instruction:
        "Keep the target language, term, reading, definition, and sense meaning unchanged. Fill only a natural pronunciation for the current term. Use IPA when confident; otherwise use a clear ASCII respelling. Do not replace the term with a synonym or expansion."
    },
    requirements: {
      output_json_only: true,
      complete_only_target_lang: true,
      replace_existing_target_localization: true,
      keep_same_sense: true,
      preserve_current_term: true,
      preserve_current_definition: true,
      include_pronunciation: true,
      include_example_localizations: true,
      use_brazilian_portuguese_for_pt_BR: row.lang === "pt-BR"
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
    known_localizations: Object.fromEntries(
      statements.localizations.all(row.product_sense_id).map((item) => [
        item.lang,
        {
          term: item.term,
          reading: item.reading,
          pronunciation: item.pronunciation,
          definition: item.definition
        }
      ])
    ),
    current_localization: {
      lang: row.lang,
      term: row.term,
      reading: row.reading,
      reading_system: row.reading_system,
      pronunciation: row.pronunciation,
      pronunciation_system: row.pronunciation_system,
      definition: row.definition
    },
    examples: examples.map((example) => ({
      id: example.id,
      source_lang: example.source_lang,
      source_text: example.source_text,
      localizations: Object.fromEntries(
        Object.entries(example.localizations || {}).map(([lang, item]) => [
          lang,
          { text: item.text, reading: item.reading }
        ])
      )
    })),
    expected_output_schema: outputSchema(row.lang)
  };
}

function outputSchema(lang) {
  return {
    type: "object",
    required: ["sense_localization", "example_localizations"],
    properties: {
      sense_localization: {
        type: "object",
        required: ["lang", "term", "definition", "pronunciation", "pronunciation_system"],
        properties: {
          lang: { const: lang },
          term: { type: "string", minLength: 1 },
          reading: { type: ["string", "null"] },
          reading_system: { type: ["string", "null"] },
          pronunciation: { type: "string", minLength: 1 },
          pronunciation_system: { type: "string", minLength: 1 },
          definition: { type: "string", minLength: 1 },
          usage_note: { type: ["string", "null"] }
        }
      },
      example_localizations: {
        type: "array",
        items: {
          type: "object",
          required: ["example_id", "lang", "text"],
          properties: {
            example_id: { type: "number" },
            lang: { const: lang },
            text: { type: "string", minLength: 1 },
            reading: { type: ["string", "null"] }
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
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) result[key] = "true";
    else {
      result[key] = next;
      index++;
    }
  }
  return result;
}
