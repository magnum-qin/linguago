import Database from "better-sqlite3";
import path from "node:path";
import { performance } from "node:perf_hooks";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_fused_only_pilot.db";
const DEFAULT_ENDPOINT = "http://100.99.99.99:11441";
const DEFAULT_PROVIDER = "ollama";
const DEFAULT_MODEL = "qwen3.6:latest";
const DEFAULT_PROMPT_VERSION = "dictionary-v2-product-localization-v1";

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const endpoint = String(args.endpoint || process.env.OLLAMA_HOST || DEFAULT_ENDPOINT).replace(/\/$/, "");
const provider = args.provider || DEFAULT_PROVIDER;
const model = args.model || process.env.OLLAMA_MODEL || DEFAULT_MODEL;
const promptVersion = args["prompt-version"] || DEFAULT_PROMPT_VERSION;
const limit = Number(args.limit || 10);
const timeoutMs = Number(args["timeout-ms"] || args.timeout || 180_000);
const prewarmTimeoutMs = Number(args["prewarm-timeout-ms"] || 180_000);
const maxTokens = Number(args["max-tokens"] || 900);
const streamResponse = args.stream === "true";
const dryRun = args["dry-run"] === "true";
const prewarm = args.prewarm !== "false";
const retryNeedsReview = args["retry-needs-review"] === "true";
const quiet = args.quiet === "true";
const jobIdMin = args["job-id-min"] ? Number(args["job-id-min"]) : 0;
const jobIdMax = args["job-id-max"] ? Number(args["job-id-max"]) : 0;
const targetLangs = String(args["target-langs"] || "")
  .split(",")
  .map((lang) => lang.trim())
  .filter(Boolean);
const targetLangClause = targetLangs.length ? `AND lang IN (${targetLangs.map(() => "?").join(", ")})` : "";
const jobIdMinClause = jobIdMin ? "AND id >= ?" : "";
const jobIdMaxClause = jobIdMax ? "AND id <= ?" : "";
if (jobIdMin && (!Number.isInteger(jobIdMin) || jobIdMin < 1)) throw new Error(`Invalid --job-id-min: ${args["job-id-min"]}`);
if (jobIdMax && (!Number.isInteger(jobIdMax) || jobIdMax < 1)) throw new Error(`Invalid --job-id-max: ${args["job-id-max"]}`);
if (jobIdMin && jobIdMax && jobIdMin > jobIdMax) throw new Error(`Invalid job id range: ${jobIdMin} > ${jobIdMax}`);

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 10000");

const statements = {
  queuedJobs: db.prepare(`
    SELECT id, target_id, lang, input_json
    FROM product_llm_completion_jobs
    WHERE target_type = 'product_sense_localization'
      AND provider = ?
      AND model = ?
      AND prompt_version = ?
      AND status IN (${retryNeedsReview ? "'queued', 'needs_review'" : "'queued'"})
      ${targetLangClause}
      ${jobIdMinClause}
      ${jobIdMaxClause}
    ORDER BY id
    LIMIT ?
  `),
  markRunning: db.prepare(`
    UPDATE product_llm_completion_jobs
    SET status = 'running', error = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status IN ('queued', 'needs_review')
  `),
  markDone: db.prepare(`
    UPDATE product_llm_completion_jobs
    SET status = ?, output_json = ?, error = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),
  localizationExists: db.prepare(`
    SELECT id FROM product_localizations WHERE product_sense_id = ? AND lang = ?
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
        confidence = @confidence,
        needs_review = @needs_review
    WHERE product_sense_id = @product_sense_id
      AND lang = @lang
  `),
  insertLocalization: db.prepare(`
    INSERT INTO product_localizations
      (product_sense_id, lang, term, reading, reading_system, pronunciation, pronunciation_system,
       definition, source, confidence, needs_review)
    VALUES
      (@product_sense_id, @lang, @term, @reading, @reading_system, @pronunciation, @pronunciation_system,
       @definition, @source, @confidence, @needs_review)
  `),
  exampleExists: db.prepare(`
    SELECT id FROM product_examples WHERE id = ? AND product_sense_id = ?
  `),
  exampleLocalizationExists: db.prepare(`
    SELECT id FROM product_example_localizations WHERE product_example_id = ? AND lang = ?
  `),
  insertExampleLocalization: db.prepare(`
    INSERT INTO product_example_localizations
      (product_example_id, lang, text, reading, source, confidence, needs_review)
    VALUES
      (@product_example_id, @lang, @text, @reading, @source, @confidence, @needs_review)
  `),
  completedLangCount: db.prepare(`
    SELECT COUNT(DISTINCT lang) AS count
    FROM product_localizations
    WHERE product_sense_id = ?
  `),
  reviewLocalizationCount: db.prepare(`
    SELECT COUNT(*) AS count
    FROM product_localizations
    WHERE product_sense_id = ?
      AND needs_review = 1
  `),
  senseEntry: db.prepare(`
    SELECT product_entry_id
    FROM product_senses
    WHERE id = ?
  `),
  markSenseAccepted: db.prepare(`
    UPDATE product_senses
    SET status = 'accepted'
    WHERE id = ? AND status IN ('ready_for_llm', 'needs_review', 'draft_fused', 'draft_single_source')
  `),
  entryStatusCounts: db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM product_senses
    WHERE product_entry_id = ?
    GROUP BY status
  `),
  setEntryStatus: db.prepare(`
    UPDATE product_entries
    SET status = ?
    WHERE id = ?
  `)
};

