import Database from "better-sqlite3";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";
const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const dryRun = args["dry-run"] === "true";

const source = "deterministic-clean3-residual-finalize-20260621";

const fixes = [
  {
    sense_id: 16,
    lang: "zh",
    term: "接续助词",
    reading: "jie1 xu4 zhu4 ci2",
    reading_system: "pinyin",
    pronunciation: null,
    pronunciation_system: null,
    definition: "日语助词，用于连接句子或短语，表示动作、状态的连续、手段、方法、理由等。",
    accepted_job_ids: [53135, 53173]
  },
  {
    sense_id: 150,
    lang: "ja",
    term: "である",
    reading: "である",
    reading_system: "hiragana",
    pronunciation: null,
    pronunciation_system: null,
    definition: "存在や同一性を表す語。英語の be に相当し、文語的または硬い文体で断定にも用いられる。",
    accepted_job_ids: [53163, 53179]
  },
  {
    sense_id: 1070,
    lang: "ja",
    term: "悪い",
    reading: "わるい",
    reading_system: "hiragana",
    pronunciation: null,
    pronunciation_system: null,
    definition: "品質、状態、性質などが標準より劣っていて、よくないこと。",
    accepted_job_ids: [53250]
  },
  {
    sense_id: 18187,
    lang: "ja",
    term: "さえ",
    reading: "さえ",
    reading_system: "hiragana",
    pronunciation: null,
    pronunciation_system: null,
    definition: "ある事柄を強調し、それだけでも意外または十分であることを示す助詞。",
    accepted_job_ids: [53211]
  },
  {
    sense_id: 18188,
    lang: "ja",
    term: "さえ",
    reading: "さえ",
    reading_system: "hiragana",
    pronunciation: null,
    pronunciation_system: null,
    definition: "予想外のものを含めて強調し、他の場合も同様であることを示す助詞または副詞。",
    accepted_job_ids: [53215]
  },
  {
    sense_id: 1805,
    lang: "ja",
    term: "理由",
    reading: "りゆう",
    reading_system: "hiragana",
    pronunciation: null,
    pronunciation_system: null,
    definition: "行動や判断の根拠となる事柄。理由、動機、説明。",
    accepted_job_ids: [53258]
  },
  {
    sense_id: 3831,
    lang: "ja",
    term: "顎",
    reading: "あご",
    reading_system: "hiragana",
    pronunciation: null,
    pronunciation_system: null,
    definition: "口を開閉させるために動く、顔の下部にある骨や筋肉の部分。",
    accepted_job_ids: [53273]
  },
  {
    sense_id: 18249,
    lang: "zh",
    term: "儿子",
    reading: "er2 zi5",
    reading_system: "pinyin",
    pronunciation: null,
    pronunciation_system: null,
    definition: "子女中的男性后代。",
    accepted_job_ids: [53301]
  }
];

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 30000");

const statements = {
  localization: db.prepare(`
    SELECT id
    FROM product_localizations
    WHERE product_sense_id = ? AND lang = ?
  `),
  insertLocalization: db.prepare(`
    INSERT INTO product_localizations
      (product_sense_id, lang, term, reading, reading_system, pronunciation, pronunciation_system,
       definition, source, confidence, needs_review)
    VALUES
      (@sense_id, @lang, @term, @reading, @reading_system, @pronunciation, @pronunciation_system,
       @definition, @source, 0.99, 0)
  `),
  updateLocalization: db.prepare(`
    UPDATE product_localizations
    SET term = @term,
        reading = @reading,
        reading_system = @reading_system,
        pronunciation = @pronunciation,
        pronunciation_system = @pronunciation_system,
        definition = @definition,
        source = @source,
        confidence = 0.99,
        needs_review = 0
    WHERE id = @id
  `),
  markJobAccepted: db.prepare(`
    UPDATE product_llm_completion_jobs
    SET status = 'accepted',
        output_json = @output_json,
        error = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `)
};

const stats = {
  db: path.relative(process.cwd(), dbPath),
  dry_run: dryRun,
  fixes: fixes.length,
  inserted: 0,
  updated: 0,
  jobs_marked_accepted: 0
};

if (!dryRun) {
  db.transaction(() => {
    for (const fix of fixes) applyFix(fix);
  })();
} else {
  for (const fix of fixes) {
    if (statements.localization.get(fix.sense_id, fix.lang)) stats.updated++;
    else stats.inserted++;
    stats.jobs_marked_accepted += fix.accepted_job_ids.length;
  }
}

console.log(JSON.stringify(stats, null, 2));
db.close();

function applyFix(fix) {
  const payload = { ...fix, source };
  const existing = statements.localization.get(fix.sense_id, fix.lang);
  if (existing) {
    statements.updateLocalization.run({ ...payload, id: existing.id });
    stats.updated++;
  } else {
    statements.insertLocalization.run(payload);
    stats.inserted++;
  }

  const outputJson = JSON.stringify(
    {
      sense_localization: {
        lang: fix.lang,
        term: fix.term,
        reading: fix.reading,
        reading_system: fix.reading_system,
        pronunciation: fix.pronunciation,
        pronunciation_system: fix.pronunciation_system,
        definition: fix.definition,
        usage_note: null
      },
      example_localizations: []
    },
    null,
    2
  );
  for (const id of fix.accepted_job_ids) {
    const result = statements.markJobAccepted.run({ id, output_json: outputJson });
    stats.jobs_marked_accepted += result.changes;
  }
}

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
