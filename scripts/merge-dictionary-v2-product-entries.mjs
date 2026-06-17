import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_fused_only_pilot.db";

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const limit = args.limit ? Number(args.limit) : 0;
const dryRun = args["dry-run"] === "true";

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
if (limit && (!Number.isInteger(limit) || limit < 1)) throw new Error(`Invalid --limit: ${args.limit}`);

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 10000");

db.function("status_rank", (status) => {
  if (status === "accepted") return 1;
  if (status === "ready_for_llm") return 2;
  if (status === "needs_review") return 3;
  if (status === "draft_fused") return 4;
  if (status === "draft_single_source") return 5;
  return 9;
});

const statements = {
  duplicateGroups: db.prepare(`
    SELECT normalized_key, primary_lang, COUNT(*) AS entry_count
    FROM product_entries
    GROUP BY normalized_key, primary_lang
    HAVING COUNT(*) > 1
    ORDER BY MIN(frequency_rank) IS NULL, MIN(frequency_rank), normalized_key, primary_lang
    ${limit ? "LIMIT ?" : ""}
  `),
  entriesForGroup: db.prepare(`
    SELECT id, headword, normalized_key, primary_lang, frequency_rank, group_key, group_method,
           status, source_count, lang_count
    FROM product_entries
    WHERE normalized_key = ? AND primary_lang = ?
    ORDER BY frequency_rank IS NULL, frequency_rank, status_rank(status), id
  `),
  tempSenseOrders: db.prepare(`
    UPDATE product_senses
    SET sense_order = -id
    WHERE product_entry_id IN (
      SELECT value FROM json_each(?)
    )
  `),
  moveSenses: db.prepare(`
    UPDATE product_senses
    SET product_entry_id = ?
    WHERE product_entry_id = ?
  `),
  updateReviewsEntry: db.prepare(`
    UPDATE product_fusion_reviews
    SET product_entry_id = ?
    WHERE product_entry_id = ?
  `),
  updateSplitPlansEntry: db.prepare(`
    UPDATE product_fusion_split_plans
    SET product_entry_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE product_entry_id = ?
  `),
  deleteEntry: db.prepare(`
    DELETE FROM product_entries
    WHERE id = ?
  `),
  sensesForEntry: db.prepare(`
    SELECT ps.id, ps.status, ps.sense_order, ps.gloss_key,
           MIN(l.source_frequency_rank) AS min_source_rank,
           COUNT(l.id) AS link_count
    FROM product_senses ps
    LEFT JOIN product_sense_source_links l ON l.product_sense_id = ps.id
    WHERE ps.product_entry_id = ?
    GROUP BY ps.id
    ORDER BY
      CASE ps.status WHEN 'accepted' THEN 1 WHEN 'ready_for_llm' THEN 2 WHEN 'needs_review' THEN 3 ELSE 4 END,
      min_source_rank IS NULL,
      min_source_rank,
      ps.id
  `),
  setSenseOrder: db.prepare(`
    UPDATE product_senses
    SET sense_order = ?
    WHERE id = ?
  `),
  aggregateEntry: db.prepare(`
    SELECT
      COUNT(DISTINCT l.source_sense_id) AS source_count,
      COUNT(DISTINCT l.source_lang) AS lang_count,
      MIN(l.source_frequency_rank) AS frequency_rank
    FROM product_senses ps
    LEFT JOIN product_sense_source_links l ON l.product_sense_id = ps.id
    WHERE ps.product_entry_id = ?
  `),
  statusCounts: db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM product_senses
    WHERE product_entry_id = ?
    GROUP BY status
  `),
  updateEntry: db.prepare(`
    UPDATE product_entries
    SET status = @status,
        source_count = @source_count,
        lang_count = @lang_count,
        frequency_rank = @frequency_rank,
        group_method = @group_method
    WHERE id = @id
  `)
};

const stats = {
  db: path.relative(process.cwd(), dbPath),
  dry_run: dryRun,
  limit: limit || null,
  duplicate_groups_scanned: 0,
  groups_merged: 0,
  entries_deleted: 0,
  senses_moved: 0,
  senses_renumbered: 0
};

const groups = limit ? statements.duplicateGroups.all(limit) : statements.duplicateGroups.all();

const mergeAll = db.transaction((rows) => {
  for (const group of rows) mergeGroup(group, true);
});

if (dryRun) {
  for (const group of groups) mergeGroup(group, false);
} else {
  mergeAll(groups);
}

const summary = {
  ok: true,
  stats,
  duplicate_groups_remaining: db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM (
        SELECT 1
        FROM product_entries
        GROUP BY normalized_key, primary_lang
        HAVING COUNT(*) > 1
      )
    `)
    .get().count,
  product_entry_status: db
    .prepare(`
      SELECT status, COUNT(*) AS count
      FROM product_entries
      GROUP BY status
      ORDER BY status
    `)
    .all(),
  merged_sample: db
    .prepare(`
      SELECT pe.headword, pe.primary_lang, pe.frequency_rank, pe.status, COUNT(ps.id) AS senses
      FROM product_entries pe
      JOIN product_senses ps ON ps.product_entry_id = pe.id
      GROUP BY pe.id
      HAVING senses > 1
      ORDER BY pe.frequency_rank IS NULL, pe.frequency_rank, pe.id
      LIMIT 20
    `)
    .all()
};

