import Database from "better-sqlite3";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_staging.db";
const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const dryRun = args["dry-run"] === "true";

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

const statements = {
  entries: db.prepare(`
    SELECT e.id, e.word, e.source_lang
    FROM entries e
    WHERE EXISTS (
      SELECT 1 FROM senses s WHERE s.entry_id = e.id
      GROUP BY s.entry_id HAVING COUNT(*) > 1
    )
    ORDER BY e.id
  `),
  sensesForEntry: db.prepare(`
    SELECT s.id, s.sense_order, s.gloss_key, s.source, s.confidence
    FROM senses s
    WHERE s.entry_id = ?
    ORDER BY s.sense_order, s.id
  `),
  sourceLinks: db.prepare(`
    SELECT source_sense_id, match_method, confidence
    FROM sense_source_links
    WHERE sense_id = ?
  `),
  insertSourceLink: db.prepare(`
    INSERT OR IGNORE INTO sense_source_links
      (sense_id, source_sense_id, match_method, confidence)
    VALUES
      (?, ?, ?, ?)
  `),
  deleteSourceLinks: db.prepare("DELETE FROM sense_source_links WHERE sense_id = ?"),
  localizations: db.prepare("SELECT * FROM sense_localizations WHERE sense_id = ?"),
  hasLocalization: db.prepare("SELECT id FROM sense_localizations WHERE sense_id = ? AND lang = ?"),
  moveLocalization: db.prepare("UPDATE sense_localizations SET sense_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"),
  deleteLocalization: db.prepare("DELETE FROM sense_localizations WHERE id = ?"),
  examples: db.prepare("SELECT id FROM examples WHERE sense_id = ? ORDER BY example_order, id"),
  maxExampleOrder: db.prepare("SELECT COALESCE(MAX(example_order), 0) AS n FROM examples WHERE sense_id = ?"),
  moveExample: db.prepare("UPDATE examples SET sense_id = ?, example_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"),
  updateSenseIssue: db.prepare(`
    UPDATE quality_issues
    SET entity_id = ?
    WHERE entity_type IN ('sense', 'sense_localization') AND entity_id = ?
  `),
  deleteSense: db.prepare("DELETE FROM senses WHERE id = ?")
};

const stats = {
  candidate_entries: 0,
  duplicate_groups: 0,
  senses_merged: 0,
  source_links_moved: 0,
  localizations_moved: 0,
  localizations_dropped: 0,
  examples_moved: 0,
  quality_issues_retargeted: 0,
  dry_run: dryRun
};

const mergeTransaction = db.transaction((plans) => {
  for (const plan of plans) {
    mergeSense(plan.keep, plan.drop);
  }
});

const plans = [];
for (const entry of statements.entries.iterate()) {
  stats.candidate_entries++;
  const seen = new Map();
  for (const sense of statements.sensesForEntry.all(entry.id)) {
    const key = normalizeGloss(sense.gloss_key);
    if (!key) continue;
    if (!seen.has(key)) {
      seen.set(key, sense);
      continue;
    }
    const keep = chooseKeepSense(seen.get(key), sense);
    const drop = keep.id === sense.id ? seen.get(key) : sense;
    seen.set(key, keep);
    plans.push({
      entry,
      key,
      keep,
      drop
    });
  }
}

stats.duplicate_groups = plans.length;
stats.senses_merged = plans.length;

if (!dryRun) {
  mergeTransaction(plans);
}

db.close();
console.log(JSON.stringify({ ok: true, db: path.relative(process.cwd(), dbPath), stats }, null, 2));

function mergeSense(keep, drop) {
  for (const link of statements.sourceLinks.all(drop.id)) {
    statements.insertSourceLink.run(keep.id, link.source_sense_id, "exact_gloss", link.confidence);
    stats.source_links_moved++;
  }
  statements.deleteSourceLinks.run(drop.id);

  for (const localization of statements.localizations.all(drop.id)) {
    const existing = statements.hasLocalization.get(keep.id, localization.lang);
    if (existing) {
      statements.deleteLocalization.run(localization.id);
      stats.localizations_dropped++;
    } else {
      statements.moveLocalization.run(keep.id, localization.id);
      stats.localizations_moved++;
    }
  }

  let nextExampleOrder = statements.maxExampleOrder.get(keep.id).n + 1;
  for (const example of statements.examples.all(drop.id)) {
    statements.moveExample.run(keep.id, nextExampleOrder, example.id);
    nextExampleOrder++;
    stats.examples_moved++;
  }

  const issueResult = statements.updateSenseIssue.run(keep.id, drop.id);
  stats.quality_issues_retargeted += issueResult.changes;
  statements.deleteSense.run(drop.id);
}

function chooseKeepSense(a, b) {
  if (Number(a.confidence) !== Number(b.confidence)) {
    return Number(a.confidence) > Number(b.confidence) ? a : b;
  }
  return Number(a.id) < Number(b.id) ? a : b;
}

function normalizeGloss(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\([^)]*\)/gu, " ")
    .replace(/["'“”‘’`]/gu, "")
    .replace(/[^a-z0-9\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      result[arg.slice(2)] = argv[++i] || "true";
    }
  }
  return result;
}
