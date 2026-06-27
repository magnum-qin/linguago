import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const apply = args.apply === "true";

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 30000");

const fixes = [
  { sense_id: 4857, lang: "ja", reading: "ひどい; はげしい; おそろしい" },
  { sense_id: 29691, lang: "ja", reading: "すごい; すばらしい; おどろくべき" },
  { sense_id: 4857, lang: "zh", reading: "lìhai" },
  { sense_id: 29691, lang: "zh", reading: "lìhai" },
  { sense_id: 6150, lang: "zh", reading: "shēnfèn" },
  { sense_id: 29692, lang: "zh", reading: "shēnfèn" },
  { sense_id: 6381, lang: "zh", reading: "fàngxīn" },
  { sense_id: 29693, lang: "zh", reading: "fàngxīn" },
  { sense_id: 8335, lang: "zh", reading: "tíchū" },
  { sense_id: 29694, lang: "zh", reading: "tíchū" }
];

const getLoc = db.prepare(`
  SELECT product_sense_id, lang, term, reading
  FROM product_localizations
  WHERE product_sense_id = ?
    AND lang = ?
`);
const update = db.prepare(`
  UPDATE product_localizations
  SET reading = @reading,
      reading_system = @reading_system,
      source = CASE
        WHEN source LIKE 'manual:broad-risk-split-20260625%' THEN source
        ELSE 'manual:broad-risk-split-reading-repair-20260625'
      END,
      confidence = MAX(confidence, 0.9)
  WHERE product_sense_id = @sense_id
    AND lang = @lang
`);

const preview = [];
for (const fix of fixes) {
  const existing = getLoc.get(fix.sense_id, fix.lang);
  preview.push({
    ...fix,
    found: Boolean(existing),
    term: existing?.term || null,
    old_reading: existing?.reading || null
  });
}

let updated = 0;
if (apply) {
  db.transaction(() => {
    for (const fix of fixes) {
      updated += update.run({
        ...fix,
        reading_system: fix.lang === "zh" ? "pinyin" : "kana"
      }).changes;
    }
  })();
}

console.log(
  JSON.stringify(
    {
      ok: preview.every((row) => row.found),
      apply,
      updated,
      preview
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
