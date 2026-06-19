import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || "data/processed/linguago_v2_product_top5000_freedict_filtered_release_20260619.db");

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath, { readonly: true });
db.pragma("busy_timeout = 30000");

const failures = [];

checkHello();
checkNihao();
checkZhong();
checkHako();

db.close();

const result = {
  ok: failures.length === 0,
  db: path.relative(process.cwd(), dbPath),
  failures
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;

function checkHello() {
  const row = db
    .prepare(
      `
      SELECT pl.pronunciation, pl.pronunciation_system, pl.definition
      FROM product_entries pe
      JOIN product_senses ps ON ps.product_entry_id = pe.id
      JOIN product_localizations pl ON pl.product_sense_id = ps.id
      WHERE pe.headword = 'hello'
        AND pe.primary_lang = 'en'
        AND pl.lang = 'en'
      ORDER BY ps.sense_order
      LIMIT 1
    `
    )
    .get();
  expect(row?.pronunciation === "/həˈloʊ/", "hello.en.pronunciation", row);
  expect(row?.pronunciation_system === "IPA", "hello.en.pronunciation_system", row);
  expect(
    row?.definition === "Used as a greeting or to begin a telephone conversation.",
    "hello.en.definition",
    row
  );
}

function checkNihao() {
  const row = db
    .prepare(
      `
      SELECT pl.reading, pl.definition
      FROM product_entries pe
      JOIN product_senses ps ON ps.product_entry_id = pe.id
      JOIN product_localizations pl ON pl.product_sense_id = ps.id
      WHERE pe.headword = '你好'
        AND pe.primary_lang = 'zh'
        AND pl.lang = 'zh'
      ORDER BY ps.sense_order
      LIMIT 1
    `
    )
    .get();
  expect(row?.reading === "nǐ hǎo", "nihao.zh.reading", row);
  expect(row?.definition === "用于问候或开始电话对话的致意语。", "nihao.zh.definition", row);
  expect(!/[於]/u.test(row?.definition || ""), "nihao.zh.definition_simplified", row);
}

function checkZhong() {
  const rows = db
    .prepare(
      `
      SELECT ps.id, ps.gloss_key, zh.reading, en.term
      FROM product_entries pe
      JOIN product_senses ps ON ps.product_entry_id = pe.id
      JOIN product_localizations zh ON zh.product_sense_id = ps.id AND zh.lang = 'zh'
      JOIN product_localizations en ON en.product_sense_id = ps.id AND en.lang = 'en'
      WHERE pe.headword = '中'
        AND pe.primary_lang = 'zh'
      ORDER BY zh.reading, ps.sense_order, ps.id
    `
    )
    .all();
  const byReading = new Map();
  for (const row of rows) {
    const key = pinyinKey(row.reading);
    byReading.set(key, (byReading.get(key) || 0) + 1);
  }
  expect(byReading.get("zhong1") === 3, "zhong.zhong1_sense_count", rows);
  expect(byReading.get("zhong4") === 2, "zhong.zhong4_sense_count", rows);
  expect(rows.some((row) => row.term === "hit; strike"), "zhong.zhong4_hit_sense", rows);
  expect(rows.some((row) => row.term === "win; be selected"), "zhong.zhong4_win_sense", rows);
}

function checkHako() {
  const rows = db
    .prepare(
      `
      SELECT ps.id, ps.gloss_key, pl.lang, pl.term, pl.definition
      FROM product_entries pe
      JOIN product_senses ps ON ps.product_entry_id = pe.id
      JOIN product_localizations pl ON pl.product_sense_id = ps.id
      WHERE pe.headword = '箱'
        AND pe.primary_lang = 'ja'
      ORDER BY ps.sense_order, pl.lang
    `
    )
    .all();
  const senseIds = new Set(rows.map((row) => row.id));
  expect(senseIds.size === 1, "hako.single_sense", rows);
  expect(rows.some((row) => row.lang === "pt-BR" && row.term === "caixa"), "hako.pt_caixa", rows);
}

function expect(condition, code, details) {
  if (condition) return;
  failures.push({ code, details });
}

function pinyinKey(value) {
  return String(value || "")
    .trim()
    .split(/\s+/g)
    .map((syllable) => {
      let tone = "";
      const plain = syllable
        .normalize("NFD")
        .replace(/[\u0304\u0301\u030c\u0300]/gu, (mark) => {
          if (mark === "\u0304") tone ||= "1";
          if (mark === "\u0301") tone ||= "2";
          if (mark === "\u030c") tone ||= "3";
          if (mark === "\u0300") tone ||= "4";
          return "";
        })
        .normalize("NFC")
        .toLowerCase();
      return `${plain}${tone}`;
    })
    .join(" ");
}

function parseArgs(argv) {
  const output = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    output[key] = next && !next.startsWith("--") ? next : "1";
    if (next && !next.startsWith("--")) i++;
  }
  return output;
}
