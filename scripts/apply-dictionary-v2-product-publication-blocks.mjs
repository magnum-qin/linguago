import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";
const DEFAULT_BLOCKS = "config/dictionary-overrides/product-publication-blocks.json";
const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const blocksPath = path.resolve(args.blocks || DEFAULT_BLOCKS);
const apply = args.apply === "true";

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
if (!fs.existsSync(blocksPath)) throw new Error(`Blocks file not found: ${blocksPath}`);

const rows = JSON.parse(fs.readFileSync(blocksPath, "utf8"));
if (!Array.isArray(rows)) throw new Error("Publication blocks file must be a JSON array.");

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 30000");

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS product_sense_publication_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_sense_id INTEGER NOT NULL UNIQUE,
    block_code TEXT NOT NULL CHECK (block_code IN ('blocked_source_ambiguous', 'blocked_source_unstable', 'non_publishable')),
    rationale TEXT NOT NULL,
    recommendation TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_sense_id) REFERENCES product_senses(id) ON DELETE CASCADE
  )
`
).run();

const statements = {
  findById: db.prepare(`
    SELECT s.id, s.product_entry_id, s.sense_order, e.headword, e.primary_lang
    FROM product_senses s
    JOIN product_entries e ON e.id = s.product_entry_id
    WHERE s.id = ?
  `),
  findByEntryOrder: db.prepare(`
    SELECT s.id, s.product_entry_id, s.sense_order, e.headword, e.primary_lang
    FROM product_entries e
    JOIN product_senses s ON s.product_entry_id = e.id
    WHERE e.headword = @headword
      AND e.primary_lang = @primary_lang
      AND s.sense_order = @sense_order
    ORDER BY s.id
  `),
  upsertBlock: db.prepare(`
    INSERT INTO product_sense_publication_blocks
      (product_sense_id, block_code, rationale, recommendation, updated_at)
    VALUES
      (@product_sense_id, @block_code, @rationale, @recommendation, CURRENT_TIMESTAMP)
    ON CONFLICT(product_sense_id) DO UPDATE SET
      block_code = excluded.block_code,
      rationale = excluded.rationale,
      recommendation = excluded.recommendation,
      updated_at = CURRENT_TIMESTAMP
  `),
  markSenseNeedsReview: db.prepare(`
    UPDATE product_senses
    SET status = 'needs_review'
    WHERE id = ?
  `),
  markLocalizationsNeedsReview: db.prepare(`
    UPDATE product_localizations
    SET needs_review = 1,
        source = COALESCE(source, '') || '+publication-block'
    WHERE product_sense_id = ?
      AND needs_review = 0
  `),
  entryStatusCounts: db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM product_senses
    WHERE product_entry_id = ?
    GROUP BY status
  `),
  setEntryStatus: db.prepare("UPDATE product_entries SET status = ? WHERE id = ?"),
  blockSummary: db.prepare(`
    SELECT block_code, COUNT(*) AS count
    FROM product_sense_publication_blocks
    GROUP BY block_code
    ORDER BY block_code
  `)
};

const stats = {
  ok: true,
  apply,
  db: path.relative(process.cwd(), dbPath),
  blocks: path.relative(process.cwd(), blocksPath),
  seen: rows.length,
  resolved: 0,
  applied: 0,
  skipped: [],
  block_summary: []
};
const touchedEntryIds = new Set();

function resolveTarget(row) {
  const target = row.target || {};
  if (target.sense_id) return statements.findById.get(Number(target.sense_id));
  if (target.headword && target.primary_lang && target.sense_order) {
    return statements.findByEntryOrder.get({
      headword: target.headword,
      primary_lang: target.primary_lang,
      sense_order: Number(target.sense_order)
    });
  }
  return null;
}

function validateBlock(row) {
  if (!["blocked_source_ambiguous", "blocked_source_unstable", "non_publishable"].includes(row.block_code)) {
    return `invalid_block_code:${row.block_code}`;
  }
  if (!row.rationale || typeof row.rationale !== "string") return "missing_rationale";
  return null;
}

function updateEntryStatus(entryId) {
  const counts = statements.entryStatusCounts.all(entryId);
  const total = counts.reduce((sum, row) => sum + Number(row.count), 0);
  const accepted = counts.find((row) => row.status === "accepted")?.count || 0;
  const needsReview = counts.find((row) => row.status === "needs_review")?.count || 0;
  const ready = counts.find((row) => row.status === "ready_for_llm")?.count || 0;
  const status = accepted === total ? "accepted" : needsReview > 0 ? "needs_review" : ready > 0 ? "ready_for_llm" : "draft_single_source";
  statements.setEntryStatus.run(status, entryId);
}

const tx = db.transaction(() => {
  for (const row of rows) {
    const invalid = validateBlock(row);
    if (invalid) {
      stats.skipped.push({ target: row.target, reason: invalid });
      continue;
    }
    const sense = resolveTarget(row);
    if (!sense) {
      stats.skipped.push({ target: row.target, reason: "sense_not_found" });
      continue;
    }
    stats.resolved++;
    if (!apply) continue;
    statements.upsertBlock.run({
      product_sense_id: sense.id,
      block_code: row.block_code,
      rationale: row.rationale,
      recommendation: row.recommendation || null
    });
    statements.markSenseNeedsReview.run(sense.id);
    statements.markLocalizationsNeedsReview.run(sense.id);
    touchedEntryIds.add(sense.product_entry_id);
    stats.applied++;
  }

  for (const entryId of touchedEntryIds) updateEntryStatus(entryId);
});
tx();

stats.block_summary = statements.blockSummary.all();
console.log(JSON.stringify(stats, null, 2));
db.close();

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
