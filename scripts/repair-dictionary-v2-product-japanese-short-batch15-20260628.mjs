import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";
const SOURCE = "manual:japanese-short-batch15-20260628";

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const apply = args.apply === "true";

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const senseRepairs = [
  row(38, "particle", "Japanese sentence-final particle for emphasis or prohibition"),
  row(53, "auxiliary verb", "Japanese copula da expressing assertion or identity"),
  row(64, "particle", "Japanese particle de marking means, location, or cause"),
  row(77, "particle", "Japanese particle ka marking question or alternative"),
  row(98, "particle", "Japanese syllabic n or nasal sound"),
  row(123, "pronoun", "Japanese first-person pronoun watashi"),
  row(147, "pronoun", "archaic or dialectal Japanese first-person pronoun wa"),
  row(237, "pronoun", "casual masculine Japanese first-person pronoun ore"),
  row(361, "suffix", "Japanese honorific suffix san"),
  row(384, "pronoun", "casual masculine Japanese first-person pronoun boku"),
  row(397, "auxiliary", "Japanese conditional expression nara meaning if"),
  row(460, "particle", "Japanese particle e marking direction toward"),
  row(563, "pronoun", "Japanese reflexive or self pronoun jibun"),
  row(877, "pronoun", "dialectal Japanese first-person pronoun oi"),
  row(1192, "interjection", "Japanese interjection iie meaning no"),
  row(1373, "interjection", "Japanese interjection un for yes or acknowledgement"),
  row(2186, "interjection", "Japanese acknowledgement meaning understood or OK"),
  row(3736, "pronoun", "Japanese first-person pronoun ware"),
  row(3775, "interjection", "Japanese exclamation a expressing surprise"),
  row(3946, "prenominal adjective", "Japanese possessive waga meaning my or our"),
  row(4123, "noun", "Japanese unit of capacity go"),
  row(18498, "interjection", "Japanese loanword no expressing refusal"),
  row(12871, "expression", "Japanese katakana aru expressing be or exist"),
  row(14480, "interjection", "Japanese interjection uun meaning no"),
  row(15405, "prefix", "Japanese loan prefix mai meaning my"),
  row(18999, "interjection", "Japanese exclamation arya expressing surprise"),
  row(19378, "interjection", "Japanese exclamation ha expressing surprise"),
  row(19566, "particle", "Japanese formal particle nite meaning at, in, or by"),
  row(20917, "unclassified", "Japanese katakana loanword obu meaning of"),
  row(21087, "conjunction", "Japanese conjunction aruiwa meaning or"),
  row(21780, "interjection", "Japanese hesitation sound nn"),
  row(26974, "interjection", "Japanese interjection ai expressing response or call"),
  row(27680, "interjection", "Japanese exclamation ya")
];

const fullRepairs = [
  {
    sense_id: 38,
    locs: {
      en: loc("na", null, null, null, null, "A Japanese sentence-final particle used for emphasis, appeal, or mild prohibition."),
      zh: loc("\u554a\uff1b\u54ea", "a; na", "pinyin", null, null, "\u65e5\u8bed\u7ec8\u52a9\u8bcd\uff0c\u7528\u4e8e\u8868\u793a\u611f\u53f9\u3001\u5f3a\u8c03\u3001\u63d0\u9192\u6216\u8f7b\u5fae\u7981\u6b62\u3002"),
      ja: loc("\u306a", "\u306a", "kana", null, null, "\u7d42\u52a9\u8a5e\u3002\u611f\u5606\u3001\u5f37\u8abf\u3001\u547c\u3073\u304b\u3051\u3001\u8efd\u3044\u7981\u6b62\u306a\u3069\u3092\u8868\u3059\u3002"),
      "pt-BR": loc("na", null, null, null, null, "Particula final japonesa usada para enfase, apelo ou proibicao leve.")
    }
  },
  {
    sense_id: 98,
    locs: {
      en: loc("syllabic n", null, null, null, null, "The Japanese moraic nasal sound n, written as \u3093."),
      zh: loc("\u62e8\u97f3", "b\u014d y\u012bn", "pinyin", null, null, "\u65e5\u8bed\u5047\u540d\u300c\u3093\u300d\u8868\u793a\u7684\u62e8\u97f3\u6216\u9f3b\u97f3\u3002"),
      ja: loc("\u3093", "\u3093", "kana", null, null, "\u65e5\u672c\u8a9e\u306e\u64a5\u97f3\u3092\u8868\u3059\u4eee\u540d\u3002"),
      "pt-BR": loc("n silabico", null, null, null, null, "Som nasal moraico do japones, escrito como \u3093.")
    }
  },
  {
    sense_id: 6182,
    part_of_speech: "particle",
    gloss_key: "Japanese sentence-final particle dai used in questions",
    locs: {
      en: loc("dai", null, null, null, null, "A Japanese sentence-final particle used in familiar questions or emphatic speech."),
      zh: loc("\u5462\uff1b\u554a", "ne; a", "pinyin", null, null, "\u65e5\u8bed\u7ec8\u52a9\u8bcd\uff0c\u5e38\u7528\u4e8e\u4eb2\u8fd1\u8bed\u6c14\u7684\u7591\u95ee\u6216\u5f3a\u8c03\u3002"),
      ja: loc("\u3060\u3044", "\u3060\u3044", "kana", null, null, "\u89aa\u3057\u3044\u8a00\u3044\u65b9\u306e\u7591\u554f\u3084\u5f37\u8abf\u306b\u7528\u3044\u308b\u7d42\u52a9\u8a5e\u3002"),
      "pt-BR": loc("dai", null, null, null, null, "Particula final japonesa usada em perguntas familiares ou fala enfatica.")
    }
  },
  {
    sense_id: 15414,
    part_of_speech: "noun",
    gloss_key: "Japanese katakana syllable yo",
    locs: {
      en: loc("yo", null, null, null, null, "The Japanese katakana syllable \u30e8, pronounced yo."),
      zh: loc("\u65e5\u8bed\u7247\u5047\u540d yo", "r\u00ec y\u01d4 pi\u00e0n ji\u01ce m\u00edng yo", "pinyin", null, null, "\u65e5\u8bed\u7247\u5047\u540d\u300c\u30e8\u300d\uff0c\u8bfb\u4f5c yo\u3002"),
      ja: loc("\u30e8", "\u30e8", "kana", null, null, "\u7247\u4eee\u540d\u306e\u4e00\u3064\u3002\u30e8\u3068\u8aad\u3080\u3002"),
      "pt-BR": loc("yo", null, null, null, null, "Silaba katakana japonesa \u30e8, pronunciada yo.")
    }
  },
  {
    sense_id: 29489,
    part_of_speech: "noun",
    gloss_key: "Japanese katakana syllable shi",
    locs: {
      en: loc("shi", null, null, null, null, "The Japanese katakana syllable \u30b7, pronounced shi."),
      zh: loc("\u65e5\u8bed\u7247\u5047\u540d shi", "r\u00ec y\u01d4 pi\u00e0n ji\u01ce m\u00edng shi", "pinyin", null, null, "\u65e5\u8bed\u7247\u5047\u540d\u300c\u30b7\u300d\uff0c\u8bfb\u4f5c shi\u3002"),
      ja: loc("\u30b7", "\u30b7", "kana", null, null, "\u7247\u4eee\u540d\u306e\u4e00\u3064\u3002\u30b7\u3068\u8aad\u3080\u3002"),
      "pt-BR": loc("shi", null, null, null, null, "Silaba katakana japonesa \u30b7, pronunciada shi.")
    }
  }
];

