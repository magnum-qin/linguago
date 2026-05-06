import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const OLLAMA_HOST = (process.env.OLLAMA_HOST || "http://192.168.2.152:11434").replace(/\/$/, "");
const MODEL = process.env.OLLAMA_MODEL || "qwen3.6:27b";
const OUT_DIR = path.resolve("output");
const LANGS = ["zh", "en", "pt-BR", "ja"];

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const current = process.argv[i];
  if (current.startsWith("--")) {
    const next = process.argv[i + 1];
    args.set(current.slice(2), next && !next.startsWith("--") ? next : "true");
    if (next && !next.startsWith("--")) i += 1;
  }
}

function readJobs() {
  if (args.has("candidates-file")) {
    return fs
      .readFileSync(path.resolve(args.get("candidates-file")), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const candidate = JSON.parse(line);
        return {
          term: String(candidate.headword || candidate.normalized_headword || "").trim(),
          candidate
        };
      })
      .filter((job) => job.term);
  }

  if (args.has("terms-file")) {
    return fs
      .readFileSync(path.resolve(args.get("terms-file")), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((term) => ({ term }));
  }

  if (args.has("term")) return [{ term: args.get("term") }];
  return [{ term: "hello" }, { term: "我爱你" }, { term: "ありがとう" }, { term: "saudade" }];
}

const limit = Number(args.get("limit") || 0);
const jobs = limit > 0 ? readJobs().slice(0, limit) : readJobs();
const maxRetries = Number(args.get("retries") || 2);
const timeoutMs = Number(args.get("timeout") || 180_000);
const maxTokens = Number(args.get("max-tokens") || 2600);
const wordOnly = args.get("word-only") === "true";
const OUT_FILE = path.resolve(args.get("out") || path.join(OUT_DIR, "ollama-dictionary-test.jsonl"));
const FAIL_FILE = path.resolve(args.get("fail-out") || path.join(OUT_DIR, "ollama-dictionary-test.failed.jsonl"));
const resetOutput = args.get("reset") === "true";
const resume = args.get("resume") !== "false";

const localizedTextSchema = {
  type: "object",
  properties: {
    text: { type: "string" },
    phonetic: { type: "string" },
    audio_text: { type: "string" }
  },
  required: ["text", "phonetic", "audio_text"]
};

const wordDetailSchema = {
  type: "object",
  properties: {
    word: { type: "string" },
    definition: { type: "string" }
  },
  required: ["word", "definition"]
};

const schema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["word", "sentence"] },
    source_text: { type: "string" },
    normalized_text: { type: "string" },
    translations: {
      type: "object",
      properties: {
        zh: localizedTextSchema,
        en: localizedTextSchema,
        "pt-BR": localizedTextSchema,
        ja: localizedTextSchema
      },
      required: LANGS
    },
    word_details: {
      type: "object",
      properties: Object.fromEntries(LANGS.map((lang) => [lang, wordDetailSchema])),
      required: LANGS
    },
    senses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sense_order: { type: "number" },
          part_of_speech: { type: "string" },
          gloss_key: { type: "string" },
          register_label: { type: "string" },
          domain_label: { type: "string" },
          confidence: { type: "number" },
          definitions: {
            type: "object",
            properties: Object.fromEntries(LANGS.map((lang) => [lang, { type: "string" }])),
            required: LANGS
          }
        },
        required: ["sense_order", "part_of_speech", "gloss_key", "definitions"]
      }
    },
    examples: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sense_order: { type: "number" },
          sentence: { type: "string" },
          translations: {
            type: "object",
            properties: Object.fromEntries(LANGS.map((lang) => [lang, { type: "string" }])),
            required: LANGS
          }
        },
        required: ["sense_order", "sentence", "translations"]
      }
    },
    explanations: {
      type: "object",
      properties: Object.fromEntries(LANGS.map((lang) => [lang, { type: "string" }])),
      required: LANGS
    }
  },
  required: ["type", "source_text", "normalized_text", "translations"]
};

