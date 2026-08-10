import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB = 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const provider = args.provider || 'ollama';
const model = args.model || 'qwen3.6:latest';
const promptVersion = args['prompt-version'] || 'dictionary-v2-product-localization-v2-json-retry';
const dryRun = args['dry-run'] === 'true';

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000');

const statements = {
  failedLatest: db.prepare(`
    SELECT j.*
    FROM product_llm_completion_jobs j
    WHERE j.target_type = 'product_sense_localization'
      AND j.status = 'failed'
      AND j.id = (
        SELECT MAX(j2.id)
        FROM product_llm_completion_jobs j2
        WHERE j2.target_type = j.target_type
          AND j2.target_id = j.target_id
          AND j2.lang = j.lang
      )
    ORDER BY j.lang, j.id
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

const rows = statements.failedLatest.all();
const jobs = [];
const stats = {
  db: path.relative(process.cwd(), dbPath),
  dry_run: dryRun,
  failed_latest: rows.length,
  jobs_created: 0,
  skipped_existing_job: 0,
  skipped_bad_input: 0
};

for (const row of rows) {
  if (statements.existingJob.get(row.target_id, row.lang, provider, model, promptVersion)) {
    stats.skipped_existing_job++;
    continue;
  }
  const input = parseMaybeJson(row.input_json);
  if (!input?.target_lang || !input?.product_sense) {
    stats.skipped_bad_input++;
    continue;
  }
  jobs.push({
    target_id: row.target_id,
    lang: row.lang,
    provider,
    model,
    prompt_version: promptVersion,
    input_json: JSON.stringify(
      {
        ...input,
        retry_context: {
          previous_job_id: row.id,
          previous_error: row.error,
          instruction:
            'Previous attempt failed to return valid JSON. Return only schema-valid JSON. Keep the same product sense.'
        }
      },
      null,
      2
    )
  });
}

if (!dryRun && jobs.length) {
  db.transaction((items) => items.forEach((job) => statements.insertJob.run(job)))(jobs);
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
    { ok: true, provider, model, prompt_version: promptVersion, stats, queued_by_lang: queuedByLang },
    null,
    2
  )
);
db.close();

function parseMaybeJson(value) {
  try {
    return JSON.parse(String(value || ''));
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) parsed[key] = 'true';
    else {
      parsed[key] = next;
      index++;
    }
  }
  return parsed;
}
