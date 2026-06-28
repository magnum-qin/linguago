import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const apply = args.apply === "true";

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const repairs = [
  { sense_id: 18449, part_of_speech: "noun", gloss_key: "a dwelling or place to live" },
  { sense_id: 2949, part_of_speech: "noun", gloss_key: "a way or method of doing something" },
  { sense_id: 3096, part_of_speech: "character", gloss_key: "a tube, pipe, or duct" },
  { sense_id: 3943, part_of_speech: "character", gloss_key: "strange or unusual" },
  { sense_id: 4221, part_of_speech: "phrase", gloss_key: "forget it or let it be" },
  { sense_id: 6874, part_of_speech: "adjective", gloss_key: "very large or huge" },
  { sense_id: 9434, part_of_speech: "interjection", gloss_key: "exclamation of surprise, pain, or annoyance" },
  { sense_id: 11255, part_of_speech: "adjective", gloss_key: "wonderful or marvelous" },
  { sense_id: 14465, part_of_speech: "verb", gloss_key: "to conform to or match" },
  { sense_id: 17200, part_of_speech: "noun", gloss_key: "a passageway or access route" },
  { sense_id: 17816, part_of_speech: "character", gloss_key: "bright, notable, or outstanding" },
  { sense_id: 18114, part_of_speech: "noun", gloss_key: "shortage or insufficiency" },
  { sense_id: 19365, part_of_speech: "noun", gloss_key: "an agreement reached by mutual concession" },
  { sense_id: 21107, part_of_speech: "verb", gloss_key: "to revise or modify" },
  { sense_id: 25369, part_of_speech: "noun", gloss_key: "pleasure or pleasant sensation" }
];

const db = new Database(dbPath);
db.pragma("busy_timeout = 30000");

const updateSense = db.prepare(`
  UPDATE product_senses
  SET part_of_speech = ?,
      gloss_key = ?,
      confidence = MAX(confidence, 0.9)
  WHERE id = ?
`);

const verifyLocs = db.prepare(`
  SELECT COUNT(*) AS n
  FROM product_localizations
  WHERE product_sense_id = ?
`);

const transaction = db.transaction(() => {
  for (const repair of repairs) {
    const locCount = verifyLocs.get(repair.sense_id).n;
    if (locCount !== 4) throw new Error(`Expected 4 localizations for sense ${repair.sense_id}, got ${locCount}`);
    const result = updateSense.run(repair.part_of_speech, repair.gloss_key, repair.sense_id);
    if (result.changes !== 1) throw new Error(`Missing product_sense ${repair.sense_id}`);
  }
});

if (apply) transaction();

console.log(
  JSON.stringify(
    {
      ok: true,
      apply,
      db: path.relative(process.cwd(), dbPath),
      repaired_sense_ids: repairs.map((repair) => repair.sense_id)
    },
    null,
    2
  )
);

db.close();

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
