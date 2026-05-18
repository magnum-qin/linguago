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
  const { errors, warnings } = validateEntry(entry, parsed);
  const row = {
    source_line: index + 1,
    term: parsed.term || entry?.source_text || "",
    normalized_term: normalize(parsed.term || entry?.normalized_text || entry?.source_text || ""),
    source_lang: parsed.source_lang || null,
    source_id: parsed.source_id || null,
    frequency_rank: parsed.frequency_rank ?? null,
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

function validateEntry(entry, parsed = {}) {
  const errors = [];
  const warnings = [];

  if (!entry || typeof entry !== "object") {
    return { errors: ["entry is missing or not an object"], warnings };
  }

  if (entry.type !== "word") errors.push("entry.type must be word for dictionary prefill");
  requireText(errors, entry.source_text, "source_text");
  requireText(errors, entry.normalized_text, "normalized_text");
  validateSourceText(errors, warnings, entry, parsed);
  validateSourceLanguageFields(errors, entry, parsed);

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
  const seenGlosses = new Map();
  const seenDefinitions = Object.fromEntries(LANGS.map((lang) => [lang, new Map()]));
  const senseMeta = new Map();
  const duplicateDefinitionPairs = new Map();
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

    const gloss = normalize(sense?.gloss_key || sense?.key);
    const partOfSpeech = normalize(sense?.part_of_speech || "");
    senseMeta.set(order, { gloss, partOfSpeech });
    requireText(warnings, sense?.gloss_key || sense?.key, `senses.${index}.gloss_key`);
    if (gloss) {
      if (seenGlosses.has(gloss)) {
        const firstOrder = seenGlosses.get(gloss);
        const firstMeta = senseMeta.get(firstOrder);
        if (firstMeta?.partOfSpeech && firstMeta.partOfSpeech === partOfSpeech) {
          errors.push(`duplicate sense gloss_key: ${sense?.gloss_key || sense?.key}`);
        } else {
          warnings.push(`shared sense gloss_key across parts of speech: ${sense?.gloss_key || sense?.key}`);
        }
      }
      seenGlosses.set(gloss, order);
    }
    for (const lang of LANGS) {
      const definition =
        sense?.definitions?.[lang] ||
        sense?.word_details?.[lang]?.definition ||
        (order === 1 ? entry.word_details?.[lang]?.definition : "");
      requireText(errors, definition, `senses.${index}.definitions.${lang}`);
      const normalizedDefinition = normalizeDefinition(definition);
      if (normalizedDefinition) {
        if (seenDefinitions[lang].has(normalizedDefinition)) {
          const firstOrder = seenDefinitions[lang].get(normalizedDefinition);
          const key = [Number(firstOrder), order].sort((a, b) => a - b).join(":");
          const pair = duplicateDefinitionPairs.get(key) || {
            firstOrder: Number(firstOrder),
            secondOrder: order,
            languages: []
          };
          pair.languages.push(lang);
          duplicateDefinitionPairs.set(key, pair);
        }
        seenDefinitions[lang].set(normalizedDefinition, order);
      }
    }
  }

  for (const pair of duplicateDefinitionPairs.values()) {
    const firstMeta = senseMeta.get(pair.firstOrder);
    const secondMeta = senseMeta.get(pair.secondOrder);
    const samePartOfSpeech = firstMeta?.partOfSpeech && firstMeta.partOfSpeech === secondMeta?.partOfSpeech;
    if (samePartOfSpeech || pair.languages.length > 1) {
      errors.push(
        `duplicate sense definition at senses ${pair.firstOrder} and ${pair.secondOrder} for ${pair.languages.join(", ")}`
      );
    } else {
      warnings.push(
        `shared sense definition across parts of speech at senses ${pair.firstOrder} and ${pair.secondOrder} for ${pair.languages.join(", ")}`
      );
    }
  }
}

function validateSourceText(errors, warnings, entry, parsed) {
  const expected = normalize(parsed.term || "");
  if (!expected) return;

  const sourceText = normalize(entry.source_text);
  const normalizedText = normalize(entry.normalized_text);
  if (sourceText !== expected) {
    errors.push(`source_text drifted from requested term: expected ${parsed.term}, got ${entry.source_text}`);
  }
  if (normalizedText && normalizedText !== expected) {
    warnings.push(`normalized_text differs from requested term: expected ${parsed.term}, got ${entry.normalized_text}`);
  }
}

function validateSourceLanguageFields(errors, entry, parsed) {
  const sourceLang = parsed.source_lang;
  const expected = normalize(parsed.term || entry.source_text || "");
  if (!LANGS.includes(sourceLang) || !expected) return;

  const sourceTranslation = normalize(entry.translations?.[sourceLang]?.text);
  const sourceDetailWord = normalize(entry.word_details?.[sourceLang]?.word);
  if (sourceTranslation && sourceTranslation !== expected) {
    errors.push(
      `source-language translation drifted from requested term: expected ${parsed.term}, got ${entry.translations?.[sourceLang]?.text}`
    );
  }
  if (sourceDetailWord && sourceDetailWord !== expected) {
    errors.push(
      `source-language word_detail drifted from requested term: expected ${parsed.term}, got ${entry.word_details?.[sourceLang]?.word}`
    );
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

function normalizeDefinition(value) {
  return normalize(value)
    .replace(/[.,;:!?，。；：！？、\s]+/gu, " ")
    .trim();
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
