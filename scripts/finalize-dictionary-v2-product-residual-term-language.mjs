import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";
const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const dryRun = args["dry-run"] !== "false";
const source = "known-residual-term-language-finalize-20260620";

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const fixes = [
  {
    sense_id: 10582,
    lang: "en",
    term: "alternative character",
    reading: null,
    reading_system: null,
    pronunciation: "/ɔːlˈtɝːnətɪv ˈkærəktər/",
    pronunciation_system: "IPA",
    definition: "An alternative written form of the Chinese character 札."
  },
  {
    sense_id: 5591,
    lang: "ja",
    term: "誰を",
    reading: "だれを",
    reading_system: "kana",
    pronunciation: null,
    pronunciation_system: null,
    definition: "英語の who の目的格を表す代名詞。"
  },
  {
    sense_id: 5937,
    lang: "ja",
    term: "〜にもかかわらず",
    reading: "にもかかわらず",
    reading_system: "kana",
    pronunciation: null,
    pronunciation_system: null,
    definition: "逆接や譲歩を表し、「〜ではあるが」という意味を表す接続表現。"
  },
  {
    sense_id: 5938,
    lang: "ja",
    term: "〜だけれども",
    reading: "だけれども",
    reading_system: "kana",
    pronunciation: null,
    pronunciation_system: null,
    definition: "譲歩や対比を表す接続表現。"
  },
  {
    sense_id: 9736,
    lang: "ja",
    term: "従事した",
    reading: "じゅうじした",
    reading_system: "kana",
    pronunciation: null,
    pronunciation_system: null,
    definition: "注意や労力を向けている、または何かに関与している状態。"
  },
  {
    sense_id: 11354,
    lang: "ja",
    term: "プッシー",
    reading: "ぷっしー",
    reading_system: "kana",
    pronunciation: null,
    pronunciation_system: null,
    definition: "女性器を指す卑語、または猫を指す俗語。"
  },
  {
    sense_id: 12918,
    lang: "ja",
    term: "エーアイアイ",
    reading: "えーあいあい",
    reading_system: "kana",
    pronunciation: null,
    pronunciation_system: null,
    definition: "AII という略語。国際機関名や画像平均強度などを指す。"
  },
  {
    sense_id: 13899,
    lang: "ja",
    term: "ジャンク船",
    reading: "じゃんくせん",
    reading_system: "kana",
    pronunciation: null,
    pronunciation_system: null,
    definition: "高い船尾とラグセイルを備えた中国式の帆船。"
  },
  {
    sense_id: 1922,
    lang: "zh",
    term: "装饰菜",
    reading: "zhuāng shì cài",
    reading_system: "pinyin",
    pronunciation: null,
    pronunciation_system: null,
    definition: "用于装饰菜肴的配菜，尤指与生鱼片一起食用的装饰配菜。"
  },
  {
    sense_id: 14158,
    lang: "zh",
    term: "喝彩",
    reading: "hè cǎi",
    reading_system: "pinyin",
    pronunciation: null,
    pronunciation_system: null,
    definition: "表示赞赏、称赞或为表演叫好的感叹用语。"
  }
];

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 30000");

const statements = {
  findLocalization: db.prepare("SELECT id FROM product_localizations WHERE product_sense_id = ? AND lang = ?"),
  updateLocalization: db.prepare(`
    UPDATE product_localizations
    SET term = @term,
        reading = @reading,
        reading_system = @reading_system,
        pronunciation = @pronunciation,
        pronunciation_system = @pronunciation_system,
        definition = @definition,
        source = @source,
        confidence = 0.96,
        needs_review = 0
    WHERE product_sense_id = @sense_id
      AND lang = @lang
  `),
  insertLocalization: db.prepare(`
    INSERT INTO product_localizations
      (product_sense_id, lang, term, reading, reading_system, pronunciation, pronunciation_system, definition, source, confidence, needs_review)
    VALUES
      (@sense_id, @lang, @term, @reading, @reading_system, @pronunciation, @pronunciation_system, @definition, @source, 0.96, 0)
  `),
  markLatestJobsAccepted: db.prepare(`
    UPDATE product_llm_completion_jobs
    SET status = 'accepted',
        error = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE target_type = 'product_sense_localization'
      AND target_id = @sense_id
      AND lang = @lang
      AND status = 'needs_review'
      AND id IN (
        SELECT id
        FROM product_llm_completion_jobs
        WHERE target_type = 'product_sense_localization'
          AND target_id = @sense_id
          AND lang = @lang
          AND status = 'needs_review'
        ORDER BY id DESC
        LIMIT 3
      )
  `),
  completedCleanLangCount: db.prepare(`
    SELECT COUNT(DISTINCT lang) AS count
    FROM product_localizations
    WHERE product_sense_id = ?
      AND needs_review = 0
  `),
  reviewLocalizationCount: db.prepare(`
    SELECT COUNT(*) AS count
    FROM product_localizations
    WHERE product_sense_id = ?
      AND needs_review = 1
  `),
  markSenseAccepted: db.prepare(`
    UPDATE product_senses
    SET status = 'accepted'
    WHERE id = ?
      AND status IN ('ready_for_llm', 'needs_review', 'draft_fused', 'draft_single_source')
  `),
  senseEntry: db.prepare("SELECT product_entry_id FROM product_senses WHERE id = ?"),
  entryStatusCounts: db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM product_senses
    WHERE product_entry_id = ?
    GROUP BY status
  `),
  setEntryStatus: db.prepare("UPDATE product_entries SET status = ? WHERE id = ?")
};

const stats = {
  db: path.relative(process.cwd(), dbPath),
  dry_run: dryRun,
  fixes: fixes.length,
  inserted: 0,
  updated: 0,
  jobs_marked_accepted: 0,
  senses_marked_accepted: 0,
  missing_localizations: []
};

if (!dryRun) {
  db.transaction(() => {
    for (const fix of fixes) applyFix(fix);
  })();
} else {
  for (const fix of fixes) {
    if (statements.findLocalization.get(fix.sense_id, fix.lang)) stats.updated++;
    else stats.inserted++;
  }
}

console.log(JSON.stringify(stats, null, 2));
db.close();

function applyFix(fix) {
  const payload = { ...fix, source };
  if (statements.findLocalization.get(fix.sense_id, fix.lang)) {
    statements.updateLocalization.run(payload);
    stats.updated++;
  } else {
    statements.insertLocalization.run(payload);
    stats.inserted++;
  }
  const jobResult = statements.markLatestJobsAccepted.run(fix);
  stats.jobs_marked_accepted += jobResult.changes;
  if (
    statements.completedCleanLangCount.get(fix.sense_id).count >= 4 &&
    statements.reviewLocalizationCount.get(fix.sense_id).count === 0
  ) {
    const result = statements.markSenseAccepted.run(fix.sense_id);
    stats.senses_marked_accepted += result.changes;
    const entry = statements.senseEntry.get(fix.sense_id);
    if (entry) updateEntryStatus(entry.product_entry_id);
  }
}

function updateEntryStatus(productEntryId) {
  const statuses = statements.entryStatusCounts.all(productEntryId);
  const total = statuses.reduce((sum, row) => sum + Number(row.count), 0);
  const accepted = statuses.find((row) => row.status === "accepted")?.count || 0;
  if (accepted === total) statements.setEntryStatus.run("accepted", productEntryId);
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