const systemPrompt = `You generate production-ready multilingual dictionary data.
Return JSON only. The first character must be { and the last character must be }.
Use exactly these top-level keys when applicable: type, source_text, normalized_text, translations, word_details, senses, examples, explanations.
Never use alternative keys such as translation, detail, example_sentences, explanation_text, portuguese, jp, or japanese.
Do not add markdown, comments, or extra prose.
All required string fields must be non-empty.
translations must contain zh, en, pt-BR, ja. Each language must contain text, phonetic, audio_text.
For Chinese phonetic use pinyin. For Japanese phonetic use kana. For English use IPA or readable pronunciation. For pt-BR use Brazilian Portuguese pronunciation.
word_details.zh.definition must be written in Chinese. word_details.en.definition must be written in English. word_details["pt-BR"].definition must be written in Brazilian Portuguese. word_details.ja.definition must be written in Japanese.
audio_text must be pronounceable text for that same language, not the original source word unless it is also the translated word.
If the input is a single lexical word, type must be "word"; include word_details for zh, en, pt-BR, ja, include 1 to 4 common senses, and at least one example sentence containing the word or its natural translated equivalent.
For polysemous words, split common meanings into separate senses instead of merging them into one long definition.
If source dictionary facts are provided, treat them as evidence. Preserve their main meaning, reading, part of speech, and translation hints unless they are clearly malformed.
Do not copy source dictionary text blindly. Clean it, resolve mojibake if obvious, and make the final entry natural in all four languages.
For high-frequency single-character Chinese or Japanese entries, prefer the common daily function-word or particle sense when source variants include one.
Example sentences must sound natural in the source language and in all four translations. Avoid tautological examples such as "I study to study" unless the term itself requires that wording.
For purpose words such as "for", "to", or "para", use a concrete action and a distinct concrete purpose in examples, not near-synonym loops such as "study to learn".
Never use the exact sentence "Estudo para aprender." because its Chinese translation is unnatural for this dictionary.
If the input is a phrase or sentence, type must be "sentence"; include explanations for zh, en, pt-BR, ja.
The response must be valid JSON.`;

function userPrompt(job, previousErrors = []) {
  const feedback = previousErrors.length
    ? `\nPrevious output failed validation. Fix these exact issues:\n- ${previousErrors.join("\n- ")}`
    : "";
  const sourceFacts = job.candidate
    ? `\nSource dictionary facts and frequency metadata:\n${JSON.stringify(compactCandidate(job.candidate), null, 2)}\n`
    : "";

  return `Create one dictionary entry for: ${job.term}
${wordOnly ? 'This test is word-only. The entry type must be "word". Treat short greetings and common expressions as lexical dictionary items when possible.' : ""}
${sourceFacts}
Return this JSON shape:
{
  "type": "word",
  "source_text": "${job.term}",
  "normalized_text": "lowercase or canonical form",
  "translations": {
    "zh": {"text": "...", "phonetic": "...", "audio_text": "..."},
    "en": {"text": "...", "phonetic": "...", "audio_text": "..."},
    "pt-BR": {"text": "...", "phonetic": "...", "audio_text": "..."},
    "ja": {"text": "...", "phonetic": "...", "audio_text": "..."}
  },
  "word_details": {
    "zh": {"word": "...", "definition": "..."},
    "en": {"word": "...", "definition": "..."},
    "pt-BR": {"word": "...", "definition": "..."},
    "ja": {"word": "...", "definition": "..."}
  },
  "senses": [
    {
      "sense_order": 1,
      "part_of_speech": "noun|verb|adjective|adverb|pronoun|preposition|conjunction|particle|determiner|article|phrase|other",
      "gloss_key": "short English meaning label",
      "register_label": "",
      "domain_label": "",
      "confidence": 0.9,
      "definitions": {"zh": "...", "en": "...", "pt-BR": "...", "ja": "..."}
    }
  ],
  "examples": [
    {
      "sense_order": 1,
      "sentence": "...",
      "translations": {"zh": "...", "en": "...", "pt-BR": "...", "ja": "..."}
    }
  ],
  "explanations": {"zh": "...", "en": "...", "pt-BR": "...", "ja": "..."}
}
Return JSON only.${feedback}`;
}

function compactCandidate(candidate) {
  return {
    headword: candidate.headword,
    normalized_headword: candidate.normalized_headword,
    source_lang: candidate.source_lang,
    frequency_rank: candidate.frequency_rank,
    source_id: candidate.source_id,
    source_license: candidate.source_license,
    source_ref: candidate.source_ref,
    hints: candidate.hints
  };
}

async function callOllama(job, previousErrors) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();

  try {
    const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        think: false,
        format: schema,
        keep_alive: "30m",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt(job, previousErrors) }
        ],
        options: {
          temperature: 0,
          top_p: 0.8,
          num_ctx: 4096,
          num_predict: maxTokens
        }
      })
    });

    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);

    const envelope = JSON.parse(text);
    return {
      seconds: Number(((performance.now() - started) / 1000).toFixed(2)),
      envelope,
      content: envelope?.message?.content || envelope?.response || ""
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(content) {
  const trimmed = String(content || "").trim();
  if (!trimmed) throw new Error("empty model content");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("content is not JSON");
  }
}

function valueAt(object, dottedPath) {
  return dottedPath.split(".").reduce((value, key) => value?.[key], object);
}

function requireString(errors, object, dottedPath) {
  const value = valueAt(object, dottedPath);
  if (typeof value !== "string" || !value.trim()) errors.push(`missing non-empty string: ${dottedPath}`);
}

