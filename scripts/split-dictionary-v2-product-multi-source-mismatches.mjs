import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_fused_only_pilot.db";
const DEFAULT_OUT = "data/processed/product-multi-source-mismatch-splits.json";

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const outPath = path.resolve(args.out || DEFAULT_OUT);
const dryRun = args["dry-run"] === "true";
const apply = args.apply === "true";

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
if (!dryRun && !apply) {
  throw new Error("Pass --dry-run true to inspect or --apply true to split mismatches.");
}

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 10000");

const statements = {
  candidates: db.prepare(`
    SELECT
      pe.id AS source_entry_id,
      pe.headword AS source_headword,
      pe.frequency_rank AS source_frequency_rank,
      ps.id AS sense_id,
      ps.sense_order,
      ps.part_of_speech,
      ps.gloss_key,
      ps.confidence,
      COUNT(DISTINCT l.source_word) AS distinct_source_words,
      GROUP_CONCAT(DISTINCT l.source_word) AS source_words
    FROM product_entries pe
    JOIN product_senses ps ON ps.product_entry_id = pe.id
    JOIN product_sense_source_links l ON l.product_sense_id = ps.id
    WHERE pe.primary_lang = 'zh'
      AND length(pe.headword) = 1
      AND l.source_lang = 'zh'
      AND length(l.source_word) = 1
      AND pe.headword <> l.source_word
    GROUP BY pe.id, ps.id
    HAVING COUNT(DISTINCT l.source_word) > 1
    ORDER BY pe.frequency_rank IS NULL, pe.frequency_rank, pe.headword, ps.sense_order, ps.id
  `),
  links: db.prepare(`
    SELECT *
    FROM product_sense_source_links
    WHERE product_sense_id = ?
    ORDER BY source_frequency_rank IS NULL, source_frequency_rank, source_word, id
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
      (@headword, @normalized_key, 'zh', @frequency_rank, @group_key, 'split_source_mismatch',
       'ready_for_llm', 0, 0)
  `),
  moveOriginalSense: db.prepare(`
    UPDATE product_senses
    SET product_entry_id = @product_entry_id,
        sense_order = -id,
        gloss_key = @gloss_key,
        status = 'ready_for_llm',
        confidence = @confidence
    WHERE id = @id
  `),
  insertSense: db.prepare(`
    INSERT INTO product_senses
      (product_entry_id, sense_order, part_of_speech, gloss_key, status, confidence)
    VALUES
      (@product_entry_id, @sense_order, @part_of_speech, @gloss_key, 'ready_for_llm', @confidence)
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
  deleteJobs: db.prepare(`
    DELETE FROM product_llm_completion_jobs
    WHERE target_id = ?
  `),
  updateReviews: db.prepare(`
    UPDATE product_fusion_reviews
    SET product_entry_id = ?, product_sense_id = ?
    WHERE product_sense_id = ?
  `),
  updateSplitPlans: db.prepare(`
    UPDATE product_fusion_split_plans
    SET product_entry_id = ?, product_sense_id = ?, updated_at = CURRENT_TIMESTAMP
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

const candidates = statements.candidates.all();
const plans = candidates.map(buildPlan);

const stats = {
  db: path.relative(process.cwd(), dbPath),
  dry_run: dryRun,
  apply,
  candidates_seen: candidates.length,
  split_plans: plans.length,
  entries_created: 0,
  senses_created: 0,
  original_senses_moved: 0,
  source_links_moved: 0,
  localizations_deleted: 0,
  examples_deleted: 0,
  jobs_deleted: 0,
  empty_entries_deleted: 0,
  senses_renumbered: 0
};

if (apply) {
  const tx = db.transaction((rows) => {
    for (const row of rows) applySplit(row);
  });
  tx(candidates);
}

const summary = {
  ok: true,
  stats,
  sample_plans: plans.slice(0, 20)
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ ...summary, plans }, null, 2));
console.log(JSON.stringify(summary, null, 2));
db.close();

function buildPlan(candidate) {
  const groups = groupLinksBySourceWord(statements.links.all(candidate.sense_id));
  return {
    sense_id: candidate.sense_id,
    source_entry_id: candidate.source_entry_id,
    source_headword: candidate.source_headword,
    gloss_key: candidate.gloss_key,
    groups: groups.map((group) => {
      const target = statements.findTargetEntry.get(group.source_word);
      return {
        source_word: group.source_word,
        link_ids: group.links.map((link) => link.id),
        target_entry_id: target?.id ?? null,
        target_entry_created: !target,
        target_group_key: target?.group_key ?? buildGroupKey(group.source_word)
      };
    })
  };
}

