import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";
const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const apply = args.apply === "true" || args.apply === true;

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 30000");

const keepSenseId = 22306;
const removeSenseId = 22943;

const before = describe();

const updateSense = db.prepare("UPDATE product_senses SET part_of_speech = 'verb' WHERE id = ?");
const updateJa = db.prepare(`
  UPDATE product_localizations
  SET term = 'つぶやく',
      reading = 'つぶやく',
      reading_system = 'kana',
      definition = '低い声で小さく、はっきりしないように話す',
      source = 'manual:murmuring-repair-20260624'
  WHERE product_sense_id = ?
    AND lang = 'ja'
`);

let changes = 0;
if (apply) {
  db.transaction(() => {
    changes += updateSense.run(keepSenseId).changes;
    changes += updateJa.run(keepSenseId).changes;
  })();
}

const after = describe();
db.close();

console.log(
  JSON.stringify(
    {
      ok: true,
      db: path.relative(process.cwd(), dbPath),
      apply,
      keep_sense_id: keepSenseId,
      remove_sense_id: removeSenseId,
      changes,
      before,
      after
    },
    null,
    2
  )
);

function describe() {
  return db
    .prepare(
      `
      SELECT ps.id, ps.sense_order, ps.part_of_speech, ps.gloss_key,
             pl.lang, pl.term, pl.reading, pl.reading_system, pl.definition, pl.source
      FROM product_senses ps
      JOIN product_localizations pl ON pl.product_sense_id = ps.id
      WHERE ps.id IN (?, ?)
      ORDER BY ps.id, pl.lang
    `
    )
    .all(keepSenseId, removeSenseId);
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