fs.writeFileSync(dbPath.replace(/\.db$/u, ".entry-merge.summary.json"), JSON.stringify(summary, null, 2));
db.close();
console.log(JSON.stringify(summary, null, 2));

function mergeGroup(group, write) {
  stats.duplicate_groups_scanned++;
  const entries = statements.entriesForGroup.all(group.normalized_key, group.primary_lang);
  if (entries.length < 2) return;

  const keeper = chooseKeeper(entries);
  const losers = entries.filter((entry) => entry.id !== keeper.id);

  if (write) {
    statements.tempSenseOrders.run(JSON.stringify(entries.map((entry) => entry.id)));
    for (const loser of losers) {
      const moved = statements.moveSenses.run(keeper.id, loser.id).changes;
      statements.updateReviewsEntry.run(keeper.id, loser.id);
      statements.updateSplitPlansEntry.run(keeper.id, loser.id);
      statements.deleteEntry.run(loser.id);
      stats.senses_moved += moved;
    }
    stats.senses_renumbered += renumberSenses(keeper.id);
    refreshEntry(keeper, entries);
  } else {
    const loserIds = new Set(losers.map((entry) => entry.id));
    const moved = db
      .prepare(
        `SELECT COUNT(*) AS count FROM product_senses WHERE product_entry_id IN (${losers.map(() => "?").join(",")})`
      )
      .get(...losers.map((entry) => entry.id)).count;
    stats.senses_moved += moved;
  }

  stats.groups_merged++;
  stats.entries_deleted += losers.length;
}

function chooseKeeper(entries) {
  return [...entries].sort((a, b) => {
    const rankA = a.frequency_rank ?? Number.MAX_SAFE_INTEGER;
    const rankB = b.frequency_rank ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    const statusA = statusRank(a.status);
    const statusB = statusRank(b.status);
    if (statusA !== statusB) return statusA - statusB;
    return a.id - b.id;
  })[0];
}

function statusRank(status) {
  if (status === "accepted") return 1;
  if (status === "ready_for_llm") return 2;
  if (status === "needs_review") return 3;
  if (status === "draft_fused") return 4;
  if (status === "draft_single_source") return 5;
  return 9;
}

function renumberSenses(productEntryId) {
  const senses = statements.sensesForEntry.all(productEntryId);
  senses.forEach((sense, index) => statements.setSenseOrder.run(index + 1, sense.id));
  return senses.length;
}

function refreshEntry(keeper, entries) {
  const aggregate = statements.aggregateEntry.get(keeper.id);
  const statuses = statements.statusCounts.all(keeper.id);
  const total = statuses.reduce((sum, row) => sum + Number(row.count), 0);
  const accepted = statuses.find((row) => row.status === "accepted")?.count || 0;
  const hasNeedsReview = statuses.some((row) => row.status === "needs_review");
  const hasDraft = statuses.some((row) => row.status.startsWith("draft_"));
  const status =
    accepted === total ? "accepted" : hasNeedsReview || hasDraft ? "needs_review" : "ready_for_llm";
  const methods = [...new Set(entries.map((entry) => entry.group_method).filter(Boolean))];

  statements.updateEntry.run({
    id: keeper.id,
    status,
    source_count: aggregate.source_count || 0,
    lang_count: aggregate.lang_count || 0,
    frequency_rank: aggregate.frequency_rank,
    group_method: methods.length > 1 ? "merged_product_entry" : keeper.group_method
  });
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
