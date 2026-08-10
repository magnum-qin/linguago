import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB = 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const senseIds = parseSenseIds(args.ids);
const reason = String(args.reason || 'manual_needs_review');
const apply = args.apply === 'true' || args.apply === true;

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
if (!senseIds.length) throw new Error('No sense ids supplied. Use --ids 1,2,3');

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000');

const statements = {
  getSense: db.prepare(`
    SELECT
      ps.id AS sense_id,
      ps.status AS sense_status,
      ps.confidence,
      pe.id AS entry_id,
      pe.headword,
      pe.status AS entry_status
    FROM product_senses ps
    JOIN product_entries pe ON pe.id = ps.product_entry_id
    WHERE ps.id = ?
  `),
  markSense: db.prepare(`
    UPDATE product_senses
    SET status = 'needs_review',
        confidence = MIN(COALESCE(confidence, 0.45), 0.45)
    WHERE id = ?
      AND status <> 'accepted'
      AND status <> 'publishable'
  `),
  markLocalizations: db.prepare(`
    UPDATE product_localizations
    SET needs_review = 1,
        confidence = MIN(COALESCE(confidence, 0.45), 0.45),
        source = source || ';' || @reason
    WHERE product_sense_id = @sense_id
  `),
  markExamples: db.prepare(`
    UPDATE product_examples
    SET needs_review = 1
    WHERE product_sense_id = ?
  `),
  markExampleLocalizations: db.prepare(`
    UPDATE product_example_localizations
    SET needs_review = 1
    WHERE product_example_id IN (
      SELECT id FROM product_examples WHERE product_sense_id = ?
    )
  `),
  refreshEntry: db.prepare(`
    UPDATE product_entries
    SET status = CASE
      WHEN EXISTS (
        SELECT 1
        FROM product_senses
        WHERE product_entry_id = product_entries.id
          AND status IN ('accepted', 'publishable')
      )
      THEN status
      ELSE 'needs_review'
    END
    WHERE id = ?
  `)
};

const before = senseIds.map((id) => statements.getSense.get(id)).filter(Boolean);
const missing = senseIds.filter((id) => !before.some((row) => row.sense_id === id));

const stats = {
  db: path.relative(process.cwd(), dbPath),
  apply,
  reason,
  requested: senseIds.length,
  found: before.length,
  missing,
  senses_marked: 0,
  localizations_marked: 0,
  examples_marked: 0,
  example_localizations_marked: 0,
  entries_refreshed: 0
};

if (apply) {
  db.transaction(() => {
    for (const row of before) {
      const senseResult = statements.markSense.run(row.sense_id);
      const locResult = statements.markLocalizations.run({ sense_id: row.sense_id, reason });
      const exampleResult = statements.markExamples.run(row.sense_id);
      const exampleLocResult = statements.markExampleLocalizations.run(row.sense_id);
      const entryResult = statements.refreshEntry.run(row.entry_id);
      stats.senses_marked += senseResult.changes;
      stats.localizations_marked += locResult.changes;
      stats.examples_marked += exampleResult.changes;
      stats.example_localizations_marked += exampleLocResult.changes;
      stats.entries_refreshed += entryResult.changes;
    }
  })();
}

const after = senseIds.map((id) => statements.getSense.get(id)).filter(Boolean);

console.log(
  JSON.stringify(
    {
      ok: missing.length === 0,
      stats,
      before: before.map(compactRow),
      after: after.map(compactRow)
    },
    null,
    2
  )
);

db.close();

function compactRow(row) {
  return {
    sense_id: row.sense_id,
    headword: row.headword,
    sense_status: row.sense_status,
    entry_status: row.entry_status,
    confidence: row.confidence
  };
}

function parseSenseIds(value) {
  return String(value || '')
    .split(',')
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isInteger(item) && item > 0);
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
