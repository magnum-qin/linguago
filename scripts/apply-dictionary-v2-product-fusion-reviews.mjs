import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_fused_only_pilot.db";
const DEFAULT_MODEL = "qwen3.6:latest";
const DEFAULT_PROMPT_VERSION = "dictionary-v2-product-fusion-review-v1";

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const model = args.model || DEFAULT_MODEL;
const promptVersion = args["prompt-version"] || DEFAULT_PROMPT_VERSION;
const keepThreshold = Number(args["keep-threshold"] || 0.8);
const splitThreshold = Number(args["split-threshold"] || 0.8);
const dryRun = args["dry-run"] === "true";
const keepAction = args["keep-action"] || "ready_for_llm";

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
if (!["ready_for_llm", "noop"].includes(keepAction)) {
  throw new Error("--keep-action must be one of: ready_for_llm, noop");
}

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 10000");
ensureApplySchema(db);

const latestReviews = db
  .prepare(
    `
    SELECT r.*
    FROM product_fusion_reviews r
    JOIN (
      SELECT product_sense_id, MAX(id) AS review_id
      FROM product_fusion_reviews
      WHERE model = ?
        AND prompt_version = ?
        AND status = 'accepted'
      GROUP BY product_sense_id
    ) latest ON latest.review_id = r.id
    ORDER BY r.id
  `
  )
  .all(model, promptVersion);

const statements = {
  entryForSense: db.prepare(`
    SELECT pe.id, pe.status, ps.status AS sense_status
    FROM product_senses ps
    JOIN product_entries pe ON pe.id = ps.product_entry_id
    WHERE ps.id = ?
  `),
  setSenseStatus: db.prepare(`
    UPDATE product_senses
    SET status = ?
    WHERE id = ?
  `),
  setEntryStatus: db.prepare(`
    UPDATE product_entries
    SET status = ?
    WHERE id = ?
  `),
  upsertSplitPlan: db.prepare(`
    INSERT INTO product_fusion_split_plans
      (review_id, product_entry_id, product_sense_id, decision, confidence, same_sense_score,
       rationale, suggested_groups_json, status)
    VALUES
      (@review_id, @product_entry_id, @product_sense_id, @decision, @confidence, @same_sense_score,
       @rationale, @suggested_groups_json, 'pending')
    ON CONFLICT(review_id) DO UPDATE SET
      decision = excluded.decision,
      confidence = excluded.confidence,
      same_sense_score = excluded.same_sense_score,
      rationale = excluded.rationale,
      suggested_groups_json = excluded.suggested_groups_json
  `),
  existingPlanBySense: db.prepare(`
    SELECT id
    FROM product_fusion_split_plans
    WHERE product_sense_id = ?
      AND status IN ('pending', 'sampled', 'applied')
    ORDER BY id DESC
    LIMIT 1
  `)
};

const stats = {
  db: path.relative(process.cwd(), dbPath),
  model,
  prompt_version: promptVersion,
  keep_threshold: keepThreshold,
  split_threshold: splitThreshold,
  reviewed_accepted: latestReviews.length,
  marked_ready_for_llm: 0,
  kept_unchanged: 0,
  marked_split_pending: 0,
  marked_needs_review: 0,
  skipped_low_confidence_keep: 0,
  skipped_low_confidence_split: 0,
  split_plans_upserted: 0,
  keep_action: keepAction,
  dry_run: dryRun
};

const apply = db.transaction((reviews) => {
  for (const review of reviews) {
    applyReview(review, true);
  }
});

if (dryRun) {
  for (const review of latestReviews) applyReview(review, false);
} else {
  apply(latestReviews);
}

const summary = {
  ok: true,
  stats,
  product_sense_status: db
    .prepare(
      `
      SELECT status, COUNT(*) AS count
      FROM product_senses
      GROUP BY status
      ORDER BY status
    `
    )
    .all(),
  product_entry_status: db
    .prepare(
      `
      SELECT status, COUNT(*) AS count
      FROM product_entries
      GROUP BY status
      ORDER BY status
    `
    )
    .all(),
  split_plan_status: db
    .prepare(
      `
      SELECT status, COUNT(*) AS count
      FROM product_fusion_split_plans
      GROUP BY status
      ORDER BY status
    `
    )
    .all(),
  ready_for_llm_sample: db
    .prepare(
      `
      SELECT pe.id, pe.headword, pe.frequency_rank, pe.source_count, pe.lang_count
      FROM product_entries pe
      JOIN product_senses ps ON ps.product_entry_id = pe.id
      WHERE ps.status = 'ready_for_llm'
      ORDER BY pe.frequency_rank, pe.id
      LIMIT 20
    `
    )
    .all(),
  split_plan_sample: db
    .prepare(
      `
      SELECT sp.product_entry_id, pe.headword, pe.frequency_rank, sp.confidence, sp.same_sense_score
      FROM product_fusion_split_plans sp
      JOIN product_entries pe ON pe.id = sp.product_entry_id
      WHERE sp.status = 'pending'
      ORDER BY pe.frequency_rank, sp.id
      LIMIT 20
    `
    )
    .all()
};

