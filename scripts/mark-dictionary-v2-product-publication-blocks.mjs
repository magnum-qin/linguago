import Database from "better-sqlite3";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";
const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const dryRun = args["dry-run"] === "true";

const blocks = [
  {
    product_sense_id: 24,
    block_code: "blocked_source_ambiguous",
    rationale:
      "JMdict-derived source is only 'Group for ta'. The gloss is too generic to safely publish a four-language dictionary sense without re-splitting from source.",
    recommendation: "Rebuild from original JMdict sense details or keep unpublished."
  },
  {
    product_sense_id: 5431,
    block_code: "blocked_source_unstable",
    rationale:
      "Source is the Japanese particle/short form 'do' with unstable generated cross-language meanings. Current en/pt-BR/zh outputs disagree and should not be published as a stable lexical sense.",
    recommendation: "Re-check original JMdict sense and either split a precise particle sense or keep unpublished."
  }
];

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 30000");

const createTable = db.prepare(`
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
`);
createTable.run();

const statements = {
  upsertBlock: db.prepare(`
    INSERT INTO product_sense_publication_blocks
      (product_sense_id, block_code, rationale, recommendation)
    VALUES
      (@product_sense_id, @block_code, @rationale, @recommendation)
    ON CONFLICT(product_sense_id) DO UPDATE SET
      block_code = excluded.block_code,
      rationale = excluded.rationale,
      recommendation = excluded.recommendation,
      updated_at = CURRENT_TIMESTAMP
  `),
  blockSummary: db.prepare(`
    SELECT b.block_code, COUNT(*) AS count
    FROM product_sense_publication_blocks b
    GROUP BY b.block_code
    ORDER BY b.block_code
  `),
  actionableNeedsReview: db.prepare(`
    SELECT COUNT(*) AS count
    FROM product_senses ps
    WHERE ps.status = 'needs_review'
      AND NOT EXISTS (
        SELECT 1
        FROM product_sense_publication_blocks b
        WHERE b.product_sense_id = ps.id
      )
  `)
};

const stats = {
  db: path.relative(process.cwd(), dbPath),
  dry_run: dryRun,
  planned_blocks: blocks.length,
  applied_blocks: 0,
  block_summary: [],
  actionable_needs_review: null
};

if (!dryRun) {
  const tx = db.transaction(() => {
    for (const block of blocks) {
      statements.upsertBlock.run(block);
      stats.applied_blocks++;
    }
  });
  tx();
  stats.block_summary = statements.blockSummary.all();
  stats.actionable_needs_review = statements.actionableNeedsReview.get().count;
} else {
  stats.applied_blocks = blocks.length;
}

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
