import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const apply = args.apply === "true";

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const fixes = [
  {
    sense_id: 2449,
    lang: "en",
    term: "hot",
    pronunciation: "/h\u0251\u02d0t/",
    pronunciation_system: "IPA"
  },
  {
    sense_id: 2449,
    lang: "ja",
    term: "\u71b1\u3044",
    reading: "\u3042\u3064\u3044",
    reading_system: "kana"
  },
  {
    sense_id: 29695,
    lang: "en",
    term: "hot",
    pronunciation: "/h\u0251\u02d0t/",
    pronunciation_system: "IPA"
  },
  {
    sense_id: 29696,
    lang: "en",
    term: "hot",
    pronunciation: "/h\u0251\u02d0t/",
    pronunciation_system: "IPA"
  },
  {
    sense_id: 29697,
    lang: "en",
    term: "hot",
    pronunciation: "/h\u0251\u02d0t/",
    pronunciation_system: "IPA"
  },
  {
    sense_id: 29697,
    lang: "ja",
    term: "\u6d3e\u624b\u306a",
    reading: "\u306f\u3067\u306a",
    reading_system: "kana"
  },
  {
    sense_id: 19005,
    lang: "ja",
    term: "\u6fc0\u3057\u3044",
    reading: "\u306f\u3052\u3057\u3044",
    reading_system: "kana"
  },
  {
    sense_id: 29699,
    lang: "ja",
    term: "\u6fc0\u3057\u3044",
    reading: "\u306f\u3052\u3057\u3044",
    reading_system: "kana"
  }
];

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 30000");

const getLoc = db.prepare(`
  SELECT product_sense_id, lang, term, reading, pronunciation
  FROM product_localizations
  WHERE product_sense_id = ?
    AND lang = ?
`);

const updateLoc = db.prepare(`
  UPDATE product_localizations
  SET term = COALESCE(@term, term),
      reading = @reading,
      reading_system = @reading_system,
      pronunciation = @pronunciation,
      pronunciation_system = @pronunciation_system,
      source = CASE
        WHEN source LIKE 'manual:broad-risk-split-20260625%' THEN source
        ELSE 'manual:broad-risk-split-batch2-reading-repair-20260628'
      END,
      confidence = MAX(confidence, 0.9),
      needs_review = 0
  WHERE product_sense_id = @sense_id
    AND lang = @lang
`);

const preview = fixes.map((fix) => {
  const existing = getLoc.get(fix.sense_id, fix.lang);
  return {
    ...fix,
    found: Boolean(existing),
    old_term: existing?.term || null,
    old_reading: existing?.reading || null,
    old_pronunciation: existing?.pronunciation || null
  };
});

let updated = 0;
if (apply) {
  db.transaction(() => {
    for (const fix of fixes) {
      updated += updateLoc.run({
        sense_id: fix.sense_id,
        lang: fix.lang,
        term: fix.term || null,
        reading: fix.reading || null,
        reading_system: fix.reading_system || null,
        pronunciation: fix.pronunciation || null,
        pronunciation_system: fix.pronunciation_system || null
      }).changes;
    }
  })();
}

console.log(JSON.stringify({ ok: preview.every((row) => row.found), apply, updated, preview }, null, 2));
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
