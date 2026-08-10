import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB = 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const DEFAULT_REPORT = 'logs/product-mergeable-duplicate-senses-20260624.json';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const reportPath = path.resolve(args.report || DEFAULT_REPORT);
const apply = args.apply === 'true' || args.apply === true;

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
if (!fs.existsSync(reportPath)) throw new Error(`Report not found: ${reportPath}`);

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const candidates = Array.isArray(report.candidates) ? report.candidates : [];

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000');

const statements = {
  sense: db.prepare('SELECT id, product_entry_id, sense_order, status FROM product_senses WHERE id = ?'),
  sourceLinks: db.prepare(
    'SELECT id, source_sense_id FROM product_sense_source_links WHERE product_sense_id = ? ORDER BY id'
  ),
  sourceLinkExists: db.prepare(
    'SELECT id FROM product_sense_source_links WHERE product_sense_id = ? AND source_sense_id = ?'
  ),
  moveSourceLink: db.prepare('UPDATE product_sense_source_links SET product_sense_id = ? WHERE id = ?'),
  deleteSourceLink: db.prepare('DELETE FROM product_sense_source_links WHERE id = ?'),
  deleteLocalizations: db.prepare('DELETE FROM product_localizations WHERE product_sense_id = ?'),
  deleteExampleLocalizations: db.prepare(`
    DELETE FROM product_example_localizations
    WHERE product_example_id IN (
      SELECT id FROM product_examples WHERE product_sense_id = ?
    )
  `),
  deleteExamples: db.prepare('DELETE FROM product_examples WHERE product_sense_id = ?'),
  deleteSense: db.prepare('DELETE FROM product_senses WHERE id = ?'),
  sensesForEntry: db.prepare('SELECT id FROM product_senses WHERE product_entry_id = ? ORDER BY sense_order, id'),
  setSenseOrder: db.prepare('UPDATE product_senses SET sense_order = ? WHERE id = ?'),
  countStatuses: db.prepare(
    'SELECT status, COUNT(*) AS count FROM product_senses WHERE product_entry_id = ? GROUP BY status'
  ),
  updateEntryStatus: db.prepare(`
    UPDATE product_entries
    SET status = @status,
        source_count = (
          SELECT COUNT(*)
          FROM product_sense_source_links
          WHERE product_sense_id IN (
            SELECT id FROM product_senses WHERE product_entry_id = @entry_id
          )
        ),
        lang_count = (
          SELECT COUNT(DISTINCT lang)
          FROM product_localizations
          WHERE product_sense_id IN (
            SELECT id FROM product_senses WHERE product_entry_id = @entry_id
          )
        )
    WHERE id = @entry_id
  `)
};

const stats = {
  db: path.relative(process.cwd(), dbPath),
  report: path.relative(process.cwd(), reportPath),
  apply,
  candidates: candidates.length,
  merges_applied: 0,
  source_links_moved: 0,
  source_links_deleted: 0,
  localizations_deleted: 0,
  example_localizations_deleted: 0,
  examples_deleted: 0,
  senses_deleted: 0,
  skipped: []
};

function mergeCandidate(candidate) {
  const keep = statements.sense.get(candidate.keep_sense_id);
  const remove = statements.sense.get(candidate.remove_sense_id);
  if (!keep || !remove) {
    stats.skipped.push({ ...candidate, reason: 'missing_sense' });
    return;
  }
  if (keep.product_entry_id !== remove.product_entry_id || keep.product_entry_id !== candidate.entry_id) {
    stats.skipped.push({ ...candidate, reason: 'entry_mismatch' });
    return;
  }
  if (keep.id === remove.id) {
    stats.skipped.push({ ...candidate, reason: 'same_sense' });
    return;
  }

  for (const link of statements.sourceLinks.all(remove.id)) {
    if (statements.sourceLinkExists.get(keep.id, link.source_sense_id)) {
      stats.source_links_deleted += statements.deleteSourceLink.run(link.id).changes;
    } else {
      stats.source_links_moved += statements.moveSourceLink.run(keep.id, link.id).changes;
    }
  }

  stats.localizations_deleted += statements.deleteLocalizations.run(remove.id).changes;
  stats.example_localizations_deleted += statements.deleteExampleLocalizations.run(remove.id).changes;
  stats.examples_deleted += statements.deleteExamples.run(remove.id).changes;
  stats.senses_deleted += statements.deleteSense.run(remove.id).changes;
  renumberSenses(keep.product_entry_id);
  updateEntry(keep.product_entry_id);
  stats.merges_applied++;
}

if (apply) {
  db.transaction(() => {
    for (const candidate of candidates) mergeCandidate(candidate);
  })();
} else {
  for (const candidate of candidates) {
    const keep = statements.sense.get(candidate.keep_sense_id);
    const remove = statements.sense.get(candidate.remove_sense_id);
    if (!keep || !remove) stats.skipped.push({ ...candidate, reason: 'missing_sense' });
    else if (keep.product_entry_id !== remove.product_entry_id || keep.product_entry_id !== candidate.entry_id) {
      stats.skipped.push({ ...candidate, reason: 'entry_mismatch' });
    } else {
      stats.merges_applied++;
    }
  }
}

console.log(JSON.stringify(stats, null, 2));
db.close();

function renumberSenses(entryId) {
  const senses = statements.sensesForEntry.all(entryId);
  for (let index = 0; index < senses.length; index++) {
    statements.setSenseOrder.run(index + 1, senses[index].id);
  }
}

function updateEntry(entryId) {
  const statusCounts = new Map(statements.countStatuses.all(entryId).map((row) => [row.status, row.count]));
  const status = statusCounts.get('needs_review')
    ? 'needs_review'
    : statusCounts.get('ready_for_llm')
      ? 'ready_for_llm'
      : statusCounts.get('draft_fused') || statusCounts.get('draft_single_source')
        ? 'draft_fused'
        : 'accepted';
  statements.updateEntryStatus.run({ entry_id: entryId, status });
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index++;
    } else {
      parsed[key] = 'true';
    }
  }
  return parsed;
}
