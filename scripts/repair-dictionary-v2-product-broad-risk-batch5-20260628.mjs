import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const apply = args.apply === "true";

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const repairs = [
  {
    sense_id: 3940,
    part_of_speech: "noun",
    gloss_key: "plural of mile; units or distances of more than one mile",
    localizations: {
      en: {
        term: "miles",
        reading: null,
        reading_system: null,
        pronunciation: "/ma\u026alz/",
        pronunciation_system: "IPA",
        definition: "Plural of mile; units or distances of more than one mile."
      },
      zh: {
        term: "\u82f1\u91cc",
        reading: "y\u012bng l\u01d0",
        reading_system: "pinyin",
        pronunciation: null,
        pronunciation_system: null,
        definition: "\u82f1\u91cc\u7684\u590d\u6570\uff1b\u8868\u793a\u591a\u4e2a\u82f1\u91cc\u6216\u5f88\u957f\u7684\u8ddd\u79bb\u3002"
      },
      ja: {
        term: "\u30de\u30a4\u30eb",
        reading: "\u30de\u30a4\u30eb",
        reading_system: "katakana",
        pronunciation: null,
        pronunciation_system: null,
        definition: "\u30de\u30a4\u30eb\u306e\u8907\u6570\u5f62\u3002\u8907\u6570\u306e\u30de\u30a4\u30eb\u307e\u305f\u306f\u9577\u3044\u8ddd\u96e2\u3092\u8868\u3059\u3002"
      },
      "pt-BR": {
        term: "milhas",
        reading: null,
        reading_system: null,
        pronunciation: "/\u02c8mi.\u028eas/",
        pronunciation_system: "IPA",
        definition: "Plural de milha; unidades ou dist\u00e2ncias de mais de uma milha."
      }
    }
  },
  {
    sense_id: 16161,
    part_of_speech: "character",
    gloss_key: "fierce, cruel, or over-strict",
    localizations: {
      en: {
        term: "fierce",
        reading: null,
        reading_system: null,
        pronunciation: "/f\u026ars/",
        pronunciation_system: "IPA",
        definition: "Fierce, cruel, hostile, or excessively strict."
      },
      zh: {
        term: "\u60e1",
        reading: "\u00e8",
        reading_system: "pinyin",
        pronunciation: null,
        pronunciation_system: null,
        definition: "\u51f6\u731b\u3001\u51f6\u72e0\u6216\u8fc7\u4e8e\u4e25\u5389\u3002"
      },
      ja: {
        term: "\u60aa",
        reading: "\u3042\u304f",
        reading_system: "hiragana",
        pronunciation: null,
        pronunciation_system: null,
        definition: "\u6fc0\u3057\u3044\u3001\u6b8b\u9177\u306a\u3001\u307e\u305f\u306f\u904e\u5ea6\u306b\u53b3\u3057\u3044\u3055\u307e\u3002"
      },
      "pt-BR": {
        term: "feroz",
        reading: null,
        reading_system: null,
        pronunciation: "/fe.\u02c8\u027e\u0254s/",
        pronunciation_system: "IPA",
        definition: "Feroz, cruel, hostil ou excessivamente rigoroso."
      }
    }
  },
  {
    sense_id: 16828,
    part_of_speech: "noun",
    gloss_key: "a live performance or temporary job",
    localizations: {
      en: {
        term: "gig",
        reading: null,
        reading_system: null,
        pronunciation: "/\u0261\u026a\u0261/",
        pronunciation_system: "IPA",
        definition: "A live performance, especially by a musician, or a temporary job."
      },
      zh: {
        term: "\u6f14\u51fa",
        reading: "y\u01cen ch\u016b",
        reading_system: "pinyin",
        pronunciation: null,
        pronunciation_system: null,
        definition: "\u73b0\u573a\u6f14\u51fa\uff0c\u5c24\u6307\u97f3\u4e50\u8868\u6f14\uff1b\u4e5f\u6307\u4e34\u65f6\u5de5\u4f5c\u3002"
      },
      ja: {
        term: "\u30ae\u30b0",
        reading: "\u30ae\u30b0",
        reading_system: "katakana",
        pronunciation: null,
        pronunciation_system: null,
        definition: "\u30df\u30e5\u30fc\u30b8\u30b7\u30e3\u30f3\u306a\u3069\u306e\u30e9\u30a4\u30d6\u6f14\u594f\u3002\u307e\u305f\u306f\u77ed\u671f\u306e\u4ed5\u4e8b\u3002"
      },
      "pt-BR": {
        term: "show",
        reading: null,
        reading_system: null,
        pronunciation: "/\u0283ow/",
        pronunciation_system: "IPA",
        definition: "Apresenta\u00e7\u00e3o ao vivo, especialmente musical, ou trabalho tempor\u00e1rio."
      }
    }
  },
  {
    sense_id: 23865,
    part_of_speech: "verb",
    gloss_key: "past participle of fly",
    localizations: {
      en: {
        term: "flown",
        reading: null,
        reading_system: null,
        pronunciation: "/flo\u028an/",
        pronunciation_system: "IPA",
        definition: "Past participle of fly."
      },
      zh: {
        term: "\u98de\u8fc7\u7684",
        reading: "f\u0113i gu\u00f2 de",
        reading_system: "pinyin",
        pronunciation: null,
        pronunciation_system: null,
        definition: "\u52a8\u8bcdfly\u7684\u8fc7\u53bb\u5206\u8bcd\u5f62\u5f0f\u3002"
      },
      ja: {
        term: "\u98db\u3093\u3060",
        reading: "\u3068\u3093\u3060",
        reading_system: "kana",
        pronunciation: null,
        pronunciation_system: null,
        definition: "\u52d5\u8a5efly\u306e\u904e\u53bb\u5206\u8a5e\u5f62\u3002"
      },
      "pt-BR": {
        term: "voado",
        reading: null,
        reading_system: null,
        pronunciation: "/vo.\u02c8a.du/",
        pronunciation_system: "IPA",
        definition: "Partic\u00edpio passado do verbo voar."
      }
    }
  },
  {
    sense_id: 23920,
    part_of_speech: "adjective",
    gloss_key: "covered with sweat or causing sweat",
    localizations: {
      en: {
        term: "sweaty",
        reading: null,
        reading_system: null,
        pronunciation: "/\u02c8sw\u025bti/",
        pronunciation_system: "IPA",
        definition: "Covered with sweat or likely to cause sweating."
      },
      zh: {
        term: "\u51fa\u6c57\u7684",
        reading: "ch\u016b h\u00e0n de",
        reading_system: "pinyin",
        pronunciation: null,
        pronunciation_system: null,
        definition: "\u6cbe\u6ee1\u6c57\u6c34\u7684\uff0c\u6216\u4f1a\u4f7f\u4eba\u51fa\u6c57\u7684\u3002"
      },
      ja: {
        term: "\u6c57\u3070\u3093\u3060",
        reading: "\u3042\u305b\u3070\u3093\u3060",
        reading_system: "kana",
        pronunciation: null,
        pronunciation_system: null,
        definition: "\u6c57\u3067\u6fe1\u308c\u305f\u3001\u307e\u305f\u306f\u6c57\u3092\u304b\u304f\u3088\u3046\u306a\u3002"
      },
      "pt-BR": {
        term: "suado",
        reading: null,
        reading_system: null,
        pronunciation: "/\u02c8swa.du/",
        pronunciation_system: "IPA",
        definition: "Coberto de suor ou que provoca suor."
      }
    }
  }
];

