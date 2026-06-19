import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";
const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const dryRun = args["dry-run"] !== "false";

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 30000");

const statements = {
  deleteQueued: db.prepare(`
    DELETE FROM product_llm_completion_jobs
    WHERE status = 'queued'
  `),
  sampleSenses: db.prepare(`
    SELECT ps.id, pe.id AS entry_id, pe.headword
    FROM product_senses ps
    JOIN product_entries pe ON pe.id = ps.product_entry_id
    WHERE pe.headword IN ('啥')
    ORDER BY pe.id, ps.sense_order
  `),
  localizationExists: db.prepare(`
    SELECT id
    FROM product_localizations
    WHERE product_sense_id = ? AND lang = ?
  `),
  insertLocalization: db.prepare(`
    INSERT INTO product_localizations
      (product_sense_id, lang, term, reading, reading_system, pronunciation, pronunciation_system,
       definition, source, confidence, needs_review)
    VALUES
      (@product_sense_id, @lang, @term, @reading, @reading_system, @pronunciation, @pronunciation_system,
       @definition, 'manual:audit-sample-completion', 0.82, 0)
  `),
  acceptSense: db.prepare(`
    UPDATE product_senses
    SET status = 'accepted'
    WHERE id = ?
  `),
  acceptEntry: db.prepare(`
    UPDATE product_entries
    SET status = 'accepted'
    WHERE id = ?
  `)
};

const stats = {
  db: path.relative(process.cwd(), dbPath),
  dry_run: dryRun,
  queued_jobs_deleted: 0,
  sample_senses_seen: 0,
  localizations_inserted: 0,
  senses_accepted: 0,
  entries_accepted: 0
};

const complete = db.transaction(() => {
  stats.queued_jobs_deleted = statements.deleteQueued.run().changes;
  const senses = statements.sampleSenses.all();
  stats.sample_senses_seen = senses.length;
  const touchedEntries = new Set();
  for (const sense of senses) {
    if (!statements.localizationExists.get(sense.id, "ja")) {
      statements.insertLocalization.run({
        product_sense_id: sense.id,
        lang: "ja",
        term: "何",
        reading: "なに",
        reading_system: "kana",
        pronunciation: null,
        pronunciation_system: null,
        definition: "中国語の方言的な疑問代名詞。「何」「何か」に相当する。"
      });
      stats.localizations_inserted++;
    }
    if (!statements.localizationExists.get(sense.id, "pt-BR")) {
      statements.insertLocalization.run({
        product_sense_id: sense.id,
        lang: "pt-BR",
        term: "o que",
        reading: null,
        reading_system: null,
        pronunciation: "/u ke/",
        pronunciation_system: "IPA",
        definition: "Pronome interrogativo coloquial usado para perguntar sobre algo; equivalente a o que ou que."
      });
      stats.localizations_inserted++;
    }
    stats.senses_accepted += statements.acceptSense.run(sense.id).changes;
    touchedEntries.add(sense.entry_id);
  }
  for (const entryId of touchedEntries) {
    stats.entries_accepted += statements.acceptEntry.run(entryId).changes;
  }
});

if (!dryRun) complete();
else stats.sample_senses_seen = statements.sampleSenses.all().length;

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
