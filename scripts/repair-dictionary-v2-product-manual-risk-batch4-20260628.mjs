import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";
const SOURCE = "manual:broad-risk-manual-batch4-20260628";

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const apply = args.apply === "true";

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const repairs = [
  {
    sense_id: 889,
    part_of_speech: "verb",
    gloss_key: "third-person singular present of do",
    locs: {
      en: loc("does", null, null, "/d\u028cz/", "IPA", "Third-person singular present form of do, used to perform actions or as an auxiliary verb."),
      zh: loc("\u505a\uff1b\u786e\u5b9e", "zu\u00f2; qu\u00e8 sh\u00ed", "pinyin", null, null, "\u52a8\u8bcd do \u7684\u7b2c\u4e09\u4eba\u79f0\u5355\u6570\u73b0\u5728\u5f0f\uff0c\u8868\u793a\u505a\u67d0\u4e8b\uff0c\u6216\u4f5c\u52a9\u52a8\u8bcd\u4f7f\u7528\u3002"),
      ja: loc("\u3059\u308b", "\u3059\u308b", "kana", null, null, "\u52d5\u8a5e do \u306e\u4e09\u4eba\u79f0\u5358\u6570\u73fe\u5728\u5f62\u3002\u52d5\u4f5c\u3092\u8868\u3059\u307b\u304b\u3001\u52a9\u52d5\u8a5e\u3068\u3057\u3066\u7528\u3044\u3089\u308c\u308b\u3002"),
      "pt-BR": loc("faz", null, null, "/fas/", "IPA", "Forma da terceira pessoa do singular do presente de do; usada para realizar a\u00e7\u00f5es ou como verbo auxiliar.")
    }
  },
  {
    sense_id: 1289,
    part_of_speech: "adjective",
    gloss_key: "actually existing; genuine",
    locs: {
      en: loc("real", null, null, "/\u02c8ri\u02d0\u0259l/", "IPA", "Actually existing or happening; genuine, not imaginary or artificial."),
      zh: loc("\u771f\u5b9e\u7684", "zh\u0113n sh\u00ed de", "pinyin", null, null, "\u5b9e\u9645\u5b58\u5728\u6216\u53d1\u751f\u7684\uff1b\u771f\u7684\uff0c\u975e\u865a\u6784\u6216\u4eba\u9020\u7684\u3002"),
      ja: loc("\u73fe\u5b9f\u306e", "\u3052\u3093\u3058\u3064\u306e", "kana", null, null, "\u5b9f\u969b\u306b\u5b58\u5728\u3059\u308b\u3001\u307e\u305f\u306f\u8d77\u3053\u3063\u3066\u3044\u308b\u3053\u3068\u3002\u672c\u7269\u3067\u3042\u308a\u3001\u60f3\u50cf\u4e0a\u3084\u4eba\u5de5\u7684\u306a\u3082\u306e\u3067\u306f\u306a\u3044\u3002"),
      "pt-BR": loc("real", null, null, "/\u0281e\u02c8aw/", "IPA", "Que existe ou acontece de fato; verdadeiro, n\u00e3o imagin\u00e1rio ou artificial.")
    }
  },
  {
    sense_id: 1972,
    part_of_speech: "auxiliary verb",
    gloss_key: "auxiliary verb expressing future action, obligation, or command",
    locs: {
      en: loc("shall", null, null, "/\u0283\u00e6l/", "IPA", "Auxiliary verb used to express future action, obligation, command, or formal intention."),
      zh: loc("\u5c06\uff1b\u5e94\u5f53", "ji\u0101ng; y\u012bng d\u0101ng", "pinyin", null, null, "\u82f1\u8bed\u52a9\u52a8\u8bcd\uff0c\u7528\u4e8e\u8868\u793a\u5c06\u6765\u3001\u4e49\u52a1\u3001\u547d\u4ee4\u6216\u6b63\u5f0f\u610f\u56fe\u3002"),
      ja: loc("\u301c\u3059\u308b\u3082\u306e\u3068\u3059\u308b", "\u301c\u3059\u308b\u3082\u306e\u3068\u3059\u308b", "kana", null, null, "\u672a\u6765\u3001\u7fa9\u52d9\u3001\u547d\u4ee4\u3001\u6b63\u5f0f\u306a\u610f\u56f3\u3092\u8868\u3059\u82f1\u8a9e\u306e\u52a9\u52d5\u8a5e\u3002"),
      "pt-BR": loc("dever\u00e1", null, null, "/de.ve.\u02c8\u027ea/", "IPA", "Verbo auxiliar usado para expressar futuro, obriga\u00e7\u00e3o, comando ou inten\u00e7\u00e3o formal.")
    }
  },
  {
    sense_id: 15436,
    part_of_speech: "noun",
    gloss_key: "informal sister",
    locs: {
      en: loc("sis", null, null, "/s\u026as/", "IPA", "Informal word for sister."),
      zh: loc("\u59d0\u59b9", "ji\u011b m\u00e8i", "pinyin", null, null, "\u5bf9\u59d0\u59b9\u7684\u975e\u6b63\u5f0f\u79f0\u547c\u3002"),
      ja: loc("\u59c9\u59b9", "\u3057\u307e\u3044", "kana", null, null, "\u59c9\u3084\u59b9\u3092\u6307\u3059\u304f\u3060\u3051\u305f\u8a00\u3044\u65b9\u3002"),
      "pt-BR": loc("mana", null, null, "/\u02c8m\u0250.n\u0250/", "IPA", "Forma informal de se referir a uma irm\u00e3.")
    }
  },
  {
    sense_id: 16470,
    part_of_speech: "interjection",
    gloss_key: "yes; aye; expression of assent",
    locs: {
      en: loc("ay", null, null, "/e\u026a/", "IPA", "An affirmative response equivalent to yes or aye; also used as an exclamation."),
      zh: loc("\u662f\uff1b\u54ce", "sh\u00ec; \u0101i", "pinyin", null, null, "\u8868\u793a\u80af\u5b9a\u56de\u7b54\u6216\u540c\u610f\uff0c\u76f8\u5f53\u4e8e\u201c\u662f\u201d\uff1b\u4e5f\u53ef\u4f5c\u611f\u53f9\u8bcd\u3002"),
      ja: loc("\u306f\u3044", "\u306f\u3044", "kana", null, null, "\u80af\u5b9a\u3084\u8cdb\u6210\u3092\u8868\u3059\u8fd4\u4e8b\u3002\u611f\u5606\u8a5e\u3068\u3057\u3066\u3082\u7528\u3044\u3089\u308c\u308b\u3002"),
      "pt-BR": loc("sim", null, null, "/s\u0129/", "IPA", "Resposta afirmativa equivalente a sim; tamb\u00e9m pode funcionar como interjei\u00e7\u00e3o.")
    }
  }
];

