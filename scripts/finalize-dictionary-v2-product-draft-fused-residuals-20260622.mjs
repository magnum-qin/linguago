import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";
const PROMPT_VERSION = "dictionary-v2-product-fusion-review-v3-draft-fused-only";
const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const dryRun = args["dry-run"] !== "false";

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 30000");

const statements = {
  draftFused: db.prepare(`
    SELECT ps.id AS sense_id, ps.product_entry_id, ps.part_of_speech, ps.gloss_key, ps.confidence,
           pe.headword, pe.primary_lang, pe.frequency_rank,
           r.id AS review_id, r.status AS review_status, r.decision, r.confidence AS review_confidence,
           r.rationale, r.suggested_groups_json, r.error
    FROM product_senses ps
    JOIN product_entries pe ON pe.id = ps.product_entry_id
    LEFT JOIN product_fusion_reviews r ON r.id = (
      SELECT MAX(r2.id)
      FROM product_fusion_reviews r2
      WHERE r2.product_sense_id = ps.id
        AND r2.prompt_version = ?
    )
    WHERE ps.status = 'draft_fused'
    ORDER BY pe.frequency_rank IS NULL, pe.frequency_rank, ps.id
  `),
  links: db.prepare(`
    SELECT id, source_lang, source_word
    FROM product_sense_source_links
    WHERE product_sense_id = ?
    ORDER BY source_frequency_rank IS NULL, source_frequency_rank, source_lang, source_sense_id, id
  `),
  setReady: db.prepare(`
    UPDATE product_senses
    SET status = 'ready_for_llm',
        gloss_key = @gloss_key,
        part_of_speech = COALESCE(@part_of_speech, part_of_speech),
        confidence = @confidence
    WHERE id = @sense_id
      AND status = 'draft_fused'
  `),
  setNeedsReview: db.prepare(`
    UPDATE product_senses
    SET status = 'needs_review'
    WHERE id = ?
      AND status = 'draft_fused'
  `),
  deleteLocalizations: db.prepare("DELETE FROM product_localizations WHERE product_sense_id = ?"),
  deleteExamples: db.prepare("DELETE FROM product_examples WHERE product_sense_id = ?"),
  upsertBlock: db.prepare(`
    INSERT INTO product_sense_publication_blocks
      (product_sense_id, block_code, rationale, recommendation, updated_at)
    VALUES
      (@sense_id, @block_code, @rationale, @recommendation, CURRENT_TIMESTAMP)
    ON CONFLICT(product_sense_id) DO UPDATE SET
      block_code = excluded.block_code,
      rationale = excluded.rationale,
      recommendation = excluded.recommendation,
      updated_at = CURRENT_TIMESTAMP
  `),
  entrySenseStatuses: db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM product_senses
    WHERE product_entry_id = ?
    GROUP BY status
  `),
  setEntryStatus: db.prepare("UPDATE product_entries SET status = ? WHERE id = ?")
};

const stats = {
  db: path.relative(process.cwd(), dbPath),
  dry_run: dryRun,
  scanned: 0,
  marked_ready_for_llm: 0,
  marked_needs_review: 0,
  blocks_upserted: 0,
  localizations_deleted: 0,
  examples_deleted: 0,
  reasons: {}
};

const touchedEntries = new Set();

function classify(row) {
  const links = statements.links.all(row.sense_id);
  let groups = [];
  try {
    groups = JSON.parse(row.suggested_groups_json || "[]");
  } catch {
    groups = [];
  }
  const nonemptyGroups = groups.filter((group) => Array.isArray(group?.source_link_ids) && group.source_link_ids.length);
  const used = new Set(nonemptyGroups.flatMap((group) => group.source_link_ids.map(Number).filter(Number.isInteger)));
  const fullCoverage = links.length > 0 && used.size === links.length;
  const duplicateFree = used.size === nonemptyGroups.reduce((sum, group) => sum + group.source_link_ids.length, 0);

  if (nonemptyGroups.length === 1 && fullCoverage && duplicateFree) {
    const group = nonemptyGroups[0];
    return {
      action: "ready",
      reason: "single_supported_group",
      gloss_key: normalizeGlossKey(group.label || row.gloss_key),
      part_of_speech: inferPartOfSpeech(group.label, row.part_of_speech),
      confidence: Math.min(Number(row.confidence) || 0.8, Number(row.review_confidence) || 0.8)
    };
  }

  return {
    action: "block",
    reason:
      nonemptyGroups.length === 0
        ? "no_supported_group"
        : !fullCoverage
          ? "incomplete_source_link_coverage"
          : "multiple_supported_groups_need_manual_split",
    rationale: [
      `Residual draft_fused sense could not be safely normalized automatically.`,
      `Latest review status=${row.review_status || "missing"}, decision=${row.decision || "missing"}, confidence=${row.review_confidence ?? "n/a"}.`,
      `Supported groups=${nonemptyGroups.length}, covered source links=${used.size}/${links.length}.`,
      row.error ? `Review error: ${row.error}` : "",
      row.rationale ? `Review rationale: ${row.rationale}` : ""
    ]
      .filter(Boolean)
      .join(" ")
  };
}

function applyRow(row) {
  stats.scanned++;
  const classification = classify(row);
  stats.reasons[classification.reason] = (stats.reasons[classification.reason] || 0) + 1;
  touchedEntries.add(row.product_entry_id);

  if (classification.action === "ready") {
    if (!dryRun) {
      statements.setReady.run({
        sense_id: row.sense_id,
        gloss_key: classification.gloss_key,
        part_of_speech: classification.part_of_speech,
        confidence: classification.confidence
      });
      stats.localizations_deleted += statements.deleteLocalizations.run(row.sense_id).changes;
      stats.examples_deleted += statements.deleteExamples.run(row.sense_id).changes;
    }
    stats.marked_ready_for_llm++;
    return;
  }

  if (!dryRun) {
    statements.setNeedsReview.run(row.sense_id);
    statements.upsertBlock.run({
      sense_id: row.sense_id,
      block_code: "blocked_source_ambiguous",
      rationale: classification.rationale,
      recommendation: "Rebuild this sense from original source dictionary rows or manually split with source-backed groups before publication."
    });
  }
  stats.marked_needs_review++;
  stats.blocks_upserted++;
}

function updateEntryStatus(productEntryId) {
  const statuses = statements.entrySenseStatuses.all(productEntryId);
  const total = statuses.reduce((sum, row) => sum + Number(row.count), 0);
  const accepted = statuses.find((row) => row.status === "accepted")?.count || 0;
  const needsReview = statuses.find((row) => row.status === "needs_review")?.count || 0;
  const ready = statuses.find((row) => row.status === "ready_for_llm")?.count || 0;
  const draft = statuses.find((row) => row.status.startsWith("draft_"));
  const status = accepted === total ? "accepted" : needsReview ? "needs_review" : ready ? "ready_for_llm" : draft ? "draft_fused" : "accepted";
  statements.setEntryStatus.run(status, productEntryId);
}

const rows = statements.draftFused.all(PROMPT_VERSION);
if (!dryRun) {
  db.transaction(() => {
    for (const row of rows) applyRow(row);
    for (const entryId of touchedEntries) updateEntryStatus(entryId);
  })();
} else {
  for (const row of rows) applyRow(row);
}

const summary = {
  ok: true,
  stats,
  product_sense_status: db
    .prepare("SELECT status, COUNT(*) AS count FROM product_senses GROUP BY status ORDER BY status")
    .all(),
  product_entry_status: db
    .prepare("SELECT status, COUNT(*) AS count FROM product_entries GROUP BY status ORDER BY status")
    .all()
};

console.log(JSON.stringify(summary, null, 2));
db.close();

function normalizeGlossKey(value) {
  return String(value || "source-backed sense")
    .replace(/^Meaning\s+\d+:\s*/iu, "")
    .replace(/^Noun:\s*/iu, "")
    .replace(/^Verb:\s*/iu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 180);
}

function inferPartOfSpeech(label, fallback) {
  const text = String(label || "").toLowerCase();
  if (text.includes("verb")) return "verb";
  if (text.includes("noun")) return "noun";
  if (text.includes("adjective")) return "adjective";
  if (text.includes("adverb")) return "adverb";
  return fallback || null;
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
