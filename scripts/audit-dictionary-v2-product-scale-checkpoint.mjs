import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const dbPath = requiredPath(args.db, 'db');
const checkpointPath = requiredPath(args.checkpoint, 'checkpoint');
const expectedCompleted = integer(args['expected-completed'], null, 0);
const expectedAccepted = integer(args['expected-accepted'], null, 0);
const allowSafeConsolidation = args['allow-safe-consolidation'] === 'true';

const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
const items = Object.values(checkpoint.items || {});
const completed = items.filter((row) => row?.status === 'accepted' || row?.status === 'rejected');
const accepted = items.filter((row) => row?.status === 'accepted');
const rejected = items.filter((row) => row?.status === 'rejected');
const uniqueKeys = new Set(completed.map(candidateKey));

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
db.pragma('query_only = ON');
const scalar = (sql) => Number(db.prepare(sql).get().n);
const productSenseIds = accepted.map((row) => Number(row.product_sense_id)).filter(Number.isInteger);
const uniqueProductSenseIds = [...new Set(productSenseIds)];
const consolidation = classifyConsolidation(accepted);
const placeholders = productSenseIds.map(() => '?').join(', ');
const checkpointScalar = (sql) => productSenseIds.length ? Number(db.prepare(sql).get(...productSenseIds).n) : 0;
const counts = {
  draft_entries: scalar("SELECT COUNT(*) n FROM product_entries WHERE status = 'draft_single_source'"),
  draft_senses: scalar("SELECT COUNT(*) n FROM product_senses WHERE status = 'draft_single_source'"),
  draft_localizations: scalar(`
    SELECT COUNT(*) n
    FROM product_localizations pl
    JOIN product_senses ps ON ps.id = pl.product_sense_id
    WHERE ps.status = 'draft_single_source'
  `),
  bad_draft_localization_counts: scalar(`
    SELECT COUNT(*) n FROM (
      SELECT ps.id
      FROM product_senses ps
      LEFT JOIN product_localizations pl ON pl.product_sense_id = ps.id
      WHERE ps.status = 'draft_single_source'
      GROUP BY ps.id
      HAVING COUNT(DISTINCT pl.lang) <> 4
    )
  `),
  historical_duplicate_source_links: scalar(`
    SELECT COUNT(*) n FROM (
      SELECT source_sense_id
      FROM product_sense_source_links
      GROUP BY source_sense_id
      HAVING COUNT(*) > 1
    )
  `),
  checkpoint_senses: checkpointScalar(`
    SELECT COUNT(*) n FROM product_senses
    WHERE id IN (${placeholders}) AND status = 'draft_single_source'
  `),
  checkpoint_localizations: checkpointScalar(`
    SELECT COUNT(*) n FROM product_localizations
    WHERE product_sense_id IN (${placeholders})
  `),
  checkpoint_source_links: checkpointScalar(`
    SELECT COUNT(*) n FROM product_sense_source_links
    WHERE product_sense_id IN (${placeholders})
  `),
  duplicate_checkpoint_product_sense_ids: productSenseIds.length - new Set(productSenseIds).size
};
db.close();

const failures = [];
if (completed.length !== uniqueKeys.size) failures.push('duplicate_checkpoint_candidate_keys');
if (counts.bad_draft_localization_counts) failures.push('bad_draft_localization_counts');
if (
  counts.duplicate_checkpoint_product_sense_ids &&
  (!allowSafeConsolidation || consolidation.unsafe_groups.length)
) failures.push('duplicate_checkpoint_product_sense_ids');
if (counts.checkpoint_senses !== uniqueProductSenseIds.length) failures.push('checkpoint_sense_count_mismatch');
if (counts.checkpoint_localizations !== uniqueProductSenseIds.length * 4) failures.push('checkpoint_localization_count_mismatch');
if (counts.checkpoint_source_links !== accepted.length) failures.push('checkpoint_source_link_count_mismatch');
if (expectedCompleted != null && completed.length !== expectedCompleted) failures.push('unexpected_completed_count');
if (expectedAccepted != null && accepted.length !== expectedAccepted) failures.push('unexpected_accepted_count');

const output = {
  ok: failures.length === 0,
  db: relative(dbPath),
  checkpoint: relative(checkpointPath),
  checkpoint_counts: {
    items: items.length,
    completed: completed.length,
    accepted: accepted.length,
    rejected: rejected.length,
    unique_candidate_keys: uniqueKeys.size
  },
  consolidation: {
    allowed: allowSafeConsolidation,
    unique_product_senses: uniqueProductSenseIds.length,
    duplicate_rows: counts.duplicate_checkpoint_product_sense_ids,
    safe_groups: consolidation.safe_groups,
    unsafe_groups: consolidation.unsafe_groups
  },
  database_counts: counts,
  failures
};
console.log(JSON.stringify(output, null, 2));
if (!output.ok) process.exitCode = 1;

function candidateKey(row) {
  return `${Number(row?.source_entry_id)}:${Number(row?.source_sense_id)}`;
}

function classifyConsolidation(rows) {
  const byProductSense = new Map();
  for (const row of rows) {
    const senseId = Number(row?.product_sense_id);
    if (!Number.isInteger(senseId)) continue;
    if (!byProductSense.has(senseId)) byProductSense.set(senseId, []);
    byProductSense.get(senseId).push(row);
  }
  let safeGroups = 0;
  const unsafeGroups = [];
  for (const [productSenseId, group] of byProductSense) {
    if (group.length < 2) continue;
    const sourceEntries = unique(group.map((row) => Number(row?.source_entry_id)));
    const glosses = unique(group.map((row) => normalize(row?.generated_item?.output?.gloss_key)));
    const partsOfSpeech = unique(
      group
        .map((row) => canonicalPartOfSpeech(row?.generated_item?.output?.part_of_speech))
        .filter(Boolean)
    );
    if (sourceEntries.length === 1 && glosses.length === 1 && partsOfSpeech.length <= 1) {
      safeGroups++;
      continue;
    }
    unsafeGroups.push({
      product_sense_id: productSenseId,
      candidate_count: group.length,
      source_entry_ids: sourceEntries,
      gloss_keys: glosses,
      parts_of_speech: partsOfSpeech
    });
  }
  return { safe_groups: safeGroups, unsafe_groups: unsafeGroups };
}

function canonicalPartOfSpeech(value) {
  const normalized = normalize(value);
  return ({ adj: 'adjective', adv: 'adverb', n: 'noun', v: 'verb', prep: 'preposition' })[normalized] || normalized;
}

function normalize(value) {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ');
}

function unique(values) {
  return [...new Set(values)];
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const result = path.resolve(value);
  if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`);
  return result;
}

function integer(value, fallback, min) {
  if (value == null) return fallback;
  const result = Number(value);
  if (!Number.isInteger(result) || result < min) throw new Error(`Invalid integer: ${value}`);
  return result;
}

function relative(value) {
  return path.relative(process.cwd(), value);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    result[key] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return result;
}
