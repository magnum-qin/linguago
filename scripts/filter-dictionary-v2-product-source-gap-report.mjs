import fs from "node:fs";
import path from "node:path";

const LANGS = ["en", "pt-BR", "zh", "ja"];
const DEFAULT_IN = "logs/product-incomplete-gap-senses-after-unsloth-5000-20260623.json";
const DEFAULT_OUT = "logs/product-incomplete-gap-senses-clean-20260623.json";
const FUNCTION_GLOSSES = new Set([
  "a",
  "an",
  "the",
  "of",
  "to",
  "in",
  "on",
  "at",
  "for",
  "from",
  "by",
  "with",
  "and",
  "or",
  "but",
  "if",
  "as",
  "this",
  "that",
  "these",
  "those",
  "my",
  "your",
  "his",
  "her",
  "their",
  "our",
  "its",
  "neither",
  "all",
  "one",
  "two"
]);

const args = parseArgs(process.argv.slice(2));
const inPath = path.resolve(args.in || DEFAULT_IN);
const outPath = path.resolve(args.out || DEFAULT_OUT);
const limit = args.limit ? Number(args.limit) : 0;
const keepRisky = args["keep-risky"] === "true";
const sampleLimit = Number(args["sample-limit"] || 50);

if (!fs.existsSync(inPath)) throw new Error(`Input report not found: ${inPath}`);
if (limit && (!Number.isInteger(limit) || limit < 1)) throw new Error(`Invalid --limit: ${args.limit}`);

const report = JSON.parse(fs.readFileSync(inPath, "utf8"));
const selected = Array.isArray(report.selected) ? report.selected : [];
const accepted = [];
const rejected = [];

for (const row of selected) {
  const reasons = rejectReasons(row);
  if (reasons.length) {
    rejected.push({
      source_entry_id: row?.source_entry_id,
      word: row?.word,
      source_lang: row?.source_lang,
      frequency_rank: row?.frequency_rank,
      reasons
    });
    continue;
  }
  accepted.push(row);
  if (limit && accepted.length >= limit) break;
}

const summary = {
  input: path.relative(process.cwd(), inPath),
  output: path.relative(process.cwd(), outPath),
  source_selected: selected.length,
  clean_selected: accepted.length,
  rejected_scanned: rejected.length,
  limit: limit || null,
  keep_risky: keepRisky,
  rejected_by_reason: countReasons(rejected),
  clean_by_lang: countBy(accepted.map((row) => row.source_lang)),
  clean_top_frequency_rank: accepted[0]?.frequency_rank ?? null,
  clean_last_frequency_rank: accepted.at(-1)?.frequency_rank ?? null
};

const out = {
  ...report,
  ok: true,
  generated_at: new Date().toISOString(),
  source_report: path.relative(process.cwd(), inPath),
  summary: {
    ...(report.summary || {}),
    clean_filter: summary
  },
  selected_count: accepted.length,
  selected: accepted,
  rejected_preview: rejected.slice(0, sampleLimit),
  next_step: "Run supplement-dictionary-v2-product-source-gaps-unsloth.mjs against this clean report."
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary }, null, 2));

function rejectReasons(row) {
  const reasons = [];
  const word = String(row?.word || "").trim();
  const normalizedKey = String(row?.normalized_key || "").trim();
  const sourceLang = row?.source_lang;
  const gloss = String(row?.first_gloss_key || row?.first_gloss_preview || "").trim();

  if (!LANGS.includes(sourceLang)) reasons.push("invalid_source_lang");
  if (!word) reasons.push("empty_word");
  if (row?.repairable_from_same_entry) reasons.push("deterministic_repair_available");
  if (row?.entry_level_four_lang_available) reasons.push("entry_level_four_lang_available");
  if (!gloss) reasons.push("missing_gloss");

  if (hasBadEncoding(word, sourceLang) || hasBadEncoding(normalizedKey, sourceLang)) reasons.push("source_mojibake");
  if (sourceLang && !sourceScriptOk(word, sourceLang)) reasons.push("source_script_mismatch");
  if (gloss && hasBadEncoding(gloss, "en")) reasons.push("gloss_mojibake");
  if (gloss && glossTooThin(gloss)) reasons.push("thin_gloss");

  for (const sense of row?.useful_senses || []) {
    if (hasBadEncoding(sense?.gloss_key, "en")) reasons.push("sense_gloss_mojibake");
    for (const loc of sense?.localizations || []) {
      if (hasBadEncoding(loc?.term, loc?.lang) || hasBadEncoding(loc?.definition, loc?.lang)) {
        reasons.push("localization_mojibake");
      }
    }
  }

  const risk = riskReason(row);
  if (risk && !keepRisky) reasons.push(risk);

  return [...new Set(reasons)];
}