const blocks = [
  {
    sense_id: 221,
    block_code: "blocked_source_ambiguous",
    rationale: "The Japanese entry 'se' is mapped to English 'so' with an inconsistent Japanese definition; source evidence is too weak for publication.",
    recommendation: "Keep blocked until a source-backed Japanese sense for 'se' is added."
  }
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
      confidence = MAX(confidence, 0.9),
      needs_review = 0
  WHERE product_sense_id = @sense_id
    AND lang = @lang
`);

const insertBlock = db.prepare(`
  INSERT INTO product_sense_publication_blocks (
    product_sense_id, block_code, rationale, recommendation, created_at, updated_at
  )
  VALUES (@sense_id, @block_code, @rationale, @recommendation, datetime('now'), datetime('now'))
`);

const stats = {
  apply,
  gloss_repair_count: senseRepairs.length,
  full_repair_count: fullRepairs.length,
  blocked_sense_ids: blocks.map((block) => block.sense_id),
  updated_senses: 0,
  updated_localizations: 0,
  inserted_blocks: 0
};

validateInputs();

const transaction = db.transaction(() => {
  for (const repair of senseRepairs) {
    stats.updated_senses += updateSense.run(repair).changes;
  }
  for (const repair of fullRepairs) {
    if (repair.part_of_speech && repair.gloss_key) {
      stats.updated_senses += updateSense.run(repair).changes;
    }
    for (const [lang, value] of Object.entries(repair.locs)) {
      stats.updated_localizations += updateLoc.run({
        sense_id: repair.sense_id,
        lang,
        ...value,
        source: SOURCE
      }).changes;
    }
  }
  for (const block of blocks) {
    if (!getBlock.get(block.sense_id, block.block_code)) {
      stats.inserted_blocks += insertBlock.run(block).changes;
    }
  }
});

if (apply) transaction();

console.log(JSON.stringify({ ok: true, db: path.relative(process.cwd(), dbPath), ...stats }, null, 2));
db.close();

function validateInputs() {
  const repairedIds = new Set();
  for (const repair of senseRepairs) {
    if (!getSense.get(repair.sense_id)) throw new Error(`Missing product_sense ${repair.sense_id}`);
    repairedIds.add(repair.sense_id);
  }
  for (const repair of fullRepairs) {
    if (!getSense.get(repair.sense_id)) throw new Error(`Missing product_sense ${repair.sense_id}`);
    repairedIds.add(repair.sense_id);
    for (const lang of Object.keys(repair.locs)) {
      if (!getLoc.get(repair.sense_id, lang)) throw new Error(`Missing localization ${repair.sense_id}:${lang}`);
    }
  }
  for (const block of blocks) {
    if (!getSense.get(block.sense_id)) throw new Error(`Missing block sense ${block.sense_id}`);
    repairedIds.add(block.sense_id);
  }
  if (repairedIds.size !== 37) throw new Error(`Expected to cover 37 Japanese short risk senses, got ${repairedIds.size}`);
}

function row(sense_id, part_of_speech, gloss_key) {
  return { sense_id, part_of_speech, gloss_key };
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