const jobQueryParams = [provider, model, promptVersion, ...targetLangs];
if (jobIdMin) jobQueryParams.push(jobIdMin);
if (jobIdMax) jobQueryParams.push(jobIdMax);
jobQueryParams.push(limit);
const jobs = statements.queuedJobs.all(...jobQueryParams);

console.log(`DB: ${path.relative(process.cwd(), dbPath)}`);
console.log(`Ollama endpoint: ${endpoint}`);
console.log(`Model: ${model}`);
console.log(`Queued jobs selected: ${jobs.length}`);
console.log(`Job id range: ${jobIdMin || "-"}..${jobIdMax || "-"}`);
console.log(`Dry run: ${dryRun}`);
console.log(`Stream response: ${streamResponse}`);
console.log(`Target langs: ${targetLangs.length ? targetLangs.join(",") : "all"}`);

if (prewarm && jobs.length) {
  const result = await prewarmModel();
  console.log(
    `[prewarm] ok=${result.ok} seconds=${result.seconds} load_seconds=${result.load_seconds ?? "n/a"}${
      result.error ? ` error=${result.error}` : ""
    }`
  );
}

const stats = {
  selected: jobs.length,
  accepted: 0,
  needs_review: 0,
  failed: 0,
  skipped_claimed: 0,
  dry_run: dryRun
};

for (const job of jobs) {
  const input = JSON.parse(job.input_json);
  const started = performance.now();

  if (!dryRun) {
    const claim = statements.markRunning.run(job.id);
    if (claim.changes === 0) {
      stats.skipped_claimed++;
      if (!quiet) console.log(`[skipped] job=${job.id} already claimed`);
      continue;
    }
  }

  try {
    const envelope = await callOllama(input);
    const seconds = Number(((performance.now() - started) / 1000).toFixed(2));
    const content = envelope?.message?.content || envelope?.response || "";
    const output = parseJson(content);
    const validation = validateOutput(output, input);
    const status = validation.errors.length ? "needs_review" : "accepted";

    if (!dryRun && status === "accepted") applyAcceptedJob({ job, output });
    if (!dryRun) {
      statements.markDone.run(status, JSON.stringify(output, null, 2), validation.errors.join("; ") || null, job.id);
    }

    stats[status]++;
    if (!quiet) {
      console.log(
        `[${status}] job=${job.id} sense=${job.target_id} lang=${job.lang} entry=${input.product_entry?.headword} seconds=${seconds} score=${validation.score}/${validation.max_score}`
      );
      if (validation.errors.length) console.log(`  errors: ${validation.errors.join("; ")}`);
    }
  } catch (error) {
    stats.failed++;
    const cause = error.cause?.code || error.cause?.message;
    const message = `${error.name || "Error"}: ${error.message || String(error)}${cause ? ` (${cause})` : ""}`;
    if (!dryRun) statements.markDone.run("failed", null, message, job.id);
    if (!quiet) console.log(`[failed] job=${job.id} sense=${job.target_id} lang=${job.lang}: ${message}`);
  }
}

