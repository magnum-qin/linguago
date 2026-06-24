import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";
const SOURCE_SUFFIX = "+manual:ja-latin-term-repair-20260624";

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const apply = args.apply === "true" || args.apply === true;

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const fixes = [
  { sense_id: 49, term: "〜の", reading: "の", reading_system: "kana" },
  { sense_id: 424, term: "〜だろう", reading: "だろう", reading_system: "kana" },
  { sense_id: 430, term: "〜であった", reading: "であった", reading_system: "kana" },
  { sense_id: 442, term: "〜であったこと", reading: "であったこと", reading_system: "kana" },
  { sense_id: 475, term: "〜するつもり", reading: "するつもり", reading_system: "kana" },
  { sense_id: 490, term: "〜できた", reading: "できた", reading_system: "kana" }
];

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 30000");

const existing = db.prepare(`
  SELECT id, product_sense_id, term, reading, reading_system, definition, source
  FROM product_localizations
  WHERE product_sense_id = ?
    AND lang = 'ja'
    AND needs_review = 0
`);
const update = db.prepare(`
  UPDATE product_localizations
  SET term = @term,
      reading = @reading,
      reading_system = @reading_system,
      source = CASE
        WHEN instr(source, @source_suffix) > 0 THEN source
        ELSE source || @source_suffix
      END
  WHERE product_sense_id = @sense_id
    AND lang = 'ja'
    AND needs_review = 0
`);

const stats = {
  db: path.relative(process.cwd(), dbPath),
  apply,
  fixes: fixes.length,
  found: 0,
  updated: 0,
  missing: []
};

if (apply) {
  db.transaction(() => {
    for (const fix of fixes) applyFix(fix);
  })();
} else {
  for (const fix of fixes) {
    if (existing.get(fix.sense_id)) stats.found++;
    else stats.missing.push(fix.sense_id);
  }
}

console.log(JSON.stringify(stats, null, 2));
db.close();

function applyFix(fix) {
  const row = existing.get(fix.sense_id);
  if (!row) {
    stats.missing.push(fix.sense_id);
    return;
  }
  stats.found++;
  stats.updated += update.run({ ...fix, source_suffix: SOURCE_SUFFIX }).changes;
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
