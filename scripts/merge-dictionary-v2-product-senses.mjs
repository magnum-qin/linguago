import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_fused_only_pilot.db";

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const dryRun = args["dry-run"] === "true";

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 10000");

const statements = {
  multiSenseEntries: db.prepare(`
    SELECT product_entry_id
    FROM product_senses
    GROUP BY product_entry_id
    HAVING COUNT(*) > 1
    ORDER BY product_entry_id
  `),
  senses: db.prepare(`
    SELECT id, product_entry_id, sense_order, part_of_speech, gloss_key, status, confidence
    FROM product_senses
    WHERE product_entry_id = ?
    ORDER BY sense_order, id
  `),
  sourceLinks: db.prepare(`
    SELECT id, source_entry_id, source_sense_id, source_lang, source_word, source_frequency_rank,
           match_method, confidence
    FROM product_sense_source_links
    WHERE product_sense_id = ?
    ORDER BY source_frequency_rank IS NULL, source_frequency_rank, source_lang, source_sense_id, id
  `),
  localizations: db.prepare(`
    SELECT id, lang, term, reading, reading_system, pronunciation, pronunciation_system, definition, source, confidence
    FROM product_localizations
    WHERE product_sense_id = ?
    ORDER BY lang
  `),
  keeperSourceLink: db.prepare(`
    SELECT id FROM product_sense_source_links WHERE product_sense_id = ? AND source_sense_id = ?
  `),
  moveSourceLink: db.prepare(`
    UPDATE product_sense_source_links SET product_sense_id = ? WHERE id = ?
  `),
  deleteSourceLink: db.prepare(`
    DELETE FROM product_sense_source_links WHERE id = ?
  `),
  keeperLocalization: db.prepare(`
    SELECT id FROM product_localizations WHERE product_sense_id = ? AND lang = ?
  `),
  moveLocalization: db.prepare(`
    UPDATE product_localizations SET product_sense_id = ? WHERE id = ?
  `),
  deleteLocalization: db.prepare(`
    DELETE FROM product_localizations WHERE id = ?
  `),
  examples: db.prepare(`
    SELECT id, source_example_id
    FROM product_examples
    WHERE product_sense_id = ?
    ORDER BY example_order, id
  `),
  keeperExample: db.prepare(`
    SELECT id FROM product_examples WHERE product_sense_id = ? AND source_example_id = ?
  `),
  moveExample: db.prepare(`
    UPDATE product_examples SET product_sense_id = ? WHERE id = ?
  `),
  deleteExample: db.prepare(`
    DELETE FROM product_examples WHERE id = ?
  `),
  loserJobs: db.prepare(`
    SELECT id, target_type, lang, provider, model, prompt_version, status
    FROM product_llm_completion_jobs
    WHERE target_id = ?
  `),
  keeperJob: db.prepare(`
    SELECT id
    FROM product_llm_completion_jobs
    WHERE target_type = ?
      AND target_id = ?
      AND lang = ?
      AND provider = ?
      AND model = ?
      AND prompt_version = ?
      AND status IN ('queued', 'running', 'accepted', 'needs_review')
  `),
  moveJob: db.prepare(`
    UPDATE product_llm_completion_jobs SET target_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `),
  deleteJob: db.prepare(`
    DELETE FROM product_llm_completion_jobs WHERE id = ?
  `),
  updateReviewSense: db.prepare(`
    UPDATE product_fusion_reviews SET product_sense_id = ? WHERE product_sense_id = ?
  `),
  updateSplitPlanSense: db.prepare(`
    UPDATE product_fusion_split_plans SET product_sense_id = ?, updated_at = CURRENT_TIMESTAMP WHERE product_sense_id = ?
  `),
  deleteSense: db.prepare(`
    DELETE FROM product_senses WHERE id = ?
  `),
  updateKeeper: db.prepare(`
    UPDATE product_senses
    SET gloss_key = @gloss_key,
        status = @status,
        confidence = @confidence
    WHERE id = @id
  `),
  tempSenseOrder: db.prepare(`
    UPDATE product_senses SET sense_order = -id WHERE product_entry_id = ?
  `),
  orderedSenses: db.prepare(`
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
  setSenseOrder: db.prepare(`
    UPDATE product_senses SET sense_order = ? WHERE id = ?
  `),
  entryStatusCounts: db.prepare(`
    SELECT status, COUNT(*) AS count FROM product_senses WHERE product_entry_id = ? GROUP BY status
  `),
  updateEntryStatus: db.prepare(`
    UPDATE product_entries SET status = ? WHERE id = ?
  `)
};

const stats = {
  db: path.relative(process.cwd(), dbPath),
  dry_run: dryRun,
  entries_scanned: 0,
  duplicate_pairs_found: 0,
  pairs_merged: 0,
  senses_deleted: 0,
  source_links_moved: 0,
  source_links_deleted: 0,
  localizations_moved: 0,
  localizations_deleted: 0,
  examples_moved: 0,
  examples_deleted: 0,
  jobs_moved: 0,
  jobs_deleted: 0
};

const mergeAll = db.transaction(() => {
  for (const row of statements.multiSenseEntries.all()) mergeEntry(row.product_entry_id, true);
});

if (dryRun) {
  for (const row of statements.multiSenseEntries.all()) mergeEntry(row.product_entry_id, false);
} else {
  mergeAll();
}

const summary = {
  ok: true,
  stats,
  remaining_rule_duplicates: countRuleDuplicates(),
  product_sense_status: db
    .prepare(`SELECT status, COUNT(*) AS count FROM product_senses GROUP BY status ORDER BY status`)
    .all(),
  sample_multi_sense_entries: db
    .prepare(`
      SELECT pe.headword, pe.frequency_rank, pe.status, COUNT(ps.id) AS senses,
             group_concat(ps.sense_order || ':' || ps.status || ':' || ps.gloss_key, ' | ') AS glosses
      FROM product_entries pe
      JOIN product_senses ps ON ps.product_entry_id = pe.id
      GROUP BY pe.id
      HAVING senses > 1
      ORDER BY pe.frequency_rank IS NULL, pe.frequency_rank, pe.id
      LIMIT 20
    `)
    .all()
};

fs.writeFileSync(dbPath.replace(/\.db$/u, ".sense-merge.summary.json"), JSON.stringify(summary, null, 2));
db.close();
console.log(JSON.stringify(summary, null, 2));

function mergeEntry(productEntryId, write) {
  stats.entries_scanned++;
  let senses = enrichSenses(statements.senses.all(productEntryId));
  const pairs = findRuleDuplicatePairs(senses);
  if (!pairs.length) return;

  for (const pair of pairs) {
    senses = enrichSenses(statements.senses.all(productEntryId));
    const keeper = senses.find((sense) => sense.id === pair.keeper_id);
    const loser = senses.find((sense) => sense.id === pair.loser_id);
    if (!keeper || !loser) continue;

    stats.duplicate_pairs_found++;
    if (write) mergeSensePair({ keeper, loser, reason: pair.reason });
    stats.pairs_merged++;
    stats.senses_deleted++;
  }

  if (write) {
    renumberEntry(productEntryId);
    refreshEntryStatus(productEntryId);
  }
}

function enrichSenses(senses) {
  return senses.map((sense) => {
    const links = statements.sourceLinks.all(sense.id);
    const localizations = statements.localizations.all(sense.id);
    return {
      ...sense,
      links,
      localizations,
      normalized_gloss: normalizeGloss(sense.gloss_key),
      term_signature: buildTermSignature(localizations),
      source_words: new Set(links.map((link) => `${link.source_lang}:${normalizeWord(link.source_word)}`)),
      source_sense_ids: new Set(links.map((link) => link.source_sense_id))
    };
  });
}

function findRuleDuplicatePairs(senses) {
  const pairs = [];
  const consumed = new Set();
  for (let i = 0; i < senses.length; i++) {
    for (let j = i + 1; j < senses.length; j++) {
      const a = senses[i];
      const b = senses[j];
      if (consumed.has(a.id) || consumed.has(b.id)) continue;
      const reason = duplicateReason(a, b);
      if (!reason) continue;
      const [keeper, loser] = chooseKeeper(a, b);
      pairs.push({ keeper_id: keeper.id, loser_id: loser.id, reason });
      consumed.add(loser.id);
    }
  }
  return pairs;
}

function duplicateReason(a, b) {
  if (a.normalized_gloss && a.normalized_gloss === b.normalized_gloss) return "same_gloss";
  if (
    a.term_signature &&
    a.term_signature === b.term_signature &&
    hasSetOverlap(a.source_words, b.source_words)
  ) {
    return "same_terms_with_source_overlap";
  }
  return "";
}

function chooseKeeper(a, b) {
  const ranked = [a, b].sort((left, right) => {
    const statusDelta = statusRank(left.status) - statusRank(right.status);
    if (statusDelta) return statusDelta;
    const locDelta = right.localizations.length - left.localizations.length;
    if (locDelta) return locDelta;
    return left.id - right.id;
  });
  return [ranked[0], ranked[1]];
}

function mergeSensePair({ keeper, loser, reason }) {
  for (const link of loser.links) {
    if (statements.keeperSourceLink.get(keeper.id, link.source_sense_id)) {
      statements.deleteSourceLink.run(link.id);
      stats.source_links_deleted++;
    } else {
      statements.moveSourceLink.run(keeper.id, link.id);
      stats.source_links_moved++;
    }
  }

  for (const loc of loser.localizations) {
    if (statements.keeperLocalization.get(keeper.id, loc.lang)) {
      statements.deleteLocalization.run(loc.id);
      stats.localizations_deleted++;
    } else {
      statements.moveLocalization.run(keeper.id, loc.id);
      stats.localizations_moved++;
    }
  }

  for (const example of statements.examples.all(loser.id)) {
    if (statements.keeperExample.get(keeper.id, example.source_example_id)) {
      statements.deleteExample.run(example.id);
      stats.examples_deleted++;
    } else {
      statements.moveExample.run(keeper.id, example.id);
      stats.examples_moved++;
    }
  }

  for (const job of statements.loserJobs.all(loser.id)) {
    if (
      statements.keeperJob.get(
        job.target_type,
        keeper.id,
        job.lang,
        job.provider,
        job.model,
        job.prompt_version
      )
    ) {
      statements.deleteJob.run(job.id);
      stats.jobs_deleted++;
    } else {
      statements.moveJob.run(keeper.id, job.id);
      stats.jobs_moved++;
    }
  }

  statements.updateReviewSense.run(keeper.id, loser.id);
  statements.updateSplitPlanSense.run(keeper.id, loser.id);
  statements.updateKeeper.run({
    id: keeper.id,
    gloss_key: chooseGloss(keeper, loser, reason),
    status: chooseStatus(keeper, loser),
    confidence: Math.max(Number(keeper.confidence) || 0, Number(loser.confidence) || 0)
  });
  statements.deleteSense.run(loser.id);
}

function chooseGloss(keeper, loser, reason) {
  if (reason === "same_gloss") return keeper.gloss_key;
  return String(keeper.gloss_key || "").length <= String(loser.gloss_key || "").length ? keeper.gloss_key : loser.gloss_key;
}

function chooseStatus(keeper, loser) {
  return statusRank(keeper.status) <= statusRank(loser.status) ? keeper.status : loser.status;
}

function renumberEntry(productEntryId) {
  const senses = statements.orderedSenses.all(productEntryId);
  statements.tempSenseOrder.run(productEntryId);
  senses.forEach((sense, index) => statements.setSenseOrder.run(index + 1, sense.id));
}

function refreshEntryStatus(productEntryId) {
  const statuses = statements.entryStatusCounts.all(productEntryId);
  const total = statuses.reduce((sum, row) => sum + Number(row.count), 0);
  const accepted = statuses.find((row) => row.status === "accepted")?.count || 0;
  const hasNeedsReview = statuses.some((row) => row.status === "needs_review");
  const hasDraft = statuses.some((row) => row.status.startsWith("draft_"));
  const status = accepted === total ? "accepted" : hasNeedsReview || hasDraft ? "needs_review" : "ready_for_llm";
  statements.updateEntryStatus.run(status, productEntryId);
}

function countRuleDuplicates() {
  let count = 0;
  for (const row of statements.multiSenseEntries.all()) {
    count += findRuleDuplicatePairs(enrichSenses(statements.senses.all(row.product_entry_id))).length;
  }
  return count;
}

function normalizeGloss(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[()[\]'"`]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeWord(value) {
  return String(value || "").normalize("NFKC").toLowerCase().trim();
}

function buildTermSignature(localizations) {
  if (!localizations.length) return "";
  return localizations
    .map((loc) => `${loc.lang}:${normalizeWord(loc.term)}`)
    .sort()
    .join("|");
}

function hasSetOverlap(a, b) {
  for (const item of a) if (b.has(item)) return true;
  return false;
}

function statusRank(status) {
  if (status === "accepted") return 1;
  if (status === "ready_for_llm") return 2;
  if (status === "needs_review") return 3;
  if (status === "draft_fused") return 4;
  if (status === "draft_single_source") return 5;
  return 9;
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