fs.writeFileSync(dbPath.replace(/\.db$/u, ".fusion-apply.summary.json"), JSON.stringify(summary, null, 2));
db.close();
console.log(JSON.stringify(summary, null, 2));

function ensureApplySchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS product_fusion_split_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id INTEGER NOT NULL UNIQUE,
      product_entry_id INTEGER NOT NULL,
      product_sense_id INTEGER NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN ('split', 'needs_review')),
      confidence REAL NOT NULL DEFAULT 0,
      same_sense_score REAL NOT NULL DEFAULT 0,
      rationale TEXT,
      suggested_groups_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sampled', 'applied', 'rejected')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_entry_id) REFERENCES product_entries(id) ON DELETE CASCADE,
      FOREIGN KEY (product_sense_id) REFERENCES product_senses(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_product_fusion_split_plans_status
      ON product_fusion_split_plans(status, confidence, product_entry_id);
  `);
}

function applyReview(review, write) {
  const entry = statements.entryForSense.get(review.product_sense_id);
  if (!entry) return;

  if (review.decision === "keep") {
    if (Number(review.confidence) < keepThreshold) {
      stats.skipped_low_confidence_keep++;
      return;
    }
    if (keepAction === "noop") {
      stats.kept_unchanged++;
      return;
    }
    if (write) {
      statements.setSenseStatus.run("ready_for_llm", review.product_sense_id);
      statements.setEntryStatus.run("ready_for_llm", review.product_entry_id);
    }
    stats.marked_ready_for_llm++;
    return;
  }

  if (review.decision === "split") {
    if (Number(review.confidence) < splitThreshold) {
      stats.skipped_low_confidence_split++;
      if (write) {
        statements.setSenseStatus.run("needs_review", review.product_sense_id);
        statements.setEntryStatus.run("needs_review", review.product_entry_id);
      }
      stats.marked_needs_review++;
      return;
    }
    if (write) {
      statements.setSenseStatus.run("needs_review", review.product_sense_id);
      statements.setEntryStatus.run("needs_review", review.product_entry_id);
      statements.upsertSplitPlan.run({
        review_id: review.id,
        product_entry_id: review.product_entry_id,
        product_sense_id: review.product_sense_id,
        decision: review.decision,
        confidence: review.confidence,
        same_sense_score: review.same_sense_score,
        rationale: review.rationale,
        suggested_groups_json: normalizeSuggestedGroups(review.suggested_groups_json, review.product_sense_id)
      });
    }
    stats.marked_split_pending++;
    stats.split_plans_upserted++;
    return;
  }

  if (write) {
    statements.setSenseStatus.run("needs_review", review.product_sense_id);
    statements.setEntryStatus.run("needs_review", review.product_entry_id);
  }
  stats.marked_needs_review++;
}

function normalizeSuggestedGroups(value, productSenseId) {
  let groups = [];
  try {
    groups = JSON.parse(value || "[]");
  } catch {
    groups = [];
  }
  if (!Array.isArray(groups)) groups = [];

  const links = db
    .prepare(
      `
      SELECT source_sense_id, source_lang, source_word
      FROM product_sense_source_links
      WHERE product_sense_id = ?
      ORDER BY source_frequency_rank, source_lang, source_sense_id
    `
    )
    .all(productSenseId)
    .map((link, index) => ({
      link_id: index + 1,
      ...link
    }));
  const byLinkId = new Map(links.map((link) => [Number(link.link_id), link]));

  return JSON.stringify(
    groups.map((group) => {
      const sourceLinkIds = Array.isArray(group.source_link_ids) ? group.source_link_ids.map(Number) : [];
      const resolvedLinks = sourceLinkIds.map((id) => byLinkId.get(id)).filter(Boolean);
      return {
        label: String(group.label || "").trim() || "group",
        source_link_ids: sourceLinkIds,
        source_sense_ids: resolvedLinks.map((link) => link.source_sense_id),
        source_words: resolvedLinks.map((link) => `${link.source_lang}:${link.source_word}`),
        reason: String(group.reason || "").trim()
      };
    }),
    null,
    2
  );
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
