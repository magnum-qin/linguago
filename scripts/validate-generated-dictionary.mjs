import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const INPUT = path.resolve(process.argv[2] || "output/ollama-dictionary-test.jsonl");
const OUT_DIR = path.resolve("data/processed");
const prefix = process.argv[3] || "generated_dictionary";
const ACCEPTED_OUT = path.join(OUT_DIR, `${prefix}.accepted.jsonl`);
const REVIEW_OUT = path.join(OUT_DIR, `${prefix}.needs_review.jsonl`);
const REPORT_OUT = path.join(OUT_DIR, `${prefix}.validation-report.json`);
const LANGS = ["zh", "en", "pt-BR", "ja"];

fs.mkdirSync(OUT_DIR, { recursive: true });

const lines = fs.existsSync(INPUT) ? fs.readFileSync(INPUT, "utf8").split(/\r?\n/).filter(Boolean) : [];
const accepted = [];
const needsReview = [];

for (const [index, line] of lines.entries()) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    needsReview.push(reviewRow({ line: index + 1, errors: [`invalid JSONL row: ${error.message}`], raw: line }));
    continue;
  }

  const entry = parsed.entry || parsed.result?.entry || parsed;
  const { errors, warnings } = validateEntry(entry);
  const row = {
    source_line: index + 1,
    term: parsed.term || entry?.source_text || "",
    normalized_term: normalize(parsed.term || entry?.normalized_text || entry?.source_text || ""),
    raw_hash: hash(JSON.stringify(entry)),
    quality_score: score(errors, warnings),
    validation_errors: errors,
    validation_warnings: warnings,
    entry
  };

  if (errors.length || warnings.length >= 3 || row.quality_score < 80) {
    needsReview.push(row);
  } else {
    accepted.push(row);
  }
}

fs.writeFileSync(ACCEPTED_OUT, accepted.map((row) => JSON.stringify(row)).join("\n") + (accepted.length ? "\n" : ""));
fs.writeFileSync(REVIEW_OUT, needsReview.map((row) => JSON.stringify(row)).join("\n") + (needsReview.length ? "\n" : ""));

const report = {
  generated_at: new Date().toISOString(),
  input_file: path.relative(process.cwd(), INPUT),
  accepted_file: path.relative(process.cwd(), ACCEPTED_OUT),
  needs_review_file: path.relative(process.cwd(), REVIEW_OUT),
  total: lines.length,
  accepted: accepted.length,
  needs_review: needsReview.length,
  top_warnings: countMessages(needsReview.flatMap((row) => row.validation_warnings || [])),
  top_errors: countMessages(needsReview.flatMap((row) => row.validation_errors || []))
};

fs.writeFileSync(REPORT_OUT, `${JSON.stringify(report, null, 2)}\n`);

console.log(`[done] total=${lines.length} accepted=${accepted.length} needs_review=${needsReview.length}`);
console.log(`[done] wrote ${path.relative(process.cwd(), ACCEPTED_OUT)}`);
console.log(`[done] wrote ${path.relative(process.cwd(), REVIEW_OUT)}`);
console.log(`[done] wrote ${path.relative(process.cwd(), REPORT_OUT)}`);

function validateEntry(entry) {
  const errors = [];
  const warnings = [];

  if (!entry || typeof entry !== "object") {
    return { errors: ["entry is missing or not an object"], warnings };
  }

  if (entry.type !== "word") errors.push("entry.type must be word for dictionary prefill");
  requireText(errors, entry.source_text, "source_text");
  requireText(errors, entry.normalized_text, "normalized_text");

  for (const lang of LANGS) {
    const translation = entry.translations?.[lang];
    requireText(errors, translation?.text, `translations.${lang}.text`);

    const detail = entry.word_details?.[lang];
    requireText(errors, detail?.word, `word_details.${lang}.word`);
    requireText(errors, detail?.definition, `word_details.${lang}.definition`);

    const langWarnings = validateLocalizedLanguage(lang, {
      translation: translation?.text || "",
      definition: detail?.definition || "",
      example: entry.examples?.[0]?.translations?.[lang] || "",
      explanation: entry.explanations?.[lang] || ""
    });
    warnings.push(...langWarnings);

    if (translation?.audio_text && looksLikeWrongAudioText(translation.audio_text, translation.text, lang)) {
      warnings.push(`suspicious audio_text for ${lang}`);
    }
  }

  if (!Array.isArray(entry.examples) || !entry.examples.length) {
    errors.push("examples must contain at least one example");
  } else {
    const example = entry.examples[0];
    requireText(errors, example?.sentence, "examples.0.sentence");
    for (const lang of LANGS) {
      requireText(errors, example?.translations?.[lang], `examples.0.translations.${lang}`);
    }
  }

  validateSenses(entry, errors, warnings);

  for (const lang of LANGS) {
    requireText(warnings, entry.explanations?.[lang], `explanations.${lang}`);
  }

  return { errors, warnings };
}

