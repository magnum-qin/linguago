import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db");

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 30000");

const merges = [
  {
    headword: "箱",
    primary_lang: "ja",
    keep_gloss_key: "box",
    remove_gloss_key: "Container sense"
  }
];

const statements = {
  getSense: db.prepare(`
    SELECT ps.id, ps.product_entry_id
    FROM product_senses ps
    JOIN product_entries pe ON pe.id = ps.product_entry_id
    WHERE pe.headword = ?
      AND pe.primary_lang = ?
      AND ps.gloss_key = ?
    ORDER BY ps.id
    LIMIT 1
  `),
  sourceLinks: db.prepare("SELECT id, source_sense_id FROM product_sense_source_links WHERE product_sense_id = ? ORDER BY id"),
  sourceLinkExists: db.prepare("SELECT id FROM product_sense_source_links WHERE product_sense_id = ? AND source_sense_id = ?"),
  moveSourceLink: db.prepare("UPDATE product_sense_source_links SET product_sense_id = ? WHERE id = ?"),
  deleteSourceLink: db.prepare("DELETE FROM product_sense_source_links WHERE id = ?"),
  deleteLocalizations: db.prepare("DELETE FROM product_localizations WHERE product_sense_id = ?"),
  deleteExampleLocalizations: db.prepare(`
    DELETE FROM product_example_localizations
    WHERE product_example_id IN (
      SELECT id FROM product_examples WHERE product_sense_id = ?
    )
  `),
  deleteExamples: db.prepare("DELETE FROM product_examples WHERE product_sense_id = ?"),
  deleteSense: db.prepare("DELETE FROM product_senses WHERE id = ?"),
  sensesForEntry: db.prepare("SELECT id FROM product_senses WHERE product_entry_id = ? ORDER BY sense_order, id"),
  setSenseOrder: db.prepare("UPDATE product_senses SET sense_order = ? WHERE id = ?"),
  countStatuses: db.prepare("SELECT status, COUNT(*) AS count FROM product_senses WHERE product_entry_id = ? GROUP BY status"),
  updateEntryStatus: db.prepare(`
    UPDATE product_entries
    SET status = @status,
        source_count = (SELECT COUNT(*) FROM product_sense_source_links WHERE product_sense_id IN (SELECT id FROM product_senses WHERE product_entry_id = @entry_id)),
        lang_count = (SELECT COUNT(DISTINCT lang) FROM product_localizations WHERE product_sense_id IN (SELECT id FROM product_senses WHERE product_entry_id = @entry_id))
    WHERE id = @entry_id
  `)
};

const stats = {
  db: path.relative(process.cwd(), dbPath),
  merges_seen: 0,
  merges_applied: 0,
  source_links_moved: 0,
  source_links_deleted: 0,
  localizations_deleted: 0,
  examples_deleted: 0,
  senses_deleted: 0,
  missing: []
};

db.transaction(() => {
  for (const merge of merges) {
    const keep = statements.getSense.get(merge.headword, merge.primary_lang, merge.keep_gloss_key);
    const remove = statements.getSense.get(merge.headword, merge.primary_lang, merge.remove_gloss_key);
    if (!keep || !remove) {
      stats.missing.push(`${merge.primary_lang}:${merge.headword}:${merge.keep_gloss_key}->${merge.remove_gloss_key}`);
      continue;
    }
    if (keep.id === remove.id) continue;
    stats.merges_seen++;

    for (const link of statements.sourceLinks.all(remove.id)) {
      if (statements.sourceLinkExists.get(keep.id, link.source_sense_id)) {
        statements.deleteSourceLink.run(link.id);
        stats.source_links_deleted++;
      } else {
        statements.moveSourceLink.run(keep.id, link.id);
        stats.source_links_moved++;
      }
    }

    const locResult = statements.deleteLocalizations.run(remove.id);
    stats.localizations_deleted += locResult.changes;
    const exLocResult = statements.deleteExampleLocalizations.run(remove.id);
    const exResult = statements.deleteExamples.run(remove.id);
    stats.examples_deleted += exResult.changes;
    stats.example_localizations_deleted = (stats.example_localizations_deleted || 0) + exLocResult.changes;
    const senseResult = statements.deleteSense.run(remove.id);
    stats.senses_deleted += senseResult.changes;

    renumberSenses(keep.product_entry_id);
    updateEntry(keep.product_entry_id);
    stats.merges_applied++;
  }
})();

db.close();
console.log(JSON.stringify(stats, null, 2));

function renumberSenses(entryId) {
  const senses = statements.sensesForEntry.all(entryId);
  for (let i = 0; i < senses.length; i++) {
    statements.setSenseOrder.run(i + 1, senses[i].id);
  }
}

function updateEntry(entryId) {
  const statusCounts = new Map(statements.countStatuses.all(entryId).map((row) => [row.status, row.count]));
  const status = statusCounts.get("needs_review")
    ? "needs_review"
    : statusCounts.get("ready_for_llm")
      ? "ready_for_llm"
      : statusCounts.get("draft_fused") || statusCounts.get("draft_single_source")
        ? "draft_fused"
        : "accepted";
  statements.updateEntryStatus.run({ entry_id: entryId, status });
}

function parseArgs(argv) {
  const output = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    output[key] = next && !next.startsWith("--") ? next : "1";
    if (next && !next.startsWith("--")) i++;
  }
  return output;
}