function applySplit(candidate) {
  const groups = groupLinksBySourceWord(statements.links.all(candidate.sense_id));
  if (groups.length < 2) return;

  stats.localizations_deleted += statements.deleteLocalizations.run(candidate.sense_id).changes;
  stats.examples_deleted += statements.deleteExamples.run(candidate.sense_id).changes;
  stats.jobs_deleted += statements.deleteJobs.run(candidate.sense_id).changes;

  const touchedEntryIds = new Set([candidate.source_entry_id]);
  const first = groups[0];
  const firstTarget = getOrCreateTargetEntry(first);
  touchedEntryIds.add(firstTarget.id);

  statements.moveOriginalSense.run({
    id: candidate.sense_id,
    product_entry_id: firstTarget.id,
    gloss_key: buildGlossKey(first.source_word),
    confidence: candidate.confidence
  });
  stats.original_senses_moved++;

  const firstLinkIds = new Set(first.links.map((link) => link.id));
  for (const link of statements.links.all(candidate.sense_id)) {
    if (!firstLinkIds.has(link.id)) continue;
    statements.moveSourceLink.run(candidate.sense_id, link.id);
  }

  for (let index = 1; index < groups.length; index++) {
    const group = groups[index];
    const target = getOrCreateTargetEntry(group);
    touchedEntryIds.add(target.id);
    const result = statements.insertSense.run({
      product_entry_id: target.id,
      sense_order: -Number(`${Date.now()}${index}`),
      part_of_speech: candidate.part_of_speech,
      gloss_key: buildGlossKey(group.source_word),
      confidence: candidate.confidence
    });
    const newSenseId = Number(result.lastInsertRowid);
    stats.senses_created++;
    for (const link of group.links) {
      statements.moveSourceLink.run(newSenseId, link.id);
      stats.source_links_moved++;
    }
  }

  statements.updateReviews.run(firstTarget.id, candidate.sense_id, candidate.sense_id);
  statements.updateSplitPlans.run(firstTarget.id, candidate.sense_id, candidate.sense_id);

  for (const entryId of touchedEntryIds) {
    stats.senses_renumbered += renumberEntry(entryId);
  }
  for (const entryId of touchedEntryIds) {
    if (statements.senseCount.get(entryId).count === 0) {
      stats.empty_entries_deleted += statements.deleteEmptyEntry.run(entryId).changes;
    } else {
      refreshEntry(entryId);
    }
  }
}

function groupLinksBySourceWord(links) {
  const groups = new Map();
  for (const link of links) {
    if (!groups.has(link.source_word)) groups.set(link.source_word, []);
    groups.get(link.source_word).push(link);
  }
  return [...groups.entries()]
    .map(([sourceWord, groupLinks]) => ({
      source_word: sourceWord,
      links: groupLinks.sort((a, b) => {
        const rankA = a.source_frequency_rank ?? Number.MAX_SAFE_INTEGER;
        const rankB = b.source_frequency_rank ?? Number.MAX_SAFE_INTEGER;
        if (rankA !== rankB) return rankA - rankB;
        return a.id - b.id;
      })
    }))
    .sort((a, b) => {
      const rankA = a.links[0]?.source_frequency_rank ?? Number.MAX_SAFE_INTEGER;
      const rankB = b.links[0]?.source_frequency_rank ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      return a.source_word.localeCompare(b.source_word);
    });
}

function getOrCreateTargetEntry(group) {
  const existing = statements.findTargetEntry.get(group.source_word);
  if (existing) return { id: existing.id, created: false };
  const result = statements.insertTargetEntry.run({
    headword: group.source_word,
    normalized_key: group.source_word,
    frequency_rank: group.links[0]?.source_frequency_rank ?? null,
    group_key: buildGroupKey(group.source_word)
  });
  stats.entries_created++;
  return { id: Number(result.lastInsertRowid), created: true };
}

function buildGroupKey(headword) {
  return `split-mismatch:zh:${headword}`;
}

function buildGlossKey(sourceWord) {
  return `Sense for ${sourceWord}`;
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