function riskReason(row) {
  const word = String(row?.word || "").trim();
  const gloss = String(row?.first_gloss_key || row?.first_gloss_preview || "").normalize("NFKC").trim().toLowerCase();
  const latinOnly = /^[\p{Script=Latin}\s.'’-]+$/u.test(word);
  if (row?.source_lang === "en" && /^[A-Za-z]$/u.test(word)) return "latin_single_letter";
  if (row?.source_lang === "en" && /^[A-Z]{2,}$/u.test(word)) return "latin_acronym";
  if (latinOnly && normalizeLatinLetters(word).length <= 2) return "very_short_latin";
  if (/\b(letter of the roman alphabet|blood group|radioactive|unit used in printing)\b/u.test(gloss)) {
    return "encyclopedic_or_symbol_gloss";
  }
  if (/\bsurname\b/u.test(gloss)) return "surname_gloss";
  if (/^boa$/u.test(gloss) || normalize(word) === normalize(gloss)) return "gloss_repeats_word";
  if (/\b(one's|possessive|demonstrative)\b/u.test(gloss)) return "possessive_or_demonstrative";
  if (row?.source_lang === "pt-BR" && FUNCTION_GLOSSES.has(gloss)) return "pt_function_word";
  if ((row?.source_lang === "zh" || row?.source_lang === "ja") && word.length === 1 && FUNCTION_GLOSSES.has(gloss)) {
    return "single_cjk_function_word";
  }
  return "";
}

function sourceScriptOk(word, lang) {
  const text = String(word || "").trim();
  if (!text) return false;
  const hasLatin = /\p{Script=Latin}/u.test(text);
  const hasHan = /\p{Script=Han}/u.test(text);
  const hasHiragana = /\p{Script=Hiragana}/u.test(text);
  const hasKatakana = /\p{Script=Katakana}/u.test(text);
  const hasKana = hasHiragana || hasKatakana || /[\u30fc\uff70]/u.test(text);
  if (lang === "zh") return hasHan && !hasKana;
  if (lang === "ja") return hasHan || hasKana;
  if (lang === "en" || lang === "pt-BR") return !hasHan && !hasKana && hasLatin;
  return true;
}

function hasBadEncoding(value, lang) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/[\uFFFD]/u.test(text)) return true;
  if (/[�]/u.test(text)) return true;
  if (/(?:\u00c3[\u0080-\u00bf]|\u00c2[\u0080-\u00bf]|\u00e2[\u0080-\u00bf]{1,2})/u.test(text)) return true;
  if (/[\u9287\u9288\u9289][\u3040-\u30ff\u4e00-\u9fff]?/u.test(text)) return true;
  if (/[鈥锟铆茅脿冒蓹浣妗绗瑭]/u.test(text)) return true;
  if (/[\u9300-\u9fff][\u3040-\u30ff][\u9300-\u9fff]/u.test(text)) return true;
  if (lang === "zh" && /[銉銇銈]/u.test(text)) return true;
  if (lang === "ja" && /[鍔鍑鍟鍏鐩璇璐浜澹鏄鏉姝讳]/u.test(text)) return true;
  return false;
}

function glossTooThin(value) {
  const text = String(value || "").normalize("NFKC").trim().toLowerCase();
  if (text.length < 3) return true;
  return FUNCTION_GLOSSES.has(text);
}

function normalize(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase();
}

function normalizeLatinLetters(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/gu, "");
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function countReasons(rows) {
  const counts = {};
  for (const row of rows) {
    for (const reason of row.reasons) counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const keyName = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) result[keyName] = "true";
    else {
      result[keyName] = next;
      index++;
    }
  }
  return result;
}
