import Database from "better-sqlite3";
import path from "node:path";

const LANGUAGE_CODES = new Set(["en", "zh", "ja", "pt-BR"]);
const DEFAULT_DB = "data/processed/linguago_v2_staging.db";
const DEFAULT_PROVIDER = "ollama";
const DEFAULT_MODEL = "qwen3.6:latest";
const DEFAULT_PROMPT_VERSION = "dictionary-v2-localization-v1";

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const provider = args.provider || DEFAULT_PROVIDER;
const model = args.model || DEFAULT_MODEL;
const promptVersion = args["prompt-version"] || DEFAULT_PROMPT_VERSION;
const limit = args.limit ? Number(args.limit) : 0;
const dryRun = args["dry-run"] === "true";
const profile = args.profile || "all";
const includeExamples =
  args["include-examples"] !== undefined ? args["include-examples"] !== "false" : profile !== "core-lite";
const maxSensesPerEntry = Number(args["max-senses-per-entry"] || 0);
const targetLangs = String(args["target-langs"] || "")
  .split(",")
  .map((lang) => lang.trim())
  .filter(Boolean);
const targetLangSet = new Set(targetLangs);
for (const lang of targetLangSet) {
  if (!LANGUAGE_CODES.has(lang)) {
    throw new Error(`Unknown target language: ${lang}`);
  }
}
const targetIssueCodes = targetLangs.map((lang) => `missing_${lang}_localization`);
const targetIssueClause = targetIssueCodes.length
  ? `AND qi.issue_code IN (${targetIssueCodes.map(() => "?").join(", ")})`
  : "";

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 10000");

const statements = {
  missingIssues: db.prepare(`
    SELECT
      qi.id,
      qi.entity_id AS sense_id,
      qi.issue_code,
      e.frequency_rank,
      e.normalized_key,
      s.sense_order
    FROM quality_issues qi
    JOIN senses s ON s.id = qi.entity_id
    JOIN entries e ON e.id = s.entry_id
    WHERE qi.entity_type = 'sense'
      AND qi.resolved_at IS NULL
      AND qi.issue_code LIKE 'missing_%_localization'
      ${targetIssueClause}
    ORDER BY
      CASE WHEN e.frequency_rank IS NULL THEN 1 ELSE 0 END,
      e.frequency_rank,
      e.normalized_key,
      s.sense_order,
      qi.id
  `),
  sense: db.prepare(`
    SELECT
      e.id AS entry_id,
      e.word,
      e.normalized_key,
      e.source_lang,
      s.id AS sense_id,
      s.sense_order,
      s.part_of_speech,
      s.domain,
      s.register_label,
      s.gloss_key,
      s.source,
      s.confidence
    FROM senses s
    JOIN entries e ON e.id = s.entry_id
    WHERE s.id = ?
  `),
  localizations: db.prepare(`
    SELECT lang, term, reading, reading_system, pronunciation, pronunciation_system, definition, usage_note, source, confidence
    FROM sense_localizations
    WHERE sense_id = ?
    ORDER BY lang
  `),
  localizationExists: db.prepare(`
    SELECT id FROM sense_localizations WHERE sense_id = ? AND lang = ?
  `),
  examples: db.prepare(`
    SELECT id, example_order, source_lang, source_text, source_reading, register_label, source, confidence
    FROM examples
    WHERE sense_id = ?
    ORDER BY example_order
    LIMIT 3
  `),
  exampleLocalizations: db.prepare(`
    SELECT lang, text, reading, source, confidence
    FROM example_localizations
    WHERE example_id = ?
    ORDER BY lang
  `),
  existingJob: db.prepare(`
    SELECT id
    FROM llm_completion_jobs
    WHERE target_type = 'sense_localization'
      AND target_id = ?
      AND lang = ?
      AND provider = ?
      AND model = ?
      AND prompt_version = ?
      AND status IN ('queued', 'running', 'accepted', 'needs_review')
  `),
  insertJob: db.prepare(`
    INSERT INTO llm_completion_jobs
      (target_type, target_id, lang, provider, model, prompt_version, status, input_json)
    VALUES
      ('sense_localization', @target_id, @lang, @provider, @model, @prompt_version, 'queued', @input_json)
  `)
};

