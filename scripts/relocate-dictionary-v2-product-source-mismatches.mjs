import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_fused_only_pilot.db";
const DEFAULT_OUT = "data/processed/product-source-mismatch-relocations.json";

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const outPath = path.resolve(args.out || DEFAULT_OUT);
const dryRun = args["dry-run"] === "true";
const apply = args.apply === "true";
const clearGeneratedContent = args["clear-generated-content"] !== "false";

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
if (!dryRun && !apply) {
  throw new Error("Pass --dry-run true to inspect or --apply true to relocate mismatches.");
}

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 10000");

const statements = {
  candidates: db.prepare(`
    SELECT
      pe.id AS source_entry_id,
      pe.headword AS source_headword,
      pe.normalized_key AS source_normalized_key,
      pe.frequency_rank AS source_frequency_rank,
      ps.id AS sense_id,
      ps.sense_order,
      ps.part_of_speech,
      ps.gloss_key,
      ps.confidence,
      COUNT(DISTINCT l.source_word) AS distinct_source_words,
      MIN(l.source_word) AS target_headword,
      MIN(l.source_frequency_rank) AS target_frequency_rank,
      GROUP_CONCAT(DISTINCT l.match_method) AS match_methods
    FROM product_entries pe
    JOIN product_senses ps ON ps.product_entry_id = pe.id
    JOIN product_sense_source_links l ON l.product_sense_id = ps.id
    WHERE pe.primary_lang = 'zh'
      AND length(pe.headword) = 1
      AND l.source_lang = 'zh'
      AND length(l.source_word) = 1
      AND pe.headword <> l.source_word
    GROUP BY pe.id, ps.id
    ORDER BY pe.frequency_rank IS NULL, pe.frequency_rank, pe.headword, ps.sense_order, ps.id
  `),
  findTargetEntry: db.prepare(`
    SELECT id, headword, normalized_key, primary_lang, frequency_rank, group_key, group_method, status
    FROM product_entries
    WHERE primary_lang = 'zh'
      AND normalized_key = ?
    ORDER BY frequency_rank IS NULL, frequency_rank, id
    LIMIT 1
  `),
  insertTargetEntry: db.prepare(`
    INSERT INTO product_entries
      (headword, normalized_key, primary_lang, frequency_rank, group_key, group_method,
       status, source_count, lang_count)
    VALUES
      (@headword, @normalized_key, 'zh', @frequency_rank, @group_key, 'relocated_source_mismatch',
       'ready_for_llm', 0, 0)
  `),
  tempSenseOrder: db.prepare(`
    UPDATE product_senses
    SET sense_order = -id
    WHERE id = ?
  `),
  moveSense: db.prepare(`
    UPDATE product_senses
    SET product_entry_id = ?,
        status = 'ready_for_llm'
    WHERE id = ?
  `),
  deleteLocalizations: db.prepare(`
    DELETE FROM product_localizations
    WHERE product_sense_id = ?
  `),
  resetExamples: db.prepare(`
    UPDATE product_examples
    SET needs_review = 0
    WHERE product_sense_id = ?
  `),
  deleteExampleLocalizations: db.prepare(`
    DELETE FROM product_example_localizations
    WHERE product_example_id IN (
      SELECT id FROM product_examples WHERE product_sense_id = ?
    )
  `),
  deleteJobs: db.prepare(`
    DELETE FROM product_llm_completion_jobs
    WHERE target_id = ?
  `),
  updateReviews: db.prepare(`
    UPDATE product_fusion_reviews
    SET product_entry_id = ?
    WHERE product_sense_id = ?
  `),
  updateSplitPlans: db.prepare(`
    UPDATE product_fusion_split_plans
    SET product_entry_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE product_sense_id = ?
  `),
  sensesForEntry: db.prepare(`
    SELECT ps.id, ps.status, MIN(l.source_frequency_rank) AS min_source_rank
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
  tempEntrySenseOrders: db.prepare(`
    UPDATE product_senses
    SET sense_order = -id
    WHERE product_entry_id = ?
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
        frequency_rank = COALESCE(@frequency_rank, frequency_rank)
    WHERE id = @id
  `),
  senseCount: db.prepare(`
    SELECT COUNT(*) AS count
    FROM product_senses
    WHERE product_entry_id = ?
  `),
  deleteEmptyEntry: db.prepare(`
    DELETE FROM product_entries
    WHERE id = ?
      AND NOT EXISTS (SELECT 1 FROM product_senses WHERE product_entry_id = product_entries.id)
  `)
};

const rawCandidates = statements.candidates.all();
const relocations = [];
const skipped = [];

for (const row of rawCandidates) {
  if (row.distinct_source_words !== 1) {
    skipped.push({ ...row, reason: "multiple_distinct_source_words" });
    continue;
  }
  const target = getOrPlanTargetEntry(row);
  relocations.push({
    ...row,
    target_entry_id: target.id,
    target_entry_created: target.created,
    target_group_key: target.group_key
  });
}

const stats = {
  db: path.relative(process.cwd(), dbPath),
  dry_run: dryRun,
  apply,
  clear_generated_content: clearGeneratedContent,
  candidates_seen: rawCandidates.length,
  relocations_planned: relocations.length,
  skipped: skipped.length,
  entries_created: 0,
  senses_moved: 0,
  localizations_deleted: 0,
  examples_reset: 0,
  example_localizations_deleted: 0,
  jobs_deleted: 0,
  empty_entries_deleted: 0,
  senses_renumbered: 0
};

if (apply) {
  const tx = db.transaction((rows) => {
    for (const row of rows) applyRelocation(row);
  });
  tx(rawCandidates);
}

const summary = {
  ok: true,
  stats,
  sample_relocations: relocations.slice(0, 30),
  skipped: skipped.slice(0, 30)
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ ...summary, relocations, skipped }, null, 2));
console.log(JSON.stringify(summary, null, 2));
db.close();

function applyRelocation(row) {
  if (row.distinct_source_words !== 1) return;
  const target = getOrCreateTargetEntry(row);
  if (target.id === row.source_entry_id) return;

  statements.tempSenseOrder.run(row.sense_id);
  statements.moveSense.run(target.id, row.sense_id);
  stats.senses_moved++;

  if (clearGeneratedContent) {
    stats.localizations_deleted += statements.deleteLocalizations.run(row.sense_id).changes;
    stats.example_localizations_deleted += statements.deleteExampleLocalizations.run(row.sense_id).changes;
    stats.jobs_deleted += statements.deleteJobs.run(row.sense_id).changes;
  }
  stats.examples_reset += statements.resetExamples.run(row.sense_id).changes;
  statements.updateReviews.run(target.id, row.sense_id);
  statements.updateSplitPlans.run(target.id, row.sense_id);

  stats.senses_renumbered += renumberEntry(row.source_entry_id);
  stats.senses_renumbered += renumberEntry(target.id);
  refreshEntry(target.id);
  if (statements.senseCount.get(row.source_entry_id).count === 0) {
    stats.empty_entries_deleted += statements.deleteEmptyEntry.run(row.source_entry_id).changes;
  } else {
    refreshEntry(row.source_entry_id);
  }
}

function getOrPlanTargetEntry(row) {
  const existing = statements.findTargetEntry.get(row.target_headword);
  if (existing) return { id: existing.id, created: false, group_key: existing.group_key };
  return {
    id: null,
    created: true,
    group_key: buildGroupKey(row.target_headword)
  };
}

function getOrCreateTargetEntry(row) {
  const existing = statements.findTargetEntry.get(row.target_headword);
  if (existing) return { id: existing.id, created: false };

  const result = statements.insertTargetEntry.run({
    headword: row.target_headword,
    normalized_key: row.target_headword,
    frequency_rank: row.target_frequency_rank,
    group_key: buildGroupKey(row.target_headword)
  });
  stats.entries_created++;
  return { id: Number(result.lastInsertRowid), created: true };
}

function buildGroupKey(headword) {
  return `relocated:zh:${headword}`;
}

function renumberEntry(productEntryId) {
  const senses = statements.sensesForEntry.all(productEntryId);
  statements.tempEntrySenseOrders.run(productEntryId);
  for (let index = 0; index < senses.length; index++) {
    statements.setSenseOrder.run(index + 1, senses[index].id);
  }
  return senses.length;
}

function refreshEntry(productEntryId) {
  const aggregate = statements.aggregateEntry.get(productEntryId);
  const statuses = statements.statusCounts.all(productEntryId);
  const total = statuses.reduce((sum, row) => sum + Number(row.count), 0);
  const accepted = statuses.find((row) => row.status === "accepted")?.count || 0;
  const hasNeedsReview = statuses.some((row) => row.status === "needs_review");
  const hasDraft = statuses.some((row) => String(row.status).startsWith("draft_"));
  const status = accepted === total ? "accepted" : hasNeedsReview || hasDraft ? "needs_review" : "ready_for_llm";
  statements.updateEntry.run({
    id: productEntryId,
    status,
    source_count: aggregate.source_count || 0,
    lang_count: aggregate.lang_count || 0,
    frequency_rank: aggregate.frequency_rank
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
