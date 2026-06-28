import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const apply = args.apply === "true";

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const repairs = [
  row(10020, "noun", "plural or third-person singular form of lead", "Plural or third-person singular form of lead."),
  row(10240, "verb", "past tense and past participle of feed", "Past tense and past participle of feed."),
  row(14737, "noun", "plural or third-person singular form of check", "Plural or third-person singular form of check."),
  row(15305, "noun", "plural or third-person singular form of cut", "Plural or third-person singular form of cut."),
  row(19867, "noun", "plural of noise", "Plural of noise.")
];

const block = {
  sense_id: 26913,
  block_code: "blocked_source_ambiguous",
  rationale: "Source gloss for 'cass' mixes calcium and California abbreviations and is not a supported dictionary sense for the headword.",
  recommendation: "Keep blocked unless a validated lexical source for 'cass' is added."
};

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 30000");

const updateSense = db.prepare(`
  UPDATE product_senses
  SET part_of_speech = ?,
      gloss_key = ?,
      confidence = MAX(confidence, 0.9)
  WHERE id = ?
`);

const updateEnglishLocalization = db.prepare(`
  UPDATE product_localizations
  SET definition = ?,
      source = 'manual:inflected-batch11-final-20260628',
      confidence = MAX(confidence, 0.9),
      needs_review = 0
  WHERE product_sense_id = ?
    AND lang = 'en'
`);

const verifyLocs = db.prepare(`
  SELECT COUNT(*) AS n
  FROM product_localizations
  WHERE product_sense_id = ?
`);

const getSense = db.prepare("SELECT id FROM product_senses WHERE id = ?");
const getBlock = db.prepare("SELECT id FROM product_sense_publication_blocks WHERE product_sense_id = ?");
const insertBlock = db.prepare(`
  INSERT INTO product_sense_publication_blocks (
    product_sense_id, block_code, rationale, recommendation, created_at, updated_at
  )
  VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
`);

const stats = {
  apply,
  repaired_sense_ids: repairs.map((repair) => repair.sense_id),
  blocked_sense_ids: [block.sense_id],
  updated_senses: 0,
  updated_english_localizations: 0,
  inserted_blocks: 0
};

const transaction = db.transaction(() => {
  for (const repair of repairs) {
    const locCount = verifyLocs.get(repair.sense_id).n;
    if (locCount !== 4) throw new Error(`Expected 4 localizations for sense ${repair.sense_id}, got ${locCount}`);
    stats.updated_senses += updateSense.run(repair.part_of_speech, repair.gloss_key, repair.sense_id).changes;
    stats.updated_english_localizations += updateEnglishLocalization.run(repair.definition, repair.sense_id).changes;
  }
  if (!getSense.get(block.sense_id)) throw new Error(`Missing product_sense ${block.sense_id}`);
  if (!getBlock.get(block.sense_id)) {
    stats.inserted_blocks += insertBlock.run(block.sense_id, block.block_code, block.rationale, block.recommendation).changes;
  }
});

if (apply) transaction();

console.log(JSON.stringify({ ok: true, db: path.relative(process.cwd(), dbPath), ...stats }, null, 2));
db.close();

function row(sense_id, part_of_speech, gloss_key, definition) {
  return { sense_id, part_of_speech, gloss_key, definition };
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index++;
    } else {
      parsed[key] = "true";
    }
  }
  return parsed;
}