function validate(entry, term) {
  const errors = [];
  if (!["word", "sentence"].includes(entry.type)) errors.push("type must be word or sentence");
  if (wordOnly && entry.type !== "word") errors.push("word-only test requires type=word");

  requireString(errors, entry, "source_text");
  requireString(errors, entry, "normalized_text");
  for (const lang of LANGS) {
    requireString(errors, entry, `translations.${lang}.text`);
    requireString(errors, entry, `translations.${lang}.phonetic`);
    requireString(errors, entry, `translations.${lang}.audio_text`);
  }

  if (entry.type === "word") {
    for (const lang of LANGS) {
      requireString(errors, entry, `word_details.${lang}.word`);
      requireString(errors, entry, `word_details.${lang}.definition`);
    }
    if (!Array.isArray(entry.senses) || entry.senses.length < 1) {
      errors.push("word entries require at least one sense");
    } else {
      for (const [index, sense] of entry.senses.entries()) {
        if (!Number.isFinite(Number(sense.sense_order || index + 1))) {
          errors.push(`senses.${index}.sense_order must be numeric`);
        }
        requireString(errors, sense, "gloss_key");
        for (const lang of LANGS) requireString(errors, sense, `definitions.${lang}`);
      }
    }
    if (!Array.isArray(entry.examples) || entry.examples.length < 1) {
      errors.push("word entries require at least one example");
    } else {
      requireString(errors, entry, "examples.0.sentence");
      for (const lang of LANGS) requireString(errors, entry, `examples.0.translations.${lang}`);
    }
  }

  if (entry.source_text && !String(entry.source_text).includes(term) && entry.source_text !== term) {
    errors.push(`source_text changed unexpectedly: ${entry.source_text}`);
  }
  return errors;
}

async function runJob(job) {
  let previousErrors = [];
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    let result;
    try {
      result = await callOllama(job, previousErrors);
    } catch (error) {
      previousErrors = [`request failed: ${error.name || "Error"} ${error.message || String(error)}`];
      console.log(`[retry] ${job.term} attempt ${attempt}: ${previousErrors.join("; ")}`);
      continue;
    }

    let entry;
    try {
      entry = parseJson(result.content);
    } catch (error) {
      previousErrors = [error.message];
      console.log(`[retry] ${job.term} attempt ${attempt}: ${previousErrors.join("; ")}`);
      continue;
    }

    const errors = validate(entry, job.term);
    if (!errors.length) {
      return {
        ok: true,
        term: job.term,
        source_lang: job.candidate?.source_lang || null,
        source_id: job.candidate?.source_id || null,
        frequency_rank: job.candidate?.frequency_rank ?? null,
        attempt,
        seconds: result.seconds,
        entry
      };
    }

    previousErrors = errors;
    console.log(`[retry] ${job.term} attempt ${attempt}: ${errors.join("; ")}`);
  }
  return {
    ok: false,
    term: job.term,
    source_lang: job.candidate?.source_lang || null,
    source_id: job.candidate?.source_id || null,
    frequency_rank: job.candidate?.frequency_rank ?? null,
    errors: previousErrors
  };
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.mkdirSync(path.dirname(FAIL_FILE), { recursive: true });

const doneTerms = resume ? new Set(readExistingTerms(OUT_FILE)) : new Set();
const failedTerms = resume ? new Set(readExistingTerms(FAIL_FILE)) : new Set();

if (resetOutput) {
  fs.writeFileSync(OUT_FILE, "");
  fs.writeFileSync(FAIL_FILE, "");
  doneTerms.clear();
  failedTerms.clear();
}

const pendingJobs = jobs.filter((job) => !doneTerms.has(job.term) && !failedTerms.has(job.term));

console.log(`Ollama host: ${OLLAMA_HOST}`);
console.log(`Model: ${MODEL}`);
console.log(`Terms total: ${jobs.length}`);
console.log(`Pending terms: ${pendingJobs.length}`);
console.log(`Success file: ${OUT_FILE}`);
console.log(`Failed file: ${FAIL_FILE}`);

let passed = 0;
for (const job of pendingJobs) {
  const result = await runJob(job);
  const line = `${JSON.stringify(result)}\n`;
  if (result.ok) {
    passed += 1;
    fs.appendFileSync(OUT_FILE, line);
    console.log(`[ok] ${job.term} attempt=${result.attempt} seconds=${result.seconds}`);
  } else {
    fs.appendFileSync(FAIL_FILE, line);
    console.log(`[failed] ${job.term}: ${result.errors.join("; ")}`);
  }
}

console.log(`Done. passed=${passed}/${pendingJobs.length}`);
console.log(`Success file: ${OUT_FILE}`);
console.log(`Failed file: ${FAIL_FILE}`);

function readExistingTerms(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)?.term;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