const stats = {
  scanned_issues: 0,
  skipped_existing_localization: 0,
  skipped_existing_job: 0,
  skipped_planned_duplicate: 0,
  skipped_invalid_issue: 0,
  skipped_profile: 0,
  skipped_entry_limit: 0,
  jobs_created: 0,
  dry_run: dryRun,
  profile,
  include_examples: includeExamples,
  max_senses_per_entry: maxSensesPerEntry
};

const insertJobs = db.transaction((jobs) => {
  for (const job of jobs) {
    statements.insertJob.run(job);
  }
});

const jobs = [];
const jobsByEntry = new Map();
const plannedJobKeys = new Set();
for (const issue of statements.missingIssues.iterate(...targetIssueCodes)) {
  stats.scanned_issues++;
  if (limit && jobs.length >= limit) break;

  const lang = parseMissingLang(issue.issue_code);
  if (!lang || !LANGUAGE_CODES.has(lang)) {
    stats.skipped_invalid_issue++;
    continue;
  }
  if (targetLangSet.size && !targetLangSet.has(lang)) {
    stats.skipped_profile++;
    continue;
  }

  if (statements.localizationExists.get(issue.sense_id, lang)) {
    stats.skipped_existing_localization++;
    continue;
  }

  if (statements.existingJob.get(issue.sense_id, lang, provider, model, promptVersion)) {
    stats.skipped_existing_job++;
    continue;
  }
  const plannedJobKey = `${issue.sense_id}:${lang}`;
  if (plannedJobKeys.has(plannedJobKey)) {
    stats.skipped_planned_duplicate++;
    continue;
  }

  const sense = statements.sense.get(issue.sense_id);
  if (!sense) {
    stats.skipped_invalid_issue++;
    continue;
  }

  if (!matchesProfile(sense, profile)) {
    stats.skipped_profile++;
    continue;
  }

  if (maxSensesPerEntry > 0) {
    const entryJobs = jobsByEntry.get(sense.entry_id) || 0;
    if (entryJobs >= maxSensesPerEntry) {
      stats.skipped_entry_limit++;
      continue;
    }
    jobsByEntry.set(sense.entry_id, entryJobs + 1);
  }

  plannedJobKeys.add(plannedJobKey);
  jobs.push({
    target_id: sense.sense_id,
    lang,
    provider,
    model,
    prompt_version: promptVersion,
    input_json: JSON.stringify(buildInput({ sense, lang }), null, 2)
  });
}

if (!dryRun) {
  insertJobs(jobs);
}
stats.jobs_created = jobs.length;

const queuedByLang = db
  .prepare(`
    SELECT lang, COUNT(*) AS c
    FROM llm_completion_jobs
    WHERE target_type = 'sense_localization'
      AND status = 'queued'
    GROUP BY lang
    ORDER BY lang
  `)
  .all();

db.close();

console.log(
  JSON.stringify(
    {
      ok: true,
      db: path.relative(process.cwd(), dbPath),
      provider,
      model,
      prompt_version: promptVersion,
      profile,
      target_langs: [...targetLangSet],
      stats,
      queued_by_lang: queuedByLang
    },
    null,
    2
  )
);

function buildInput({ sense, lang }) {
  const knownLocalizations = Object.fromEntries(
    statements.localizations.all(sense.sense_id).map((row) => [row.lang, row])
  );
  const examples = includeExamples
    ? statements.examples.all(sense.sense_id).map((example) => ({
        ...example,
        localizations: Object.fromEntries(
          statements.exampleLocalizations.all(example.id).map((row) => [row.lang, row])
        )
      }))
    : [];

  return {
    task: "complete_missing_sense_localization",
    target_lang: lang,
    requirements: {
      preserve_existing_languages: true,
      complete_only_target_lang: true,
      output_json_only: true,
      use_brazilian_portuguese_for_pt_BR: lang === "pt-BR",
      include_reading: lang === "zh" || lang === "ja",
      include_pronunciation: lang === "en" || lang === "pt-BR",
      include_example_localizations: includeExamples,
      avoid_adding_new_senses: true
    },
    entry: {
      id: sense.entry_id,
      word: sense.word,
      normalized_key: sense.normalized_key,
      source_lang: sense.source_lang
    },
    sense: {
      id: sense.sense_id,
      sense_order: sense.sense_order,
      part_of_speech: sense.part_of_speech,
      domain: sense.domain,
      register_label: sense.register_label,
      gloss_key: sense.gloss_key,
      source: sense.source,
      confidence: sense.confidence
    },
    known_localizations: knownLocalizations,
    examples,
    expected_output_schema: outputSchema(lang)
  };
}