function validateSenses(entry, errors, warnings) {
  if (!Array.isArray(entry.senses) || !entry.senses.length) {
    warnings.push("missing senses array; legacy single-sense import will be used");
    return;
  }

  const seenOrders = new Set();
  for (const [index, sense] of entry.senses.entries()) {
    const order = Number(sense?.sense_order || sense?.order || index + 1);
    if (!Number.isFinite(order) || order < 1) {
      errors.push(`invalid sense_order: senses.${index}`);
      continue;
    }
    if (seenOrders.has(order)) {
      errors.push(`duplicate sense_order: ${order}`);
    }
    seenOrders.add(order);

    requireText(warnings, sense?.gloss_key || sense?.key, `senses.${index}.gloss_key`);
    for (const lang of LANGS) {
      const definition =
        sense?.definitions?.[lang] ||
        sense?.word_details?.[lang]?.definition ||
        (order === 1 ? entry.word_details?.[lang]?.definition : "");
      requireText(errors, definition, `senses.${index}.definitions.${lang}`);
    }
  }
}

function requireText(messages, value, name) {
  if (typeof value !== "string" || !value.trim()) messages.push(`missing text: ${name}`);
}

function looksLikeWrongAudioText(audioText, translatedText, lang) {
  const audio = normalize(audioText);
  const text = normalize(translatedText);
  if (!audio || !text) return false;
  if (lang === "zh") return /^[a-z\s'-]+$/i.test(audio) && /[\u3400-\u9fff]/u.test(text) && !hasPinyinTone(audioText);
  if (lang === "ja") return /^[a-z\s'-]+$/i.test(audio) && /[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
  if (lang === "pt-BR") return audio === "the" || audio === "to" || audio === "and";
  return false;
}

function validateLocalizedLanguage(lang, fields) {
  const warnings = [];
  const joined = Object.values(fields).join(" ");

  if (looksLikeMojibake(joined)) {
    warnings.push(`suspected mojibake for ${lang}`);
  }

  if (lang === "zh" && fields.definition && !/[\u3400-\u9fff]/u.test(fields.definition)) {
    warnings.push("zh definition appears non-Chinese");
  }

  if (lang === "ja" && fields.definition && !/[\u3040-\u30ff]/u.test(fields.definition)) {
    warnings.push("ja definition appears non-Japanese");
  }

  if (lang === "pt-BR" && fields.definition && !looksPortugueseLike(fields.definition)) {
    warnings.push("pt-BR definition appears non-Portuguese");
  }

  return warnings;
}

function looksLikeMojibake(text) {
  return /[�]|(?:杩|銇|鈥|锚|茅|脿|冒蓹|浣|妗|绗|瑭)/.test(text);
}

function looksPortugueseLike(text) {
  return (
    /[áàâãéêíóôõúç]/iu.test(text) ||
    /\b(o|a|os|as|de|do|da|que|para|em|um|uma|usado|usada|indica|pronome|preposi[cç][aã]o|conjun[cç][aã]o|substantivo|verbo|significa)\b/i.test(
      text
    )
  );
}

function hasPinyinTone(text) {
  return /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/i.test(text);
}

function score(errors, warnings) {
  return Math.max(0, 100 - errors.length * 25 - warnings.length * 7);
}

function normalize(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase();
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function reviewRow(row) {
  return {
    ...row,
    term: "",
    normalized_term: "",
    raw_hash: hash(String(row.raw || "")),
    quality_score: 0,
    validation_warnings: row.warnings || [],
    validation_errors: row.errors || []
  };
}

function countMessages(messages) {
  return Object.fromEntries(
    Object.entries(
      messages.reduce((acc, message) => {
        acc[message] = (acc[message] || 0) + 1;
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1])
  );
}
