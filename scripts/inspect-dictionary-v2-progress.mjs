import Database from 'better-sqlite3';
import path from 'node:path';

const dbPath = path.resolve(process.argv[2] || 'data/processed/linguago_v2_full.db');
const db = new Database(dbPath, { readonly: true });

const tables = all("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").map((row) => row.name);

const output = {
  db: path.relative(process.cwd(), dbPath),
  tables,
  entries: one(`
    SELECT
      COUNT(*) AS total,
      SUM(status = 'needs_review') AS needs_review,
      SUM(status = 'active') AS active,
      SUM(status = 'deprecated') AS deprecated
    FROM entries
  `),
  senses: one(`
    SELECT
      COUNT(*) AS total,
      SUM(needs_review = 0) AS accepted,
      SUM(needs_review = 1) AS needs_review
    FROM senses
  `),
  sense_localizations_by_lang: all(`
    SELECT
      lang,
      COUNT(*) AS total,
      SUM(needs_review = 0) AS accepted,
      SUM(needs_review = 1) AS needs_review,
      SUM(CASE WHEN term IS NOT NULL AND trim(term) <> '' THEN 1 ELSE 0 END) AS with_term,
      SUM(CASE WHEN definition IS NOT NULL AND trim(definition) <> '' THEN 1 ELSE 0 END) AS with_definition,
      SUM(CASE WHEN pronunciation IS NOT NULL AND trim(pronunciation) <> '' THEN 1 ELSE 0 END) AS with_pronunciation
    FROM sense_localizations
    GROUP BY lang
    ORDER BY lang
  `),
  localization_matrix: one(`
    SELECT
      COUNT(*) AS senses_total,
      SUM(CASE WHEN lang_rows = 4 THEN 1 ELSE 0 END) AS senses_with_4_lang_rows,
      SUM(CASE WHEN accepted_rows = 4 THEN 1 ELSE 0 END) AS senses_with_4_accepted_langs
    FROM (
      SELECT
        sense_id,
        COUNT(DISTINCT lang) AS lang_rows,
        SUM(CASE WHEN needs_review = 0 THEN 1 ELSE 0 END) AS accepted_rows
      FROM sense_localizations
      GROUP BY sense_id
    )
  `),
  entries_with_complete_senses: one(`
    SELECT
      COUNT(DISTINCT s.entry_id) AS entries_with_at_least_one_4_lang_sense,
      COUNT(DISTINCT CASE WHEN completed.completed_senses = entry_sense_counts.total_senses THEN s.entry_id END) AS entries_with_all_senses_4_lang
    FROM senses s
    JOIN (
      SELECT sense_id
      FROM sense_localizations
      GROUP BY sense_id
      HAVING COUNT(DISTINCT lang) = 4
         AND SUM(CASE WHEN needs_review = 0 THEN 1 ELSE 0 END) = 4
    ) complete_sense ON complete_sense.sense_id = s.id
    JOIN (
      SELECT entry_id, COUNT(*) AS total_senses
      FROM senses
      GROUP BY entry_id
    ) entry_sense_counts ON entry_sense_counts.entry_id = s.entry_id
    JOIN (
      SELECT s2.entry_id, COUNT(*) AS completed_senses
      FROM senses s2
      JOIN (
        SELECT sense_id
        FROM sense_localizations
        GROUP BY sense_id
        HAVING COUNT(DISTINCT lang) = 4
           AND SUM(CASE WHEN needs_review = 0 THEN 1 ELSE 0 END) = 4
      ) complete_sense2 ON complete_sense2.sense_id = s2.id
      GROUP BY s2.entry_id
    ) completed ON completed.entry_id = s.entry_id
  `),
  examples: one(`
    SELECT
      COUNT(*) AS total,
      SUM(needs_review = 0) AS accepted,
      SUM(needs_review = 1) AS needs_review
    FROM examples
  `),
  example_localizations_by_lang: all(`
    SELECT
      lang,
      COUNT(*) AS total,
      SUM(needs_review = 0) AS accepted,
      SUM(needs_review = 1) AS needs_review
    FROM example_localizations
    GROUP BY lang
    ORDER BY lang
  `)
};

const jobTable = tables.includes('llm_completion_jobs')
  ? 'llm_completion_jobs'
  : tables.includes('llm_jobs')
    ? 'llm_jobs'
    : null;

if (jobTable) {
  output.job_table = jobTable;
  output.job_columns = all(`PRAGMA table_info(${jobTable})`).map((column) => column.name);
  output.llm_jobs_by_status = all(`
    SELECT status, COUNT(*) AS count
    FROM ${jobTable}
    GROUP BY status
    ORDER BY status
  `);
  if (output.job_columns.includes('target_lang')) {
    output.llm_jobs_by_lang_status = all(`
      SELECT target_lang, status, COUNT(*) AS count
      FROM ${jobTable}
      GROUP BY target_lang, status
      ORDER BY target_lang, status
    `);
  } else if (output.job_columns.includes('lang')) {
    output.llm_jobs_by_lang_status = all(`
      SELECT lang, status, COUNT(*) AS count
      FROM ${jobTable}
      GROUP BY lang, status
      ORDER BY lang, status
    `);
  }
}

console.log(JSON.stringify(output, null, 2));
db.close();

function one(sql) {
  return db.prepare(sql).get();
}

function all(sql) {
  return db.prepare(sql).all();
}
