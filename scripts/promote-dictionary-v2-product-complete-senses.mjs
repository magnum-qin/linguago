import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";
const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const dryRun = args["dry-run"] !== "false";

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 30000");

const completeSenseIds = db
  .prepare(
    `
    SELECT ps.id
    FROM product_senses ps
    WHERE ps.status <> 'accepted'
      AND ps.id IN (
        SELECT product_sense_id
        FROM product_localizations
        WHERE needs_review = 0
          AND NULLIF(TRIM(term), '') IS NOT NULL
          AND NULLIF(TRIM(definition), '') IS NOT NULL
        GROUP BY product_sense_id
        HAVING COUNT(DISTINCT lang) = 4
      )
      AND NOT EXISTS (
        SELECT 1
        FROM product_localizations pl_review
        WHERE pl_review.product_sense_id = ps.id
          AND pl_review.needs_review = 1
      )
    ORDER BY ps.id
  `
  )
  .all()
  .map((row) => row.id);

const statements = {
  promoteSense: db.prepare(`
    UPDATE product_senses
    SET status = 'accepted'
    WHERE id = ?
  `),
  affectedEntries: db.prepare(`
    SELECT DISTINCT product_entry_id
    FROM product_senses
    WHERE id IN (${completeSenseIds.map(() => "?").join(",") || "NULL"})
  `),
  entryStatusCounts: db.prepare(`
    SELECT status, COUNT(1) AS count
    FROM product_senses
    WHERE product_entry_id = ?
    GROUP BY status
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
  updateEntry: db.prepare(`
    UPDATE product_entries
    SET status = @status,
        source_count = @source_count,
        lang_count = @lang_count,
        frequency_rank = COALESCE(@frequency_rank, frequency_rank)
    WHERE id = @id
  `)
};

const affectedEntryIds = completeSenseIds.length ? statements.affectedEntries.all(...completeSenseIds).map((row) => row.product_entry_id) : [];

if (!dryRun) {
  const tx = db.transaction(() => {
    for (const senseId of completeSenseIds) statements.promoteSense.run(senseId);
    for (const entryId of affectedEntryIds) updateEntryStatus(entryId);
  });
  tx();
}

const summary = {
  db: path.relative(process.cwd(), dbPath),
  dry_run: dryRun,
  senses_promoted: dryRun ? 0 : completeSenseIds.length,
  senses_planned: completeSenseIds.length,
  entries_touched: affectedEntryIds.length
};

console.log(JSON.stringify(summary, null, 2));
db.close();

function updateEntryStatus(entryId) {
  const counts = statements.entryStatusCounts.all(entryId);
  const total = counts.reduce((sum, row) => sum + Number(row.count), 0);
  const accepted = counts.find((row) => row.status === "accepted")?.count || 0;
  const needsReview = counts.find((row) => row.status === "needs_review")?.count || 0;
  const ready = counts.find((row) => row.status === "ready_for_llm")?.count || 0;
  const status = accepted === total ? "accepted" : needsReview > 0 ? "needs_review" : ready > 0 ? "ready_for_llm" : "draft_single_source";
  const aggregate = statements.aggregateEntry.get(entryId);
  statements.updateEntry.run({
    id: entryId,
    status,
    source_count: aggregate.source_count || 0,
    lang_count: aggregate.lang_count || 0,
    frequency_rank: aggregate.frequency_rank
  });
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = "true";
    else {
      parsed[key] = next;
      index++;
    }
  }
  return parsed;
}
