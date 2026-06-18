import Database from "better-sqlite3";
import path from "node:path";

const LANGS = ["zh", "en", "pt-BR", "ja"];
const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_fused_only_pilot.db";
const DEFAULT_PROVIDER = "ollama";
const DEFAULT_MODEL = "qwen3.6:latest";
const DEFAULT_PROMPT_VERSION = "dictionary-v2-product-localization-v1";

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const provider = args.provider || DEFAULT_PROVIDER;
const model = args.model || DEFAULT_MODEL;
const promptVersion = args["prompt-version"] || DEFAULT_PROMPT_VERSION;
const limit = args.limit ? Number(args.limit) : 0;
const dryRun = args["dry-run"] === "true";
const includeExamples = args["include-examples"] !== "false";
const repairNeedsReview = args["repair-needs-review"] === "true";
const completeOnly = args["complete-only"] === "true";
const excludeReviewLocalizations = args["exclude-review-localizations"] === "true";
const sourceStatuses = String(
  args["source-statuses"] || (repairNeedsReview ? "ready_for_llm,needs_review" : "ready_for_llm")
)
  .split(",")
  .map((status) => status.trim())
  .filter(Boolean);
const targetLangs = String(args["target-langs"] || LANGS.join(","))
  .split(",")
  .map((lang) => lang.trim())
  .filter(Boolean);

for (const lang of targetLangs) {
  if (!LANGS.includes(lang)) throw new Error(`Unknown target language: ${lang}`);
}
if (limit && (!Number.isInteger(limit) || limit < 1)) throw new Error(`Invalid --limit: ${args.limit}`);
for (const status of sourceStatuses) {
  if (!["ready_for_llm", "needs_review", "draft_fused", "draft_single_source", "accepted"].includes(status)) {
    throw new Error(`Unknown source status: ${status}`);
  }
}
const targetLangCte = targetLangs.map((_, index) => (index === 0 ? "SELECT ? AS lang" : "UNION ALL SELECT ?")).join(" ");
const sourceStatusClause = sourceStatuses.map(() => "?").join(", ");

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 10000");
ensureSchema(db);

