import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_fused_only_pilot.db";
const DEFAULT_CONFIDENCE_THRESHOLD = 0.8;

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const limit = args.limit ? Number(args.limit) : 0;
const confidenceThreshold = Number(args["confidence-threshold"] || DEFAULT_CONFIDENCE_THRESHOLD);
const dryRun = args["dry-run"] === "true";
const clearGeneratedContent = args["clear-generated-content"] !== "false";

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
if (!Number.isFinite(confidenceThreshold) || confidenceThreshold < 0 || confidenceThreshold > 1) {
  throw new Error(`Invalid --confidence-threshold: ${args["confidence-threshold"]}`);
}
if (limit && (!Number.isInteger(limit) || limit < 1)) {
  throw new Error(`Invalid --limit: ${args.limit}`);
}

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 10000");

const statements = {
  pendingPlans: db.prepare(`
    SELECT sp.*, pe.headword, pe.frequency_rank
    FROM product_fusion_split_plans sp
    JOIN product_entries pe ON pe.id = sp.product_entry_id
    WHERE sp.status = 'pending'
      AND sp.decision = 'split'
      AND sp.confidence >= ?
    ORDER BY pe.frequency_rank IS NULL, pe.frequency_rank, sp.confidence DESC, sp.id
    ${limit ? "LIMIT ?" : ""}
  `),
  productSense: db.prepare(`
    SELECT id, product_entry_id, sense_order, part_of_speech, gloss_key, status, confidence
    FROM product_senses
    WHERE id = ?
  `),
  sourceLinks: db.prepare(`
    SELECT id, product_sense_id, source_entry_id, source_sense_id, source_lang, source_word,
           source_frequency_rank, match_method, confidence
    FROM product_sense_source_links
    WHERE product_sense_id = ?
    ORDER BY source_frequency_rank IS NULL, source_frequency_rank, source_lang, source_sense_id, id
  `),
  insertSense: db.prepare(`
    INSERT INTO product_senses
      (product_entry_id, sense_order, part_of_speech, gloss_key, status, confidence)
    VALUES
      (@product_entry_id, @sense_order, @part_of_speech, @gloss_key, @status, @confidence)
  `),
  updateSenseMetadata: db.prepare(`
    UPDATE product_senses
    SET part_of_speech = @part_of_speech,
        gloss_key = @gloss_key,
        status = @status,
        confidence = @confidence
    WHERE id = @id
  `),
  moveSourceLink: db.prepare(`
    UPDATE product_sense_source_links
    SET product_sense_id = ?
    WHERE id = ?
  `),
  deleteLocalizations: db.prepare(`
    DELETE FROM product_localizations
    WHERE product_sense_id = ?
  `),
  deleteExamples: db.prepare(`
    DELETE FROM product_examples
    WHERE product_sense_id = ?
  `),
  setPlanStatus: db.prepare(`
    UPDATE product_fusion_split_plans
    SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),
  setPlanRejected: db.prepare(`
    UPDATE product_fusion_split_plans
    SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),
  entrySenses: db.prepare(`
    SELECT id
    FROM product_senses
    WHERE product_entry_id = ?
    ORDER BY id
  `),
  tempSenseOrder: db.prepare(`
    UPDATE product_senses
    SET sense_order = -id
    WHERE product_entry_id = ?
  `),
  setSenseOrder: db.prepare(`
    UPDATE product_senses
    SET sense_order = ?
    WHERE id = ?
  `),
  entrySenseStatuses: db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM product_senses
    WHERE product_entry_id = ?
    GROUP BY status
  `),
  setEntryStatus: db.prepare(`
    UPDATE product_entries
    SET status = ?
    WHERE id = ?
  `)
};

const stats = {
  db: path.relative(process.cwd(), dbPath),
  confidence_threshold: confidenceThreshold,
  limit: limit || null,
  dry_run: dryRun,
  clear_generated_content: clearGeneratedContent,
  plans_scanned: 0,
  plans_applied: 0,
  plans_rejected: 0,
  plans_skipped: 0,
  senses_created: 0,
  source_links_moved: 0,
  localizations_deleted: 0,
  examples_deleted: 0,
  validation_errors: {}
};

const plans = limit
  ? statements.pendingPlans.all(confidenceThreshold, limit)
  : statements.pendingPlans.all(confidenceThreshold);

const applyAll = db.transaction((rows) => {
  for (const plan of rows) applyPlan(plan, true);
});

if (dryRun) {
  for (const plan of plans) applyPlan(plan, false);
} else {
  applyAll(plans);
}

const summary = {
  ok: true,
  stats,
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
  applied_sample: db
    .prepare(
      `
      SELECT sp.id AS plan_id, pe.headword, pe.frequency_rank, sp.confidence, sp.status
      FROM product_fusion_split_plans sp
      JOIN product_entries pe ON pe.id = sp.product_entry_id
      WHERE sp.status = 'applied'
      ORDER BY sp.updated_at DESC, sp.id DESC
      LIMIT 20
    `
    )
    .all()
};

fs.writeFileSync(dbPath.replace(/\.db$/u, ".split-apply.summary.json"), JSON.stringify(summary, null, 2));
db.close();
console.log(JSON.stringify(summary, null, 2));

function applyPlan(plan, write) {
  stats.plans_scanned++;

  const sense = statements.productSense.get(plan.product_sense_id);
  if (!sense) return rejectOrSkip(plan, "missing_product_sense", write);
  if (sense.product_entry_id !== plan.product_entry_id) {
    return rejectOrSkip(plan, "entry_sense_mismatch", write);
  }

  const links = statements.sourceLinks.all(plan.product_sense_id);
  const validation = validateGroups(plan, links);
  if (!validation.ok) return rejectOrSkip(plan, validation.reason, write);

  const splitGroups = validation.groups;
  const createdSenseIds = [];
  const groupSenseIds = new Map([[0, sense.id]]);

  if (write) {
    const firstGroup = splitGroups[0];
    statements.updateSenseMetadata.run({
      id: sense.id,
      part_of_speech: normalizePartOfSpeech(sense.part_of_speech, firstGroup),
      gloss_key: normalizeGlossKey(sense.gloss_key, firstGroup),
      status: "ready_for_llm",
      confidence: Math.min(Number(sense.confidence) || 1, Number(plan.confidence) || 1)
    });

    for (let index = 1; index < splitGroups.length; index++) {
      const group = splitGroups[index];
      const result = statements.insertSense.run({
        product_entry_id: plan.product_entry_id,
        sense_order: -Number(`${Date.now()}${index}`),
        part_of_speech: normalizePartOfSpeech(sense.part_of_speech, group),
        gloss_key: normalizeGlossKey(sense.gloss_key, group),
        status: "ready_for_llm",
        confidence: Math.min(Number(sense.confidence) || 1, Number(plan.confidence) || 1)
      });
      const newSenseId = Number(result.lastInsertRowid);
      createdSenseIds.push(newSenseId);
      groupSenseIds.set(index, newSenseId);
    }

    for (let index = 0; index < splitGroups.length; index++) {
      const targetSenseId = groupSenseIds.get(index);
      for (const link of splitGroups[index].links) {
        if (link.product_sense_id !== targetSenseId) {
          statements.moveSourceLink.run(targetSenseId, link.id);
          stats.source_links_moved++;
        }
      }
    }

    if (clearGeneratedContent) {
      for (const productSenseId of [sense.id, ...createdSenseIds]) {
        stats.localizations_deleted += statements.deleteLocalizations.run(productSenseId).changes;
        stats.examples_deleted += statements.deleteExamples.run(productSenseId).changes;
      }
    }

    renumberEntrySenses(plan.product_entry_id);
    updateEntryStatus(plan.product_entry_id);
    statements.setPlanStatus.run("applied", plan.id);
  } else {
    stats.source_links_moved += splitGroups.slice(1).reduce((sum, group) => sum + group.links.length, 0);
  }

  stats.senses_created += Math.max(0, splitGroups.length - 1);
  stats.plans_applied++;
}

function validateGroups(plan, links) {
  if (links.length < 2) return { ok: false, reason: "not_enough_source_links" };

  let groups;
  try {
    groups = JSON.parse(plan.suggested_groups_json || "[]");
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (!Array.isArray(groups) || groups.length < 2) return { ok: false, reason: "not_enough_groups" };

  const linksByOrdinal = new Map(links.map((link, index) => [index + 1, link]));
  const used = new Set();
  const normalizedGroups = [];

  for (const rawGroup of groups) {
    const sourceLinkIds = Array.isArray(rawGroup?.source_link_ids)
      ? rawGroup.source_link_ids.map(Number).filter((id) => Number.isInteger(id) && id > 0)
      : [];
    if (!sourceLinkIds.length) return { ok: false, reason: "group_without_source_links" };

    const groupLinks = [];
    for (const sourceLinkId of sourceLinkIds) {
      const link = linksByOrdinal.get(sourceLinkId);
      if (!link) return { ok: false, reason: "unknown_source_link_id" };
      if (used.has(sourceLinkId)) return { ok: false, reason: "duplicate_source_link_id" };
      used.add(sourceLinkId);
      groupLinks.push(link);
    }

    normalizedGroups.push({
      label: String(rawGroup?.label || "").trim(),
      reason: String(rawGroup?.reason || "").trim(),
      links: groupLinks
    });
  }

  if (used.size !== links.length) return { ok: false, reason: "incomplete_source_link_coverage" };
  return { ok: true, groups: normalizedGroups };
}

function rejectOrSkip(plan, reason, write) {
  stats.validation_errors[reason] = (stats.validation_errors[reason] || 0) + 1;
  if (write) {
    statements.setPlanRejected.run(plan.id);
    stats.plans_rejected++;
  } else {
    stats.plans_skipped++;
  }
}

function normalizeGlossKey(originalGlossKey, group) {
  const label = group.label || group.reason || originalGlossKey || "split sense";
  return truncateText(label.replace(/\s+/gu, " ").trim(), 180) || "split sense";
}

function normalizePartOfSpeech(originalPartOfSpeech, group) {
  const label = group.label.toLowerCase();
  const fromLabel = ["noun", "verb", "adjective", "adverb", "pronoun", "particle", "interjection"].find((part) =>
    label.includes(part)
  );
  return fromLabel || originalPartOfSpeech || null;
}

function truncateText(value, maxLength) {
  return value.length > maxLength ? value.slice(0, maxLength - 1).trimEnd() : value;
}

function renumberEntrySenses(productEntryId) {
  const senses = statements.entrySenses.all(productEntryId);
  statements.tempSenseOrder.run(productEntryId);
  senses.forEach((row, index) => statements.setSenseOrder.run(index + 1, row.id));
}

function updateEntryStatus(productEntryId) {
  const statuses = statements.entrySenseStatuses.all(productEntryId);
  const hasNeedsReview = statuses.some((row) => row.status === "needs_review");
  const hasDraft = statuses.some((row) => row.status.startsWith("draft_"));
  statements.setEntryStatus.run(hasNeedsReview || hasDraft ? "needs_review" : "ready_for_llm", productEntryId);
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