const blocks = [
  [3600, "proper_name_encyclopedic_mix"],
  [4885, "proper_name_encyclopedic_mix"],
  [10364, "proper_name_encyclopedic_mix"],
  [12029, "proper_name_encyclopedic_mix"],
  [14185, "proper_name_source_mismatch"],
  [15824, "proper_name_encyclopedic_mix"]
];

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 30000");

const getSense = db.prepare("SELECT id FROM product_senses WHERE id = ?");
const getLoc = db.prepare("SELECT id FROM product_localizations WHERE product_sense_id = ? AND lang = ?");
const getBlock = db.prepare("SELECT id FROM product_sense_publication_blocks WHERE product_sense_id = ? AND block_code = ?");

const updateSense = db.prepare(`
  UPDATE product_senses
  SET part_of_speech = @part_of_speech,
      gloss_key = @gloss_key,
      confidence = MAX(confidence, 0.9)
  WHERE id = @sense_id
`);

const updateLoc = db.prepare(`
  UPDATE product_localizations
  SET term = @term,
      reading = @reading,
      reading_system = @reading_system,
      pronunciation = @pronunciation,
      pronunciation_system = @pronunciation_system,
      definition = @definition,
      source = @source,
      confidence = 0.9,
      needs_review = 0
  WHERE product_sense_id = @sense_id
    AND lang = @lang
`);

const insertBlock = db.prepare(`
  INSERT INTO product_sense_publication_blocks (
    product_sense_id, block_code, rationale, recommendation, created_at, updated_at
  )
  VALUES (@sense_id, 'blocked_source_ambiguous', @rationale, @recommendation, datetime('now'), datetime('now'))
`);

const stats = {
  apply,
  repaired_senses: 0,
  updated_localizations: 0,
  inserted_blocks: 0,
  notes: []
};

validateInputs();

if (apply) {
  db.transaction(() => {
    for (const repair of repairs) {
      stats.repaired_senses += updateSense.run(repair).changes;
      for (const [lang, value] of Object.entries(repair.locs)) {
        stats.updated_localizations += updateLoc.run({
          sense_id: repair.sense_id,
          lang,
          ...value,
          source: SOURCE
        }).changes;
      }
    }
    for (const [senseId, reason] of blocks) {
      if (!getBlock.get(senseId, "blocked_source_ambiguous")) {
        stats.inserted_blocks += insertBlock.run({
          sense_id: senseId,
          rationale: `Blocked broad proper-name or source-noise sense during batch4 manual risk cleanup: ${reason}.`,
          recommendation: "Do not publish until proper-name entries are modeled intentionally."
        }).changes;
      }
    }
  })();
  stats.notes.push("repaired does, real, shall, sis, ay");
  stats.notes.push("blocked broad proper-name/source-noise senses for George, James, Elizabeth, Edward, Steven, and Lincoln");
} else {
  stats.notes.push("dry-run only; pass --apply true to write changes");
}

console.log(JSON.stringify(stats, null, 2));
db.close();

function validateInputs() {
  for (const repair of repairs) {
    if (!getSense.get(repair.sense_id)) throw new Error(`Missing repair sense ${repair.sense_id}`);
    for (const lang of Object.keys(repair.locs)) {
      if (!getLoc.get(repair.sense_id, lang)) throw new Error(`Missing localization ${repair.sense_id}:${lang}`);
    }
  }
  for (const [senseId] of blocks) {
    if (!getSense.get(senseId)) throw new Error(`Missing block sense ${senseId}`);
  }
}

function loc(term, reading, readingSystem, pronunciation, pronunciationSystem, definition) {
  return {
    term,
    reading,
    reading_system: readingSystem,
    pronunciation,
    pronunciation_system: pronunciationSystem,
    definition
  };
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
