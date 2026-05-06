import fs from "node:fs";
import path from "node:path";

const INPUT = path.resolve("data/processed/candidate_terms.jsonl");
const OUT_DIR = path.resolve("data/processed");
const SCORED_FILE = path.join(OUT_DIR, "candidate_terms.scored.jsonl");
const BATCH_FILE = path.join(OUT_DIR, "generation_batch_120.txt");
const REPORT_FILE = path.join(OUT_DIR, "generation-batch-report.json");
const BATCH_PER_LANG = Number(process.env.BATCH_PER_LANG || 30);

const rows = fs
  .readFileSync(INPUT, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const scored = rows
  .map((row) => ({ ...row, priority_score: score(row), score_reasons: reasons(row) }))
  .filter((row) => row.priority_score >= 45)
  .sort((a, b) => b.priority_score - a.priority_score || a.headword.length - b.headword.length);

const batch = [];
const seenTerms = new Set();
for (const lang of ["zh", "en", "pt-BR", "ja"]) {
  const selected = [];
  for (const row of scored.filter((item) => item.source_lang === lang)) {
    const crossKey = row.normalized_headword.toLocaleLowerCase();
    if (seenTerms.has(crossKey)) continue;
    seenTerms.add(crossKey);
    selected.push(row);
    batch.push(row);
    if (selected.length >= BATCH_PER_LANG) break;
  }
}

fs.writeFileSync(SCORED_FILE, scored.map((row) => JSON.stringify(row)).join("\n") + "\n");
fs.writeFileSync(BATCH_FILE, batch.map((row) => row.headword).join("\n") + "\n");

const report = {
  generated_at: new Date().toISOString(),
  input_count: rows.length,
  scored_count: scored.length,
  batch_file: path.relative(process.cwd(), BATCH_FILE),
  batch_count: batch.length,
  batch_per_lang: countBy(batch, "source_lang"),
  scored_per_lang: countBy(scored, "source_lang"),
  top_samples: Object.fromEntries(
    ["zh", "en", "pt-BR", "ja"].map((lang) => [
      lang,
      scored
        .filter((row) => row.source_lang === lang)
        .slice(0, 10)
        .map(({ headword, priority_score, score_reasons }) => ({ headword, priority_score, score_reasons }))
    ])
  )
};

fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);

console.log(`[done] scored=${scored.length}/${rows.length}`);
console.log(`[done] batch=${batch.length}`);
console.log(`[done] wrote ${path.relative(process.cwd(), BATCH_FILE)}`);
console.log(`[done] wrote ${path.relative(process.cwd(), REPORT_FILE)}`);

function score(row) {
  const text = row.headword;
  let value = 100;

  if (hasDigit(text)) value -= 30;
  if (isProperNameLike(row)) value -= 25;
  if (isPhrase(row)) value -= 20;
  if (isTooShortForFirstBatch(row)) value -= 30;
  if (text.length <= 1 && row.source_lang !== "zh" && row.source_lang !== "ja") value -= 20;
  if (text.length > 10 && (row.source_lang === "zh" || row.source_lang === "ja")) value -= 15;
  if (text.length > 18 && (row.source_lang === "en" || row.source_lang === "pt-BR")) value -= 15;
  if (hasOddPunctuation(text)) value -= 25;
  if (looksTechnical(row)) value -= 15;
  if (hasUsefulHint(row)) value += 10;
  if (isCommonShape(row)) value += 8;
  if (isIdealFirstBatchShape(row)) value += 18;

  return Math.max(0, Math.min(100, value));
}

function reasons(row) {
  const out = [];
  if (hasDigit(row.headword)) out.push("has_digit");
  if (isProperNameLike(row)) out.push("proper_name_like");
  if (isPhrase(row)) out.push("phrase");
  if (isTooShortForFirstBatch(row)) out.push("too_short_for_first_batch");
  if (hasOddPunctuation(row.headword)) out.push("odd_punctuation");
  if (looksTechnical(row)) out.push("technical_or_domain");
  if (hasUsefulHint(row)) out.push("has_source_hint");
  if (isCommonShape(row)) out.push("common_shape");
  if (isIdealFirstBatchShape(row)) out.push("ideal_first_batch_shape");
  return out;
}

function hasDigit(text) {
  return /\d|[０-９]/.test(text);
}

function isPhrase(row) {
  const text = row.headword.trim();
  if (row.source_lang === "en" || row.source_lang === "pt-BR") return text.split(/\s+/).length > 2;
  return /[・、，,。.!?？]/.test(text) || [...text].length > 8;
}

function isProperNameLike(row) {
  const text = row.headword.trim();
  if (row.source_lang === "en" || row.source_lang === "pt-BR") {
    return /^[A-Z][a-z]+$/.test(text);
  }
  const def = String(row.hints?.en?.definition || row.source_ref?.glosses?.join("; ") || "");
  return /\b(name|surname|given name|place name|person|city|province|county)\b/i.test(def);
}

function hasOddPunctuation(text) {
  return /[_/@#%&*=+()[\]{}<>]|^[^\p{L}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u.test(text);
}

function looksTechnical(row) {
  const haystack = JSON.stringify(row.source_ref || {}).toLowerCase();
  return /\b(botany|zoology|chemistry|physics|medicine|law|computing|anime|manga|slang|archaic|obsolete)\b/.test(haystack);
}

function isTooShortForFirstBatch(row) {
  const text = row.headword.trim();
  if (row.source_lang === "zh") return /^[\u3400-\u9fff]$/u.test(text);
  if (row.source_lang === "ja") return /^[\u3400-\u9fff\u3041-\u3096\u30a1-\u30faー]$/u.test(text);
  if (row.source_lang === "en") return /^[a-z]{1,2}$/i.test(text);
  if (row.source_lang === "pt-BR") return /^[\p{Script=Latin}]{1,2}$/u.test(text);
  return false;
}

function hasUsefulHint(row) {
  const hints = row.hints || {};
  return Boolean(
    hints.en?.definition ||
      hints.zh?.phonetic ||
      hints.ja?.phonetic ||
      hints["pt-BR"]?.word ||
      hints.en?.word
  );
}

function isCommonShape(row) {
  const text = row.headword.trim();
  if (row.source_lang === "zh") return /^[\u3400-\u9fff]{1,4}$/u.test(text);
  if (row.source_lang === "ja") return /^[\u3400-\u9fff\u3041-\u3096\u30a1-\u30faー]{1,6}$/u.test(text);
  if (row.source_lang === "en") return /^[a-z]{2,12}$/i.test(text);
  if (row.source_lang === "pt-BR") return /^[\p{Script=Latin}]{2,14}$/u.test(text);
  return false;
}

function isIdealFirstBatchShape(row) {
  const text = row.headword.trim();
  if (row.source_lang === "zh") return /^[\u3400-\u9fff]{2,4}$/u.test(text);
  if (row.source_lang === "ja") return /^[\u3400-\u9fff\u3041-\u3096\u30a1-\u30faー]{2,6}$/u.test(text) && !hasDigit(text);
  if (row.source_lang === "en") return /^[a-z]{3,10}$/i.test(text);
  if (row.source_lang === "pt-BR") return /^[\p{Script=Latin}]{3,12}$/u.test(text);
  return false;
}

function countBy(items, field) {
  return items.reduce((acc, item) => {
    acc[item[field]] = (acc[item[field]] || 0) + 1;
    return acc;
  }, {});
}