function outputSchema(lang) {
  const senseRequired = ["lang", "term", "definition"];
  const readingSchema = { type: ["string", "null"] };
  const readingSystemSchema = { type: ["string", "null"] };
  const pronunciationSchema = { type: ["string", "null"] };
  const pronunciationSystemSchema = { type: ["string", "null"] };

  if (lang === "zh" || lang === "ja") {
    senseRequired.push("reading", "reading_system");
    readingSchema.type = "string";
    readingSchema.minLength = 1;
    readingSystemSchema.type = "string";
    readingSystemSchema.minLength = 1;
  }
  if (lang === "en" || lang === "pt-BR") {
    senseRequired.push("pronunciation", "pronunciation_system");
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
        required: senseRequired,
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

function parseMissingLang(issueCode) {
  const match = String(issueCode || "").match(/^missing_(.+)_localization$/u);
  return match ? match[1] : null;
}

function matchesProfile(sense, selectedProfile) {
  if (selectedProfile === "all") return true;
  if (!["regular", "core", "core-lite"].includes(selectedProfile)) {
    throw new Error(`Unknown profile: ${selectedProfile}`);
  }

  const word = String(sense.word || "").trim();
  if (!word) return false;
  if (word.length > 24) return false;
  if (/^['’-]/u.test(word)) return false;
  if (/\s/u.test(word)) return false;
  if (/^\d+$/u.test(word)) return false;
  if (/^[A-Z0-9]{2,}$/u.test(word)) return false;
  if (/[()"'“”]/u.test(word)) return false;

  if ((selectedProfile === "core" || selectedProfile === "core-lite") && !matchesCoreWord(sense, word)) return false;

  if (sense.source_lang === "en") {
    return /^[A-Za-z][A-Za-z-]{1,23}$/u.test(word);
  }
  if (sense.source_lang === "zh") {
    return /[\u3400-\u9fff]/u.test(word);
  }
  if (sense.source_lang === "ja") {
    return /[\u3040-\u30ff\u3400-\u9fff]/u.test(word);
  }
  if (sense.source_lang === "pt-BR") {
    return /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ-]{1,23}$/u.test(word);
  }
  return false;
}

function matchesCoreWord(sense, word) {
  if (word.length > 16) return false;
  if (/^\p{P}+$/u.test(word)) return false;
  if (/[\p{S}]/u.test(word)) return false;
  if (/\d/u.test(word)) return false;
  if (/[_/@#&+=]/u.test(word)) return false;
  if (/^[A-Z]{2,}$/u.test(word)) return false;
  if (/^[A-Za-z][\u3400-\u9fff\u3040-\u30ff]/u.test(word)) return false;
  if (/^[\u3400-\u9fff\u3040-\u30ff][A-Za-z]/u.test(word)) return false;

  const gloss = String(sense.gloss_key || "").toLowerCase();
  if (
    /\b(surname|place name|old name|abbreviation|acronym|internet slang|slang|classifier|radical|repetition mark|symbol|suffix|prefix|telegraphy|unicode|heavenly stems|soft redirect|missing gloss)\b/u.test(
      gloss
    )
  ) {
    return false;
  }
  if (gloss === "missing gloss") return false;

  if (sense.source_lang === "en") {
    return /^[a-z][a-z-]{1,15}$/u.test(word) && !word.endsWith("-");
  }
  if (sense.source_lang === "zh") {
    return /^[\u3400-\u9fff]{2,6}$/u.test(word);
  }
  if (sense.source_lang === "ja") {
    return /^[\u3040-\u30ff\u3400-\u9fff]{2,8}$/u.test(word);
  }
  if (sense.source_lang === "pt-BR") {
    return /^[a-zà-öø-ÿ][a-zà-öø-ÿ-]{1,15}$/u.test(word);
  }
  return false;
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      result[arg.slice(2)] = argv[++i] || "true";
    }
  }
  return result;
}