const statements = {
  candidates: db.prepare(`
    WITH target_langs(lang) AS (${targetLangCte})
    SELECT ps.id AS product_sense_id, tl.lang
    FROM product_senses ps
    JOIN product_entries pe ON pe.id = ps.product_entry_id
    CROSS JOIN target_langs tl
    LEFT JOIN product_localizations pl ON pl.product_sense_id = ps.id AND pl.lang = tl.lang
    WHERE ps.status IN (${sourceStatusClause})
      AND ${repairNeedsReview ? "pl.id IS NOT NULL AND pl.needs_review = 1" : "pl.id IS NULL"}
      AND (
        ? = 0
        OR (
          SELECT COUNT(DISTINCT pl_all.lang)
          FROM product_localizations pl_all
          WHERE pl_all.product_sense_id = ps.id
        ) = 4
      )
      AND (
        ? = 0
        OR NOT EXISTS (
          SELECT 1
          FROM product_localizations pl_review
          WHERE pl_review.product_sense_id = ps.id
            AND pl_review.needs_review = 1
        )
      )
    ORDER BY
      pe.frequency_rank IS NULL,
      pe.frequency_rank,
      pe.normalized_key,
      ps.sense_order,
      CASE tl.lang WHEN 'en' THEN 1 WHEN 'zh' THEN 2 WHEN 'ja' THEN 3 ELSE 4 END
    ${limit ? "LIMIT ?" : ""}
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
  `),
  existingJob: db.prepare(`
    SELECT id
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

const stats = {
  mode: repairNeedsReview ? "repair_needs_review" : "missing_localizations",
  scanned_candidates: 0,
  skipped_existing_job: 0,
  jobs_created: 0,
  dry_run: dryRun,
  include_examples: includeExamples
};

const candidates = limit
  ? statements.candidates.all(
      ...targetLangs,
      ...sourceStatuses,
      completeOnly ? 1 : 0,
      excludeReviewLocalizations ? 1 : 0,
      limit
    )
  : statements.candidates.all(
      ...targetLangs,
      ...sourceStatuses,
      completeOnly ? 1 : 0,
      excludeReviewLocalizations ? 1 : 0
    );
const jobs = [];

for (const candidate of candidates) {
  stats.scanned_candidates++;
  if (
    statements.existingJob.get(
      candidate.product_sense_id,
      candidate.lang,
      provider,
      model,
      promptVersion
    )
  ) {
    stats.skipped_existing_job++;
    continue;
  }
  const sense = statements.sense.get(candidate.product_sense_id);
  if (!sense) continue;
  jobs.push({
    target_id: candidate.product_sense_id,
    lang: candidate.lang,
    provider,
    model,
    prompt_version: promptVersion,
    input_json: JSON.stringify(buildInput({ sense, lang: candidate.lang }), null, 2)
  });
}

if (!dryRun) {
  const insert = db.transaction((rows) => rows.forEach((job) => statements.insertJob.run(job)));
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
      source_statuses: sourceStatuses,
      stats,
      queued_by_lang: queuedByLang
    },
    null,
    2
  )
);
db.close();

function buildInput({ sense, lang }) {
  const knownLocalizations = Object.fromEntries(
    statements.localizations.all(sense.product_sense_id).map((row) => [row.lang, row])
  );
  const examples = includeExamples
    ? statements.examples.all(sense.product_sense_id).map((example) => ({
        ...example,
        localizations: Object.fromEntries(
          statements.exampleLocalizations.all(example.id).map((row) => [row.lang, row])
        )
      }))
    : [];

  return {
    task: "complete_product_sense_localization",
    target_lang: lang,
    requirements: {
      output_json_only: true,
      complete_only_target_lang: true,
      preserve_existing_languages: true,
      keep_same_sense: true,
      use_brazilian_portuguese_for_pt_BR: lang === "pt-BR",
      include_reading: lang === "zh" || lang === "ja",
      include_pronunciation: lang === "en" || lang === "pt-BR",
      include_example_localizations: includeExamples
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
    source_links: statements.sourceLinks.all(sense.product_sense_id),
    known_localizations: knownLocalizations,
    examples,
    expected_output_schema: outputSchema(lang)
  };
}

function outputSchema(lang) {
  const required = ["lang", "term", "definition"];
  const readingSchema = { type: ["string", "null"] };
  const readingSystemSchema = { type: ["string", "null"] };
  const pronunciationSchema = { type: ["string", "null"] };
  const pronunciationSystemSchema = { type: ["string", "null"] };

  if (lang === "zh" || lang === "ja") {
    required.push("reading", "reading_system");
    readingSchema.type = "string";
    readingSchema.minLength = 1;
    readingSystemSchema.type = "string";
    readingSystemSchema.minLength = 1;
  }
  if (lang === "en" || lang === "pt-BR") {
    required.push("pronunciation", "pronunciation_system");
    pronunciationSchema.type = "string";
    pronunciationSchema.minLength = 1;
    pronunciationSystemSchema.type = "string";
    pronunciationSystemSchema.minLength = 1;
  }

  return {
    type: "object",
    required: ["sense_localization", "example_localizations"],
    properties: {
      sense_localization: {
        type: "object",
        required,
        properties: {
          lang: { const: lang },
          term: { type: "string", minLength: 1 },
          reading: readingSchema,
          reading_system: readingSystemSchema,
          pronunciation: pronunciationSchema,
          pronunciation_system: pronunciationSystemSchema,
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
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const next = argv[i + 1];
    result[arg.slice(2)] = next && !next.startsWith("--") ? next : "true";
    if (next && !next.startsWith("--")) i++;
  }
  return result;
}
