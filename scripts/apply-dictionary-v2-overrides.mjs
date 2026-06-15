import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_full.db";
const DEFAULT_OVERRIDES = "config/dictionary-overrides/function-words-v2.json";
const SOURCE = "manual:function-word-override";

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const overridesPath = path.resolve(args.overrides || DEFAULT_OVERRIDES);
const dryRun = args["dry-run"] === "true";

const overrides = JSON.parse(fs.readFileSync(overridesPath, "utf8"));
if (!Array.isArray(overrides)) throw new Error("Override file must contain an array.");

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 10000");

const statements = {
  senseExists: db.prepare(`
    SELECT s.id, e.word
    FROM senses s
    JOIN entries e ON e.id = s.entry_id
    WHERE s.id = ?
  `),
  upsertLocalization: db.prepare(`
    INSERT INTO sense_localizations
      (sense_id, lang, term, normalized_term, reading, reading_system, pronunciation, pronunciation_system,
       definition, usage_note, source, confidence, needs_review, updated_at)
    VALUES
      (@sense_id, @lang, @term, @normalized_term, @reading, @reading_system, @pronunciation, @pronunciation_system,
       @definition, @usage_note, @source, @confidence, 0, CURRENT_TIMESTAMP)
    ON CONFLICT(sense_id, lang) DO UPDATE SET
      term = excluded.term,
      normalized_term = excluded.normalized_term,
      reading = excluded.reading,
      reading_system = excluded.reading_system,
      pronunciation = excluded.pronunciation,
      pronunciation_system = excluded.pronunciation_system,
      definition = excluded.definition,
      usage_note = excluded.usage_note,
      source = excluded.source,
      confidence = excluded.confidence,
      needs_review = 0,
      updated_at = CURRENT_TIMESTAMP
  `),
  markJobsAccepted: db.prepare(`
    UPDATE llm_completion_jobs
    SET status = 'accepted',
        output_json = @output_json,
        error = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE target_type = 'sense_localization'
      AND target_id = @sense_id
      AND lang = @lang
      AND status IN ('queued', 'running', 'needs_review', 'failed')
  `),
  resolveIssue: db.prepare(`
    UPDATE quality_issues
    SET resolved_at = CURRENT_TIMESTAMP
    WHERE entity_type = 'sense'
      AND entity_id = ?
      AND issue_code = ?
      AND resolved_at IS NULL
  `)
};

const stats = {
  overrides_seen: overrides.length,
  applied: 0,
  skipped_invalid: 0,
  jobs_marked_accepted: 0,
  quality_issues_resolved: 0,
  dry_run: dryRun
};
const problems = [];

const applyOverrides = db.transaction((rows) => {
  for (const row of rows) {
    const normalized = normalizeOverride(row);
    const sense = statements.senseExists.get(normalized.sense_id);
    if (!sense) {
      stats.skipped_invalid++;
      problems.push({ override: row, error: "sense_id not found" });
      continue;
    }

    statements.upsertLocalization.run(normalized);
    const output = {
      sense_localization: {
        lang: normalized.lang,
        term: normalized.term,
        reading: normalized.reading,
        reading_system: normalized.reading_system,
        pronunciation: normalized.pronunciation,
        pronunciation_system: normalized.pronunciation_system,
        definition: normalized.definition,
        usage_note: normalized.usage_note
      },
      example_localizations: []
    };
    const jobResult = statements.markJobsAccepted.run({
      sense_id: normalized.sense_id,
      lang: normalized.lang,
      output_json: JSON.stringify(output, null, 2)
    });
    const issueResult = statements.resolveIssue.run(normalized.sense_id, `missing_${normalized.lang}_localization`);

    stats.applied++;
    stats.jobs_marked_accepted += jobResult.changes;
    stats.quality_issues_resolved += issueResult.changes;
  }
});

if (!dryRun) applyOverrides(overrides);
else {
  for (const row of overrides) {
    const normalized = normalizeOverride(row);
    if (!statements.senseExists.get(normalized.sense_id)) {
      stats.skipped_invalid++;
      problems.push({ override: row, error: "sense_id not found" });
    } else {
      stats.applied++;
    }
  }
}

const remainingNeedsReview = db
  .prepare(`
    SELECT lang, COUNT(*) AS c
    FROM llm_completion_jobs
    WHERE status = 'needs_review'
    GROUP BY lang
    ORDER BY lang
  `)
  .all();

db.close();
console.log(
  JSON.stringify(
    {
      ok: problems.length === 0,
      db: path.relative(process.cwd(), dbPath),
      overrides: path.relative(process.cwd(), overridesPath),
      source: SOURCE,
      stats,
      remaining_needs_review: remainingNeedsReview,
      problems
    },
    null,
    2
  )
);

function normalizeOverride(row) {
  const senseId = Number(row.sense_id);
  if (!Number.isInteger(senseId) || senseId <= 0) throw new Error(`Invalid sense_id: ${row.sense_id}`);
  const lang = cleanText(row.lang);
  if (!["en", "zh", "ja", "pt-BR"].includes(lang)) throw new Error(`Invalid lang: ${lang}`);
  const term = cleanText(row.term);
  const definition = cleanText(row.definition);
  if (!term || !definition) throw new Error(`Override ${senseId}:${lang} needs term and definition.`);
  return {
    sense_id: senseId,
    lang,
    term,
    normalized_term: term.toLocaleLowerCase(),
    reading: cleanNullable(row.reading),
    reading_system: cleanNullable(row.reading_system),
    pronunciation: cleanNullable(row.pronunciation),
    pronunciation_system: cleanNullable(row.pronunciation_system),
    definition,
    usage_note: cleanNullable(row.usage_note),
    source: SOURCE,
    confidence: Number(row.confidence ?? 0.95)
  };
}

function cleanText(value) {
  return String(value || "").trim();
}

function cleanNullable(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
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
