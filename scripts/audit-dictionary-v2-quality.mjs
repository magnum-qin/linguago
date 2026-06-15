import Database from "better-sqlite3";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_sample.db";
const LANGS = ["en", "zh", "ja", "pt-BR"];

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const source = args.source || "ollama:qwen3.6:latest";
const limit = Number(args.limit || 200);
const failLimit = Number(args["fail-limit"] || 50);

const db = new Database(dbPath, { readonly: true });

const rows = db
  .prepare(
    `
    SELECT
      sl.id,
      sl.sense_id,
      e.word,
      e.source_lang,
      s.gloss_key,
      sl.lang,
      sl.term,
      sl.reading,
      sl.reading_system,
      sl.pronunciation,
      sl.pronunciation_system,
      sl.definition
    FROM sense_localizations sl
    JOIN senses s ON s.id = sl.sense_id
    JOIN entries e ON e.id = s.entry_id
    WHERE sl.source = ?
    ORDER BY sl.id DESC
    LIMIT ?
  `
  )
  .all(source, limit);

const examples = db
  .prepare(
    `
    SELECT el.id, el.example_id, el.lang, el.text, ex.sense_id
    FROM example_localizations el
    JOIN examples ex ON ex.id = el.example_id
    WHERE el.source = ?
    ORDER BY el.id DESC
    LIMIT ?
  `
  )
  .all(source, limit);

db.close();

const issues = [];
for (const row of rows) {
  issues.push(...auditLocalization(row));
}
for (const row of examples) {
  if (!LANGS.includes(row.lang)) {
    issues.push(issue("example_localization", row.id, "invalid_lang", `invalid example lang: ${row.lang}`, row));
  }
  if (!nonEmpty(row.text)) {
    issues.push(issue("example_localization", row.id, "empty_text", "empty example text", row));
  }
}

const byCode = countBy(issues, "code");
const byLang = countBy(issues, "lang");
const failSamples = issues.slice(0, failLimit);

console.log(
  JSON.stringify(
    {
      ok: issues.length === 0,
      db: path.relative(process.cwd(), dbPath),
      source,
      checked: {
        sense_localizations: rows.length,
        example_localizations: examples.length
      },
      issue_count: issues.length,
      by_code: byCode,
      by_lang: byLang,
      samples: failSamples
    },
    null,
    2
  )
);

function auditLocalization(row) {
  const result = [];
  const lang = row.lang;
  if (!LANGS.includes(lang)) result.push(issue("sense_localization", row.id, "invalid_lang", "invalid lang", row));
  if (!nonEmpty(row.term)) result.push(issue("sense_localization", row.id, "empty_term", "empty term", row));
  if (!nonEmpty(row.definition)) {
    result.push(issue("sense_localization", row.id, "empty_definition", "empty definition", row));
  }

  if (lang === "zh") {
    if (!containsCjk(row.definition)) result.push(issue("sense_localization", row.id, "wrong_definition_script", "zh definition has no CJK", row));
    if (!looksLikePinyin(row.reading)) result.push(issue("sense_localization", row.id, "bad_reading", "zh reading does not look like pinyin", row));
  }
  if (lang === "ja") {
    if (!containsJapanese(row.definition)) result.push(issue("sense_localization", row.id, "wrong_definition_script", "ja definition has no Japanese script", row));
    if (!containsKana(row.reading)) result.push(issue("sense_localization", row.id, "bad_reading", "ja reading has no kana", row));
  }
  if (lang === "en") {
    if (!containsLatin(row.definition)) result.push(issue("sense_localization", row.id, "wrong_definition_script", "en definition has no Latin text", row));
    if (!nonEmpty(row.pronunciation)) result.push(issue("sense_localization", row.id, "bad_pronunciation", "en pronunciation is empty", row));
  }
  if (lang === "pt-BR") {
    if (!containsLatin(row.definition)) result.push(issue("sense_localization", row.id, "wrong_definition_script", "pt-BR definition has no Latin text", row));
    if (!nonEmpty(row.pronunciation)) result.push(issue("sense_localization", row.id, "bad_pronunciation", "pt-BR pronunciation is empty", row));
  }

  return result;
}

function issue(entity_type, id, code, message, row) {
  return {
    entity_type,
    id,
    code,
    lang: row.lang || null,
    message,
    word: row.word || null,
    term: row.term || null,
    reading: row.reading || null,
    pronunciation: row.pronunciation || null
  };
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row[key] || "unknown";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function containsCjk(value) {
  return /[\u3400-\u9fff]/u.test(String(value || ""));
}

function containsKana(value) {
  return /[\u3040-\u30ff]/u.test(String(value || ""));
}

function containsJapanese(value) {
  return /[\u3040-\u30ff\u3400-\u9fff]/u.test(String(value || ""));
}

function containsLatin(value) {
  return /[A-Za-zÀ-ÖØ-öø-ÿ]/u.test(String(value || ""));
}

function looksLikePinyin(value) {
  const text = String(value || "").trim();
  return Boolean(text) && /[a-züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/iu.test(text);
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const next = argv[i + 1];
    result[arg.slice(2)] = next && !next.startsWith("--") ? next : "true";
    if (next && !next.startsWith("--")) i++;
  }
  return result;
}
