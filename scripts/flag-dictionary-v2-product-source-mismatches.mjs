import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB = 'data/processed/linguago_v2_product_top5000_fused_only_pilot.db';
const DEFAULT_OUT = 'data/processed/product-source-mismatches.json';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const outPath = path.resolve(args.out || DEFAULT_OUT);
const dryRun = args['dry-run'] === 'true';
const apply = args.apply === 'true';

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
if (!dryRun && !apply) {
  throw new Error('Pass --dry-run true to inspect or --apply true to mark mismatches.');
}

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 10000');

const statements = {
  candidates: db.prepare(`
    SELECT
      pe.id AS entry_id,
      pe.headword,
      pe.frequency_rank,
      pe.group_method,
      ps.id AS sense_id,
      ps.sense_order,
      ps.part_of_speech,
      ps.gloss_key,
      ps.status AS sense_status,
      COUNT(DISTINCT l.source_word) AS mismatched_source_words,
      GROUP_CONCAT(DISTINCT l.source_word) AS source_words,
      GROUP_CONCAT(DISTINCT l.match_method) AS match_methods
    FROM product_entries pe
    JOIN product_senses ps ON ps.product_entry_id = pe.id
    JOIN product_sense_source_links l ON l.product_sense_id = ps.id
    WHERE pe.primary_lang = 'zh'
      AND length(pe.headword) = 1
      AND l.source_lang = 'zh'
      AND length(l.source_word) = 1
      AND pe.headword <> l.source_word
    GROUP BY pe.id, ps.id
    ORDER BY pe.frequency_rank IS NULL, pe.frequency_rank, pe.headword, ps.sense_order, ps.id
  `),
  markSense: db.prepare(`
    UPDATE product_senses
    SET status = 'needs_review'
    WHERE id = ?
      AND status <> 'needs_review'
  `),
  markEntry: db.prepare(`
    UPDATE product_entries
    SET status = 'needs_review'
    WHERE id = ?
      AND status <> 'needs_review'
  `),
  markLocalizations: db.prepare(`
    UPDATE product_localizations
    SET needs_review = 1,
        source = CASE
          WHEN source LIKE '%source-mismatch%' THEN source
          ELSE source || ':source-mismatch'
        END
    WHERE product_sense_id = ?
      AND needs_review = 0
  `),
  markExamples: db.prepare(`
    UPDATE product_examples
    SET needs_review = 1
    WHERE product_sense_id = ?
      AND needs_review = 0
  `),
  markExampleLocalizations: db.prepare(`
    UPDATE product_example_localizations
    SET needs_review = 1,
        source = CASE
          WHEN source LIKE '%source-mismatch%' THEN source
          ELSE source || ':source-mismatch'
        END
    WHERE product_example_id IN (
      SELECT id FROM product_examples WHERE product_sense_id = ?
    )
      AND needs_review = 0
  `),
  markJobs: db.prepare(`
    UPDATE product_llm_completion_jobs
    SET status = 'needs_review',
        error = 'source word/headword mismatch',
        updated_at = CURRENT_TIMESTAMP
    WHERE target_id = ?
      AND status = 'accepted'
  `)
};

const candidates = statements.candidates.all();
const stats = {
  db: path.relative(process.cwd(), dbPath),
  dry_run: dryRun,
  apply,
  candidate_senses: candidates.length,
  marked_senses: 0,
  marked_entries: 0,
  marked_localizations: 0,
  marked_examples: 0,
  marked_example_localizations: 0,
  marked_jobs: 0
};

if (apply) {
  const tx = db.transaction((rows) => {
    for (const row of rows) {
      stats.marked_senses += statements.markSense.run(row.sense_id).changes;
      stats.marked_entries += statements.markEntry.run(row.entry_id).changes;
      stats.marked_localizations += statements.markLocalizations.run(row.sense_id).changes;
      stats.marked_example_localizations += statements.markExampleLocalizations.run(row.sense_id).changes;
      stats.marked_examples += statements.markExamples.run(row.sense_id).changes;
      stats.marked_jobs += statements.markJobs.run(row.sense_id).changes;
    }
  });
  tx(candidates);
}

const summary = {
  ok: true,
  stats,
  sample: candidates.slice(0, 50)
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ ...summary, candidates }, null, 2));

console.log(JSON.stringify(summary, null, 2));
db.close();

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