const db = new Database(dbPath);
db.pragma("busy_timeout = 30000");

const updateSense = db.prepare(`
  UPDATE product_senses
  SET part_of_speech = ?,
      gloss_key = ?,
      confidence = MAX(confidence, 0.88)
  WHERE id = ?
`);

const updateLocalization = db.prepare(`
  UPDATE product_localizations
  SET term = ?,
      reading = ?,
      reading_system = ?,
      pronunciation = ?,
      pronunciation_system = ?,
      definition = ?,
      source = 'manual:broad-risk-batch5-20260628',
      confidence = MAX(confidence, 0.88),
      needs_review = 0
  WHERE product_sense_id = ?
    AND lang = ?
`);

const transaction = db.transaction(() => {
  for (const repair of repairs) {
    const sense = db.prepare("SELECT id FROM product_senses WHERE id = ?").get(repair.sense_id);
    if (!sense) throw new Error(`Missing product_sense ${repair.sense_id}`);
    updateSense.run(repair.part_of_speech, repair.gloss_key, repair.sense_id);
    for (const [lang, loc] of Object.entries(repair.localizations)) {
      const result = updateLocalization.run(
        loc.term,
        loc.reading,
        loc.reading_system,
        loc.pronunciation,
        loc.pronunciation_system,
        loc.definition,
        repair.sense_id,
        lang
      );
      if (result.changes !== 1) throw new Error(`Missing localization ${repair.sense_id}:${lang}`);
    }
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