const summary = {
  ok: true,
  db: path.relative(process.cwd(), dbPath),
  endpoint,
  provider,
  model,
  prompt_version: promptVersion,
  stats,
  remaining_queued: db
    .prepare(
      `
      SELECT lang, COUNT(*) AS count
      FROM product_llm_completion_jobs
      WHERE target_type = 'product_sense_localization'
        AND provider = ?
        AND model = ?
        AND prompt_version = ?
        AND status = 'queued'
      GROUP BY lang
      ORDER BY lang
    `
    )
    .all(provider, model, promptVersion)
};

db.close();
console.log(JSON.stringify(summary, null, 2));

function applyAcceptedJob({ job, output }) {
  const loc = output.sense_localization;
  const input = JSON.parse(job.input_json);
  const currentLocalization = input.current_localization || {};
  const preserveTerm = input.requirements?.preserve_current_term === true;
  const preserveDefinition = input.requirements?.preserve_current_definition === true;
  const preserveReading = input.requirements?.preserve_current_reading === true || preserveTerm || preserveDefinition;
  const localizationPayload = {
    product_sense_id: job.target_id,
    lang: job.lang,
    term: preserveTerm ? cleanText(currentLocalization.term) : cleanText(loc.term),
    reading: preserveReading ? cleanNullable(currentLocalization.reading) : cleanNullable(loc.reading),
    reading_system: preserveReading ? cleanNullable(currentLocalization.reading_system) : cleanNullable(loc.reading_system),
    pronunciation: cleanNullable(loc.pronunciation),
    pronunciation_system: cleanNullable(loc.pronunciation_system),
    definition: preserveDefinition ? cleanText(currentLocalization.definition) : cleanText(loc.definition),
    source: `${provider}:${model}`,
    confidence: 0.78,
    needs_review: 0
  };
  if (statements.localizationExists.get(job.target_id, job.lang)) {
    statements.updateLocalization.run(localizationPayload);
  } else {
    statements.insertLocalization.run(localizationPayload);
  }

  for (const example of output.example_localizations || []) {
    const exampleId = Number(example.example_id);
    if (!Number.isInteger(exampleId)) continue;
    if (!statements.exampleExists.get(exampleId, job.target_id)) continue;
    if (statements.exampleLocalizationExists.get(exampleId, job.lang)) continue;
    statements.insertExampleLocalization.run({
      product_example_id: exampleId,
      lang: job.lang,
      text: cleanText(example.text),
      reading: cleanNullable(example.reading),
      source: `${provider}:${model}`,
      confidence: 0.72,
      needs_review: 0
    });
  }

  if (
    statements.completedLangCount.get(job.target_id).count >= 4 &&
    statements.reviewLocalizationCount.get(job.target_id).count === 0
  ) {
    statements.markSenseAccepted.run(job.target_id);
    const entry = statements.senseEntry.get(job.target_id);
    if (entry) updateEntryStatus(entry.product_entry_id);
  }
}

function updateEntryStatus(productEntryId) {
  const statuses = statements.entryStatusCounts.all(productEntryId);
  const total = statuses.reduce((sum, row) => sum + Number(row.count), 0);
  const accepted = statuses.find((row) => row.status === "accepted")?.count || 0;
  if (accepted === total) statements.setEntryStatus.run("accepted", productEntryId);
}

