import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db');
const baselinePath = path.resolve(args.baseline || '');
const reportPath = path.resolve(args.report || '');
const checkpointPath = path.resolve(args.checkpoint || '');
const outPath = path.resolve(args.out || 'logs/product-source-gap-checkpoint-reconcile.json');
const apply = args.apply === 'true';

for (const [label, filePath] of [
  ['db', dbPath],
  ['baseline', baselinePath],
  ['report', reportPath],
  ['checkpoint', checkpointPath]
]) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`Missing ${label}: ${filePath}`);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
const reportSourceIds = new Set(
  (report.selected || []).map((row) => Number(row.source_entry_id)).filter(Number.isInteger)
);
const checkpointAcceptedSourceIds = new Set(
  Object.values(checkpoint.items || {})
    .filter((row) => row?.status === 'accepted')
    .map((row) => Number(row.source_entry_id))
    .filter(Number.isInteger)
);

const db = new Database(dbPath);
const baseline = new Database(baselinePath, { readonly: true });
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000');

const baselineSenseIds = new Set(
  baseline
    .prepare('SELECT id FROM product_senses')
    .all()
    .map((row) => Number(row.id))
);
const candidateRows = db
  .prepare(
    `
    SELECT DISTINCT
      link.source_entry_id,
      pe.id AS entry_id,
      ps.id AS sense_id,
      pe.headword,
      pe.group_method,
      pe.status AS entry_status,
      ps.status AS sense_status
    FROM product_sense_source_links link
    JOIN product_senses ps ON ps.id = link.product_sense_id
    JOIN product_entries pe ON pe.id = ps.product_entry_id
    WHERE ps.status = 'draft_single_source'
      AND pe.group_method = 'source_gap_unsloth'
    ORDER BY pe.id, ps.id
  `
  )
  .all()
  .filter(
    (row) =>
      reportSourceIds.has(Number(row.source_entry_id)) &&
      !checkpointAcceptedSourceIds.has(Number(row.source_entry_id)) &&
      !baselineSenseIds.has(Number(row.sense_id))
  );

const senseIds = [...new Set(candidateRows.map((row) => Number(row.sense_id)))];
const entryIds = [...new Set(candidateRows.map((row) => Number(row.entry_id)))];
const senseIdSet = new Set(senseIds);
const entrySenseStmt = db.prepare('SELECT id, status FROM product_senses WHERE product_entry_id = ? ORDER BY id');
const unsafeEntries = entryIds
  .map((entryId) => ({ entry_id: entryId, senses: entrySenseStmt.all(entryId) }))
  .filter((entry) => entry.senses.some((sense) => !senseIdSet.has(Number(sense.id))));

if (unsafeEntries.length) {
  throw new Error(`Refusing reconcile: ${unsafeEntries.length} entries contain baseline or checkpoint senses`);
}

let deletedEntries = 0;
if (apply && entryIds.length) {
  const deleteEntry = db.prepare('DELETE FROM product_entries WHERE id = ?');
  db.transaction(() => {
    for (const entryId of entryIds) deletedEntries += deleteEntry.run(entryId).changes;
  })();
}

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  apply,
  db: path.relative(process.cwd(), dbPath),
  baseline: path.relative(process.cwd(), baselinePath),
  report: path.relative(process.cwd(), reportPath),
  checkpoint: path.relative(process.cwd(), checkpointPath),
  report_source_ids: reportSourceIds.size,
  checkpoint_accepted_source_ids: checkpointAcceptedSourceIds.size,
  untracked_link_rows: candidateRows.length,
  untracked_senses: senseIds.length,
  untracked_entries: entryIds.length,
  unsafe_entries: unsafeEntries.length,
  deleted_entries: deletedEntries,
  preview: candidateRows.slice(0, 50)
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), ...output }, null, 2));

baseline.close();
db.close();

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