async function prewarmModel() {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), prewarmTimeoutMs);
  try {
    const response = await fetch(`${endpoint}/api/generate`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        keep_alive: "20m",
        prompt: "Return only OK.",
        options: { temperature: 0, num_predict: 2 }
      })
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    const envelope = JSON.parse(text);
    return {
      ok: true,
      seconds: Number(((performance.now() - started) / 1000).toFixed(2)),
      load_seconds: envelope.load_duration ? Number((envelope.load_duration / 1_000_000_000).toFixed(2)) : null
    };
  } catch (error) {
    return {
      ok: false,
      seconds: Number(((performance.now() - started) / 1000).toFixed(2)),
      error: `${error.name || "Error"}: ${error.message || String(error)}`
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callOllama(input) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${endpoint}/api/chat`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: streamResponse,
        think: false,
        keep_alive: "20m",
        format: outputSchema(input.target_lang),
        messages: [
          {
            role: "system",
            content:
              input.task === "repair_product_sense_localization_quality_warning"
                ? "You repair one dictionary localization. Return valid JSON only. Do not explain."
                : [
                    "You complete one product dictionary localization.",
                    "Return JSON only and complete only the requested target language.",
                    "Keep the exact product sense. Do not merge senses and do not invent another sense.",
                    "When source_links has exactly one row, treat that source_word as the anchor for this sense, even when it differs from product_entry.headword after a split.",
                    "If target language equals the only source_link language, sense_localization.term must exactly be that source_word.",
                    "For split function words, particles, short words, or one-character source words, translate the source_word and product_sense.gloss_key together; do not translate the old product_entry.headword.",
                    "The sense_localization.term must be a natural dictionary headword in the target language, not the source word copied from source_links.",
                    "For en and pt-BR, term must not contain Chinese characters, Japanese kana, or parenthesized source-word notes.",
                    "For zh, term must be simplified Chinese when possible and must not contain Japanese kana.",
                    "For ja, term must be natural Japanese and may use kana/kanji.",
                    "Use source_links as evidence, but write a natural product dictionary entry.",
                    "For zh, reading must be pinyin and definition must be Chinese.",
                    "For ja, reading must be kana and definition must be Japanese.",
                    "For en, pronunciation must be IPA or readable English pronunciation.",
                    "For pt-BR, pronunciation must be Brazilian Portuguese IPA or readable pronunciation.",
                    "If examples are absent, return an empty example_localizations array."
                  ].join(" ")
          },
          { role: "user", content: buildPrompt(input) }
        ],
        options: {
          temperature: 0,
          top_p: 0.8,
          num_ctx: input.task === "repair_product_sense_localization_quality_warning" ? 2048 : 4096,
          num_predict:
            input.task === "repair_product_sense_localization_quality_warning"
              ? Math.min(maxTokens, 420)
              : maxTokens
        }
      })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    if (streamResponse) return await readOllamaChatStream(response);
    const text = await response.text();
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function readOllamaChatStream(response) {
  const reader = response.body?.getReader();
  if (!reader) return JSON.parse(await response.text());

  const decoder = new TextDecoder();
  const envelope = { message: { role: "assistant", content: "" } };
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) consumeOllamaStreamLine(line, envelope);
  }

  buffer += decoder.decode();
  if (buffer.trim()) consumeOllamaStreamLine(buffer, envelope);
  return envelope;
}

function consumeOllamaStreamLine(line, envelope) {
  const trimmed = line.trim();
  if (!trimmed) return;
  const chunk = JSON.parse(trimmed);
  if (chunk.message?.content) {
    envelope.message.content += chunk.message.content;
  }
  if (chunk.message?.thinking) {
    envelope.message.thinking = `${envelope.message.thinking || ""}${chunk.message.thinking}`;
  }
  if (chunk.response) {
    envelope.response = `${envelope.response || ""}${chunk.response}`;
  }
  if (chunk.done) {
    envelope.done = true;
    envelope.done_reason = chunk.done_reason;
  }
}

function buildPrompt(input) {
  if (input.task === "repair_product_sense_localization_quality_warning") {
    const current = input.issue || {};
    const known = input.known_localizations?.[input.target_lang] || {};
    const entry = input.product_entry || {};
    const sense = input.product_sense || {};
    const targetRule =
      input.target_lang === "zh"
        ? "Use Simplified Chinese. The term must contain Chinese characters, must not contain Japanese kana, and must not be a Latin-script source word. Use pinyin reading."
        : input.target_lang === "ja"
          ? "Use natural Japanese. The term must contain kana or kanji and must not be a plain Latin-script English/Portuguese source word unless it is an official acronym or proper name. Use kana reading."
          : input.target_lang === "pt-BR"
            ? "Use natural Brazilian Portuguese. The term must not contain Chinese or Japanese characters. Include a matching Portuguese pronunciation."
            : "Use the target language naturally. Include a matching pronunciation.";
    const readingValue =
      input.target_lang === "zh" || input.target_lang === "ja" ? '"..."' : "null";
    const readingSystemValue =
      input.target_lang === "zh" ? '"pinyin"' : input.target_lang === "ja" ? '"kana"' : "null";
    const pronunciationValue =
      input.target_lang === "en" || input.target_lang === "pt-BR" ? '"..."' : "null";
    const pronunciationSystemValue =
      input.target_lang === "en" || input.target_lang === "pt-BR" ? '"IPA"' : "null";

    return `Repair one dictionary localization.
Target language: ${input.target_lang}
Rule: ${targetRule}
The current term/definition below is bad output to repair. Do not copy an English current definition into zh or ja.
Translate the meaning into the target language's definition field. The definition must be a short dictionary explanation written in the target language.
If the validation error says "term language looks suspicious", treat Current bad term as invalid and do not reuse it unchanged.
If the current term is already a good target-language term, keep the term and only fix the reading or definition.
Entry headword: ${entry.headword}
Entry language: ${entry.primary_lang}
Part of speech: ${sense.part_of_speech || ""}
Sense gloss: ${sense.gloss_key}
Current bad term: ${current.current_term || known.term || ""}
Current reading: ${current.current_reading || known.reading || ""}
Current definition: ${current.current_definition || known.definition || ""}
Validation error to fix: ${current.validation_error || current.code || ""}
Specific instruction: ${current.instruction || ""}

Return exactly this JSON shape:
{
  "sense_localization": {
    "lang": "${input.target_lang}",
    "term": "...",
    "reading": ${readingValue},
    "reading_system": ${readingSystemValue},
    "pronunciation": ${pronunciationValue},
    "pronunciation_system": ${pronunciationSystemValue},
    "definition": "..."
  },
  "example_localizations": []
}`;
  }

  return `Complete this product dictionary localization job.

Target language: ${input.target_lang}

Input:
${JSON.stringify({ ...input, expected_output_schema: outputSchema(input.target_lang) }, null, 2)}

Return JSON only.`;
}

function outputSchema(lang) {
  const required = ["lang", "term", "definition"];
  const readingSchema = { type: ["string", "null"] };
  const readingSystemSchema = { type: ["string", "null"] };
  const pronunciationSchema = { type: ["string", "null"] };
  const pronunciationSystemSchema = { type: ["string", "null"] };

  if (lang === "zh" || lang === "ja") {
    required.push("reading", "reading_system");
    readingSchema.type = "string";
    readingSchema.minLength = 1;
    readingSystemSchema.type = "string";
    readingSystemSchema.minLength = 1;
  }
  if (lang === "en" || lang === "pt-BR") {
    required.push("pronunciation", "pronunciation_system");
    pronunciationSchema.type = "string";
    pronunciationSchema.minLength = 1;
    pronunciationSystemSchema.type = "string";
    pronunciationSystemSchema.minLength = 1;
  }

  return {
    type: "object",
    required: ["sense_localization", "example_localizations"],
    properties: {
      sense_localization: {
        type: "object",
        required,
        properties: {
          lang: { const: lang },
          term: { type: "string", minLength: 1 },
          reading: readingSchema,
          reading_system: readingSystemSchema,
          pronunciation: pronunciationSchema,
          pronunciation_system: pronunciationSystemSchema,
          definition: { type: "string", minLength: 1 },
          usage_note: { type: ["string", "null"] }
        }
      },
      example_localizations: {
        type: "array",
        items: {
          type: "object",
          required: ["example_id", "lang", "text"],
          properties: {
            example_id: { type: "number" },
            lang: { const: lang },
            text: { type: "string", minLength: 1 },
            reading: { type: ["string", "null"] }
          }
        }
      }
    }
  };
}

function validateOutput(output, input) {
  const errors = [];
  let score = 0;
  const maxScore = 8;
  const lang = input.target_lang;
  const loc = output?.sense_localization;

  if (loc && typeof loc === "object") score++;
  else errors.push("missing sense_localization object");
  if (loc?.lang === lang) score++;
  else errors.push(`lang must be ${lang}`);
  if (nonEmpty(loc?.term)) score++;
  else errors.push("missing term");
  if (!termLanguageLooksRight(loc?.term, lang)) errors.push("term language looks suspicious");
  if (nonEmpty(loc?.definition)) score++;
  else errors.push("missing definition");

  if (lang === "zh" || lang === "ja") {
    if (readingLooksRight(loc?.reading, lang)) score++;
    else errors.push(lang === "zh" ? "reading must look like pinyin" : "reading must contain kana");
  } else if (nonEmpty(loc?.pronunciation)) score++;
  else errors.push("missing pronunciation");

  if (definitionLanguageLooksRight(loc?.definition, lang)) score++;
  else errors.push("definition language looks suspicious");

  for (const error of deterministicQualityErrors(loc, input)) errors.push(error);

  if (Array.isArray(output?.example_localizations)) score++;
  else errors.push("missing example_localizations array");

  const knownExampleIds = new Set((input.examples || []).map((example) => Number(example.id)));
  for (const example of output?.example_localizations || []) {
    if (example.lang !== lang) errors.push(`example ${example.example_id} lang must be ${lang}`);
    if (!knownExampleIds.has(Number(example.example_id))) errors.push(`unknown example_id: ${example.example_id}`);
    if (!nonEmpty(example.text)) errors.push(`empty example text: ${example.example_id}`);
  }
  if (!errors.some((error) => error.startsWith("example"))) score++;

  return { score, max_score: maxScore, errors };
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

function cleanText(value) {
  return String(value || "").trim();
}

function cleanNullable(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function readingLooksRight(value, lang) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (lang === "zh") return /[\p{Script=Latin}\u0300-\u036f0-9üÜêÊńŃňŇḿḾ]/u.test(text) && !/[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
  if (lang === "ja") return /[\u3040-\u30ff]/u.test(text);
  return true;
}

function termLanguageLooksRight(value, lang) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (lang === "zh") return /[\u3400-\u9fff]/u.test(text) && !/[\u3040-\u30ff]/u.test(text);
  if (lang === "ja") return /[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
  if (lang === "pt-BR") return /[\p{Script=Latin}]/u.test(text) && !/[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
  if (lang === "en") return /[A-Za-z]/u.test(text) && !/[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
  return false;
}

function definitionLanguageLooksRight(value, lang) {
  const text = String(value || "");
  if (lang === "zh") return /[\u3400-\u9fff]/u.test(text);
  if (lang === "ja") return /[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
  if (lang === "pt-BR") return /[\p{Script=Latin}]/u.test(text);
  if (lang === "en") return /[A-Za-z]/u.test(text);
  return false;
}

function deterministicQualityErrors(loc, input) {
  const errors = [];
  if (!loc || typeof loc !== "object") return errors;

  const lang = input.target_lang;
  const sourceLinks = Array.isArray(input.source_links) ? input.source_links : [];
  const soleSource = sourceLinks.length === 1 ? sourceLinks[0] : null;
  const term = String(loc.term || "").trim();
  const currentLocalization = input.current_localization || {};

  if (input.requirements?.preserve_current_term === true) {
    const currentTerm = String(currentLocalization.term || "").trim();
    if (currentTerm && normalizeLoose(term) !== normalizeLoose(currentTerm)) {
      errors.push("term must match current localization for pronunciation-only repair");
    }
  }

  if (input.requirements?.preserve_current_definition === true) {
    const currentDefinition = String(currentLocalization.definition || "").trim();
    const definition = String(loc.definition || "").trim();
    if (currentDefinition && normalizeLoose(definition) !== normalizeLoose(currentDefinition)) {
      errors.push("definition must match current localization for pronunciation-only repair");
    }
  }

  if (soleSource?.source_lang === lang && normalizeLoose(term) !== normalizeLoose(soleSource.source_word)) {
    errors.push("term must match sole source_word when target language is the source language");
  }

  if (lang === "pt-BR" && looksLikeShortLatinTerm(term) && nonEmpty(loc.pronunciation)) {
    const termLetters = normalizeLatinLetters(term);
    const pronunciationLetters = normalizeLatinLetters(loc.pronunciation);
    if (termLetters.length <= 3 && pronunciationLetters && !sharesAnyLetter(termLetters, pronunciationLetters)) {
      errors.push("pt-BR pronunciation looks unrelated to short term");
    }
  }

  if ((lang === "zh" || lang === "ja") && nonEmpty(loc.pronunciation)) {
    errors.push("zh/ja localizations should use reading, not pronunciation");
  }

  if (hasGenericSplitGloss(input.product_sense?.gloss_key)) {
    errors.push("generic split gloss is insufficient for automatic localization");
  }

  return errors;
}

function hasGenericSplitGloss(value) {
  const text = String(value || "").trim().toLowerCase();
  return /^group\s+for\b/u.test(text) || /^split\s+group\b/u.test(text);
}

function looksLikeShortLatinTerm(value) {
  const text = String(value || "").trim();
  return /^[\p{Script=Latin}\s'’-]{1,12}$/u.test(text) && normalizeLatinLetters(text).length <= 3;
}

function sharesAnyLetter(left, right) {
  return [...new Set(left)].some((letter) => right.includes(letter));
}

function normalizeLoose(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase();
}

function normalizeLatinLetters(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/gu, "");
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
