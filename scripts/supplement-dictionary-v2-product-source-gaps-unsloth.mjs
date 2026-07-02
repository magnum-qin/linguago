import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const LANGS = ["en", "pt-BR", "zh", "ja"];
const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";
const DEFAULT_REPORT = "logs/product-incomplete-gap-senses-after-repair-20260622.json";
const DEFAULT_ENDPOINTS = [
  "http://100.99.99.99:11441",
  "http://100.99.99.99:11444",
  "http://100.99.99.99:11448",
  "http://100.99.99.99:11447"
];
const DEFAULT_MODEL = "unsloth/Qwen3.6-35B-A3B-MTP-GGUF";
const SOURCE = "unsloth:source-gap-supplement-20260622";
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
const dbPath = path.resolve(args.db || DEFAULT_DB);
const reportPath = path.resolve(args.report || DEFAULT_REPORT);
const token = args.token || process.env.UNSLOTH_API_KEY;
const endpoints = String(args.endpoints || DEFAULT_ENDPOINTS.join(","))
  .split(",")
  .map((item) => item.trim().replace(/\/$/, ""))
  .filter(Boolean);
const model = args.model || DEFAULT_MODEL;
const sourceLangFilter = parseSourceLangFilter(args["source-langs"]);
const limit = Number(args.limit || 8);
const concurrency = Number(args.concurrency || Math.min(4, endpoints.length));
const batchSize = Number(args["batch-size"] || 1);
const endpointConcurrency = parseEndpointConcurrency(args["endpoint-concurrency"], endpoints);
const dryRun = args["dry-run"] === "true";
const apply = args.apply === "true" || args.apply === true;
const selectOnly = args["select-only"] === "true";
const includeRisky = args["include-risky"] === "true";
const prewarm = args.prewarm !== "false";
const quiet = args.quiet === "true";
const timeoutMs = Number(args["timeout-ms"] || 180_000);
const loadTimeoutMs = Number(args["load-timeout-ms"] || 300_000);
const maxTokens = args["max-tokens"] ? Number(args["max-tokens"]) : null;
const logGenerated = args["log-generated"] === "true";
const ggufVariant = args["gguf-variant"] || null;
const maxSeqLength = Number(args["max-seq-length"] || 8192);
const speculativeType = args["speculative-type"] || "mtp";
const loadIn4bit = args["load-in-4bit"] !== "false";
const residualMode = args["residual-mode"] === "true";
const promptMode = args["prompt-mode"] || "compact";
const publishable = args.publishable === "true";
const appliedEntryStatus = publishable ? "accepted" : "draft_single_source";
const appliedSenseStatus = publishable ? "accepted" : "draft_single_source";
const appliedLocalizationNeedsReview = publishable ? 0 : 1;
const outPath = path.resolve(args.out || `logs/product-source-gap-unsloth-${apply ? "apply" : "dry-run"}-20260622.json`);

if (!fs.existsSync(dbPath)) throw new Error(`Product DB not found: ${dbPath}`);
if (!fs.existsSync(reportPath)) throw new Error(`Gap report not found: ${reportPath}`);
if (!selectOnly && !token) throw new Error("Missing --token or UNSLOTH_API_KEY");
if (!endpoints.length) throw new Error("No endpoints configured");
if (!Number.isInteger(limit) || limit < 1) throw new Error(`Invalid --limit: ${args.limit}`);
if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error(`Invalid --concurrency: ${args.concurrency}`);
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 12) throw new Error(`Invalid --batch-size: ${args["batch-size"]}`);
if (maxTokens !== null && (!Number.isInteger(maxTokens) || maxTokens < 128)) {
  throw new Error(`Invalid --max-tokens: ${args["max-tokens"]}`);
}
if (!Number.isInteger(maxSeqLength) || maxSeqLength < 512) {
  throw new Error(`Invalid --max-seq-length: ${args["max-seq-length"]}`);
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const allRows = report.selected || report.residuals || [];
const eligibilityDb = new Database(dbPath, { readonly: true });
const existingCompleteSense = eligibilityDb.prepare(`
  SELECT ps.id
  FROM product_entries pe
  JOIN product_senses ps ON ps.product_entry_id = pe.id
  JOIN product_localizations pl ON pl.product_sense_id = ps.id
  WHERE pe.group_key = ?
    AND ps.gloss_key = ?
    AND ps.status = 'accepted'
    AND COALESCE(pl.needs_review, 0) = 0
  GROUP BY ps.id
  HAVING COUNT(DISTINCT pl.lang) = 4
  LIMIT 1
`);
const existingLinkedCompleteSense = eligibilityDb.prepare(`
  SELECT ps.id
  FROM product_sense_source_links link
  JOIN product_senses ps ON ps.id = link.product_sense_id
  JOIN product_localizations pl ON pl.product_sense_id = ps.id
  WHERE link.source_sense_id = ?
    AND ps.status = 'accepted'
    AND COALESCE(pl.needs_review, 0) = 0
  GROUP BY ps.id
  HAVING COUNT(DISTINCT pl.lang) = 4
  LIMIT 1
`);
const rejectedBeforeGeneration = [];
const selected = [];
for (const row of allRows) {
  if (sourceLangFilter && !sourceLangFilter.has(row?.source_lang)) continue;
  const eligibility = candidateEligibility(row);
  if (!eligibility.ok) {
    rejectedBeforeGeneration.push({
      source_entry_id: row?.source_entry_id,
      word: row?.word,
      source_lang: row?.source_lang,
      frequency_rank: row?.frequency_rank,
      reason: eligibility.reason
    });
    continue;
  }
  selected.push(row);
  if (selected.length >= limit) break;
}
eligibilityDb.close();

if (selectOnly) {
  const stats = {
    db: path.relative(process.cwd(), dbPath),
    report: path.relative(process.cwd(), reportPath),
    model,
    endpoints,
    source_langs: sourceLangFilter ? [...sourceLangFilter] : "all",
    select_only: true,
    limit,
    selected: selected.length,
    skipped_before_generation: rejectedBeforeGeneration.length,
    skipped_before_generation_by_reason: countBy(rejectedBeforeGeneration.map((row) => row.reason))
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        ok: true,
        generated_at: new Date().toISOString(),
        stats,
        selected_preview: selected.slice(0, 80).map((row) => ({
          source_entry_id: row.source_entry_id,
          word: row.word,
          source_lang: row.source_lang,
          frequency_rank: row.frequency_rank,
          gloss: row.gloss_preview || row.gloss_key,
          quality_bucket: row.quality_bucket || null
        })),
        skipped_preview: rejectedBeforeGeneration.slice(0, 80)
      },
      null,
      2
    ),
    "utf8"
  );
  console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), stats }, null, 2));
  process.exit(0);
}

const prewarmResults = prewarm ? await prewarmEndpoints() : [];

const generated = await runGenerationPool(selected);

const accepted = generated.filter((item) => item.valid).map((item) => item.output);
const stats = {
  db: path.relative(process.cwd(), dbPath),
  report: path.relative(process.cwd(), reportPath),
  model,
  endpoints,
  source_langs: sourceLangFilter ? [...sourceLangFilter] : "all",
  dry_run: dryRun,
  apply,
  include_risky: includeRisky,
  prewarm,
  quiet,
  concurrency,
  endpoint_concurrency: endpointConcurrency,
  batch_size: batchSize,
  max_tokens: maxTokens,
  gguf_variant: ggufVariant,
  max_seq_length: maxSeqLength,
  speculative_type: speculativeType,
  load_in_4bit: loadIn4bit,
  residual_mode: residualMode,
  prompt_mode: promptMode,
  publishable,
  applied_entry_status: appliedEntryStatus,
  applied_sense_status: appliedSenseStatus,
  applied_localization_needs_review: appliedLocalizationNeedsReview,
  log_generated: logGenerated,
  selected: selected.length,
  skipped_before_generation: rejectedBeforeGeneration.length,
  skipped_before_generation_by_reason: countBy(rejectedBeforeGeneration.map((row) => row.reason)),
  generated: generated.length,
  accepted: accepted.length,
  rejected: generated.length - accepted.length,
  entries_inserted: 0,
  entries_reused: 0,
  senses_inserted: 0,
  senses_reused: 0,
  localizations_upserted: 0,
  source_links_upserted: 0
};

if (apply && accepted.length && !dryRun) applyOutputs(accepted, stats);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      ok: stats.rejected === 0,
      generated_at: new Date().toISOString(),
      stats,
      prewarm_results: prewarmResults,
      skipped_preview: rejectedBeforeGeneration.slice(0, 80),
      generated: logGenerated ? generated : undefined,
      generated_preview: logGenerated ? undefined : generated.slice(0, 80).map(compactGeneratedItem),
      rejected: logGenerated ? undefined : generated.filter((item) => !item.valid).map(compactGeneratedItem)
    },
    null,
    2
  ),
  "utf8"
);
console.log(JSON.stringify({ ok: stats.rejected === 0, out: path.relative(process.cwd(), outPath), stats }, null, 2));

async function generateBatch(rows, endpoint) {
  const response = await fetch(`${endpoint}/v1/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0,
      max_tokens: maxTokens || Math.min(2600, 260 + rows.length * 520),
      enable_thinking: false,
      reasoning_effort: "none",
      messages: [
        {
          role: "system",
          content: "You create concise multilingual dictionary records. Return only strict JSON."
        },
        {
          role: "user",
          content: rows.length === 1 ? buildPrompt(rows[0]) : buildBatchPrompt(rows)
        }
      ]
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
  const envelope = JSON.parse(text);
  const output = parseJson(envelope?.choices?.[0]?.message?.content || "");
  if (rows.length === 1) return [output];
  const items = Array.isArray(output) ? output : output?.items;
  if (!Array.isArray(items)) throw new Error("batch content missing items array");
  return rows.map((row, index) => {
    const byId = items.find((item) => String(item?.source_entry_id || "") === String(row.source_entry_id));
    return byId || items[index] || null;
  });
}

async function runGenerationPool(rows) {
  const results = new Array(rows.length);
  const batches = chunkRows(rows, batchSize);
  let cursor = 0;
  const workerSlots = buildWorkerSlots(rows.length, batches.length);
  const workers = workerSlots.map(async (endpoint, workerIndex) => {
    while (cursor < batches.length) {
      const index = cursor++;
      const batch = batches[index];
      const batchResults = await generateOneBatch(batch, endpoint, workerIndex);
      for (let itemIndex = 0; itemIndex < batch.length; itemIndex++) {
        results[batch[itemIndex].__selected_index] = batchResults[itemIndex];
      }
    }
  });
  await Promise.all(workers);
  return results.filter(Boolean);
}

async function generateOneBatch(rows, endpoint, workerIndex) {
  const started = performance.now();
  try {
    const outputs = await generateBatch(rows, endpoint);
    const seconds = secondsSince(started);
    const items = rows.map((row, index) => {
      const output = normalizeGeneratedOutput(row, outputs[index]);
      const validation = validateOutput(row, output);
      return {
        source_entry_id: row.source_entry_id,
        word: row.word,
        source_lang: row.source_lang,
        frequency_rank: row.frequency_rank,
        endpoint,
        worker: workerIndex,
        batch_size: rows.length,
        seconds: Number((seconds / rows.length).toFixed(2)),
        batch_seconds: seconds,
        valid: validation.errors.length === 0,
        errors: validation.errors,
        output
      };
    });
    if (!quiet) {
      const accepted = items.filter((item) => item.valid).length;
      console.log(
        `[batch] accepted=${accepted}/${items.length} seconds=${seconds} endpoint=${endpoint} worker=${workerIndex}`
      );
    }
    return items;
  } catch (error) {
    if (isRecoverableModelLoadError(error) || isRecoverableGenerationError(error)) {
      try {
        if (isRecoverableModelLoadError(error)) await loadEndpoint(endpoint);
        const outputs = await generateBatch(rows, endpoint);
        const seconds = secondsSince(started);
        const items = rows.map((row, index) => {
          const output = normalizeGeneratedOutput(row, outputs[index]);
          const validation = validateOutput(row, output);
          return {
            source_entry_id: row.source_entry_id,
            word: row.word,
            source_lang: row.source_lang,
            frequency_rank: row.frequency_rank,
            endpoint,
            worker: workerIndex,
            batch_size: rows.length,
            seconds: Number((seconds / rows.length).toFixed(2)),
            batch_seconds: seconds,
            valid: validation.errors.length === 0,
            errors: validation.errors,
            output
          };
        });
        if (!quiet) {
          const accepted = items.filter((item) => item.valid).length;
          console.log(
            `[retry-batch] accepted=${accepted}/${items.length} seconds=${seconds} endpoint=${endpoint} worker=${workerIndex}`
          );
        }
        return items;
      } catch (retryError) {
        error = retryError;
      }
    }
    const seconds = secondsSince(started);
    const items = rows.map((row) => ({
      source_entry_id: row.source_entry_id,
      word: row.word,
      source_lang: row.source_lang,
      frequency_rank: row.frequency_rank,
      endpoint,
      worker: workerIndex,
      batch_size: rows.length,
      seconds: Number((seconds / rows.length).toFixed(2)),
      batch_seconds: seconds,
      valid: false,
      errors: [errorMessage(error)],
      output: null
    }));
    if (!quiet) {
      console.log(`[failed-batch] size=${rows.length} seconds=${seconds} endpoint=${endpoint} ${errorMessage(error)}`);
    }
    return items;
  }
}

async function prewarmEndpoints() {
  const results = [];
  for (const endpoint of endpoints) {
    const started = performance.now();
    try {
      const status = await fetchJson(`${endpoint}/v1/status`, { timeoutMs: 30_000 });
      const sameLoadedModel =
        status?.active_model === model &&
        (!ggufVariant || status?.gguf_variant === ggufVariant) &&
        (!status?.context_length || Number(status.context_length) === maxSeqLength) &&
        (!status?.speculative_type || status.speculative_type === speculativeType);
      if (sameLoadedModel) {
        results.push({ endpoint, ok: true, skipped: true, seconds: secondsSince(started), active_model: status.active_model });
        continue;
      }
      const load = await loadEndpoint(endpoint, status);
      results.push({
        endpoint,
        ok: true,
        skipped: false,
        seconds: secondsSince(started),
        active_model: load?.active_model || load?.model_path || model,
        speculative_type: load?.speculative_type || null
      });
    } catch (error) {
      results.push({ endpoint, ok: false, skipped: false, seconds: secondsSince(started), error: errorMessage(error) });
    }
  }
  return results;
}

async function loadEndpoint(endpoint, status = null) {
  const currentStatus = status || (await fetchJson(`${endpoint}/v1/status`, { timeoutMs: 30_000 }));
  const loadBody = {
    model_path: model,
    max_seq_length: maxSeqLength,
    load_in_4bit: loadIn4bit,
    speculative_type: currentStatus?.llama_cpp_supports_mtp === false ? "off" : speculativeType
  };
  if (ggufVariant) loadBody.gguf_variant = ggufVariant;
  return fetchJson(`${endpoint}/v1/load`, {
    method: "POST",
    timeoutMs: loadTimeoutMs,
    body: loadBody
  });
}

async function fetchJson(url, { method = "GET", timeoutMs = 30_000, body = null } = {}) {
  const response = await fetch(url, {
    method,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: body ? JSON.stringify(body) : null
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

function buildPrompt(row) {
  if (promptMode === "ultra") return buildUltraCompactPrompt(row);
  if (promptMode === "compact") return buildCompactPrompt(row);
  const lines = [
    "Return one compact JSON object. No markdown. No extra keys.",
    `source_lang=${row.source_lang}`,
    `headword=${JSON.stringify(row.word)}`,
    `normalized_key=${JSON.stringify(row.normalized_key || row.word)}`,
    `frequency_rank=${row.frequency_rank ?? null}`,
    `part_of_speech=${JSON.stringify(row.useful_senses?.[0]?.part_of_speech || null)}`,
    `meaning_gloss=${JSON.stringify(row.first_gloss_key || row.first_gloss_preview || "")}`,
    "Shape:",
    "{\"headword\":\"\",\"normalized_key\":\"\",\"primary_lang\":\"\",\"frequency_rank\":0,\"part_of_speech\":null,\"gloss_key\":\"\",\"localizations\":{\"en\":{\"term\":\"\",\"pronunciation\":\"\",\"pronunciation_system\":\"IPA\",\"definition\":\"\"},\"pt-BR\":{\"term\":\"\",\"pronunciation\":\"\",\"pronunciation_system\":\"IPA\",\"definition\":\"\"},\"zh\":{\"term\":\"\",\"reading\":\"\",\"reading_system\":\"pinyin\",\"definition\":\"\"},\"ja\":{\"term\":\"\",\"reading\":\"\",\"reading_system\":\"kana\",\"definition\":\"\"}}}",
    "Rules: source language term must equal headword exactly, including accents and script. Other language terms translate meaning_gloss, not the spelling of headword.",
    "Definitions must be written in the same language as their localization and must explain the meaning or grammatical use in a short phrase of at least 4 words for en/pt-BR, and at least 4 characters for zh/ja. Never repeat only the term.",
    "gloss_key must be concise: use one meaning label or at most 2 close synonyms, not a long semicolon-separated synonym list.",
    "zh term and definition use Simplified Chinese. zh reading is pinyin with tone marks or tone numbers. ja reading must be kana only or kana with kanji okurigana; never romaji. en and pt-BR include IPA pronunciation. If unsure, keep the source term exactly and explain the gloss."
  ];
  if (residualMode) lines.push(...residualPromptRules(row));
  return lines.join("\n");
}

function buildBatchPrompt(rows) {
  if (promptMode === "ultra") return buildUltraCompactBatchPrompt(rows);
  if (promptMode === "compact") return buildCompactBatchPrompt(rows);
  const inputs = rows.map((row) => ({
    source_entry_id: row.source_entry_id,
    source_lang: row.source_lang,
    headword: row.word,
    normalized_key: row.normalized_key || row.word,
    frequency_rank: row.frequency_rank ?? null,
    part_of_speech: row.useful_senses?.[0]?.part_of_speech || null,
    meaning_gloss: row.first_gloss_key || row.first_gloss_preview || ""
  }));
  const lines = [
    "Return one compact JSON object. No markdown. No extra keys.",
    "Shape: {\"items\":[RECORD,...]}",
    "Each RECORD shape:",
    "{\"source_entry_id\":0,\"headword\":\"\",\"normalized_key\":\"\",\"primary_lang\":\"\",\"frequency_rank\":0,\"part_of_speech\":null,\"gloss_key\":\"\",\"localizations\":{\"en\":{\"term\":\"\",\"pronunciation\":\"\",\"pronunciation_system\":\"IPA\",\"definition\":\"\"},\"pt-BR\":{\"term\":\"\",\"pronunciation\":\"\",\"pronunciation_system\":\"IPA\",\"definition\":\"\"},\"zh\":{\"term\":\"\",\"reading\":\"\",\"reading_system\":\"pinyin\",\"definition\":\"\"},\"ja\":{\"term\":\"\",\"reading\":\"\",\"reading_system\":\"kana\",\"definition\":\"\"}}}",
    "Rules: return exactly one item for each input, preserving source_entry_id and order. source language term must equal headword exactly, including accents and script. Other language terms translate meaning_gloss, not the spelling of headword.",
    "Definitions must be written in the same language as their localization and must explain the meaning or grammatical use in a short phrase of at least 4 words for en/pt-BR, and at least 4 characters for zh/ja. Never repeat only the term.",
    "gloss_key must be concise: use one meaning label or at most 2 close synonyms, not a long semicolon-separated synonym list.",
    "zh term and definition use Simplified Chinese. zh reading is pinyin with tone marks or tone numbers. ja reading must be kana only or kana with kanji okurigana; never romaji. en and pt-BR include IPA pronunciation. If unsure, keep the source term exactly and explain the gloss.",
    `inputs=${JSON.stringify(inputs)}`
  ];
  if (residualMode) lines.push(...residualPromptRules());
  return lines.join("\n");
}

function buildUltraCompactPrompt(row) {
  const gloss = row.first_gloss_key || row.first_gloss_preview || row.gloss_key || row.gloss_preview || "";
  return [
    "Return strict JSON only.",
    `Input: source_entry_id=${row.source_entry_id}; headword=${row.word}; lang=${row.source_lang}; meaning=${gloss}`,
    "Schema:",
    "{\"headword\":\"\",\"normalized_key\":\"\",\"primary_lang\":\"\",\"frequency_rank\":0,\"part_of_speech\":null,\"gloss_key\":\"\",\"localizations\":{\"en\":{\"term\":\"\",\"pronunciation\":\"\",\"pronunciation_system\":\"IPA\",\"definition\":\"\"},\"pt-BR\":{\"term\":\"\",\"pronunciation\":\"\",\"pronunciation_system\":\"IPA\",\"definition\":\"\"},\"zh\":{\"term\":\"\",\"reading\":\"\",\"reading_system\":\"pinyin\",\"definition\":\"\"},\"ja\":{\"term\":\"\",\"reading\":\"\",\"reading_system\":\"kana\",\"definition\":\"\"}}}",
    "Rules: source lang term equals headword exactly. en/pt terms translate meaning, not spelling. zh Simplified with pinyin reading. ja term Japanese with kana reading. en/pt pronunciations are IPA. Definitions are natural in each language. gloss_key max 2 close synonyms."
  ].join("\n");
}

function buildUltraCompactBatchPrompt(rows) {
  const inputs = rows.map((row) => {
    const gloss = row.first_gloss_key || row.first_gloss_preview || row.gloss_key || row.gloss_preview || "";
    return `${row.source_entry_id}|${row.word}|${row.source_lang}|${gloss}`;
  });
  return [
    "Return strict JSON only: {\"items\":[records]}.",
    "Record schema:",
    "{\"source_entry_id\":0,\"headword\":\"\",\"normalized_key\":\"\",\"primary_lang\":\"\",\"frequency_rank\":0,\"part_of_speech\":null,\"gloss_key\":\"\",\"localizations\":{\"en\":{\"term\":\"\",\"pronunciation\":\"\",\"pronunciation_system\":\"IPA\",\"definition\":\"\"},\"pt-BR\":{\"term\":\"\",\"pronunciation\":\"\",\"pronunciation_system\":\"IPA\",\"definition\":\"\"},\"zh\":{\"term\":\"\",\"reading\":\"\",\"reading_system\":\"pinyin\",\"definition\":\"\"},\"ja\":{\"term\":\"\",\"reading\":\"\",\"reading_system\":\"kana\",\"definition\":\"\"}}}",
    "Rules: preserve source_entry_id. source lang term equals headword exactly. en/pt terms translate meaning. zh Simplified+pinyin. ja Japanese+kana. en/pt IPA. Natural definitions. gloss_key max 2 close synonyms.",
    "Inputs source_entry_id|headword|lang|meaning:",
    ...inputs
  ].join("\n");
}

function buildCompactPrompt(row) {
  const gloss = row.first_gloss_key || row.first_gloss_preview || row.gloss_key || row.gloss_preview || "";
  const lines = [
    "Return one JSON object for a multilingual dictionary entry.",
    `Headword: ${row.word}`,
    `Source language: ${row.source_lang}`,
    `Meaning: ${gloss}`,
    "Top-level keys: headword, normalized_key, primary_lang, frequency_rank, part_of_speech, gloss_key, localizations.",
    "Localizations: en, pt-BR, zh, ja.",
    "en and pt-BR fields: term, pronunciation, pronunciation_system, definition.",
    "zh and ja fields: term, reading, reading_system, definition.",
    "Use the exact headword as the source-language term.",
    "If source language is zh or ja, en.term and pt-BR.term must be translated dictionary terms in English and Portuguese, not hanzi, kana, pinyin, or the original source spelling.",
    "If source language is zh or ja, en.pronunciation and pt-BR.pronunciation must pronounce the translated English/Portuguese term, not the source-language word.",
    "Definitions must be natural explanations in the same language as the localization; do not copy the English meaning gloss as a definition for other languages.",
    "For zh and ja, definition must be a complete Chinese/Japanese explanation, not just the translated term.",
    "gloss_key must be concise: use one meaning label or at most 2 close synonyms, not a long semicolon-separated synonym list.",
    "Use Simplified Chinese for zh. zh.reading must be pinyin with tone marks or tone numbers, not hanzi.",
    "Use kana for ja reading. ja.reading must contain Japanese kana, not romaji.",
    "Use IPA for en and pt-BR."
  ];
  if (residualMode) lines.push(...residualPromptRules(row));
  return lines.join("\n");
}

function buildCompactBatchPrompt(rows) {
  const inputLines = rows.map((row) => {
    const gloss = row.first_gloss_key || row.first_gloss_preview || row.gloss_key || row.gloss_preview || "";
    return `- source_entry_id=${row.source_entry_id}; headword=${row.word}; source_lang=${row.source_lang}; meaning=${gloss}`;
  });
  const lines = [
    "Return one JSON object with an items array for multilingual dictionary entries.",
    "Each item must preserve source_entry_id and include headword, normalized_key, primary_lang, frequency_rank, part_of_speech, gloss_key, localizations.",
    "Localizations: en, pt-BR, zh, ja.",
    "en and pt-BR fields: term, pronunciation, pronunciation_system, definition.",
    "zh and ja fields: term, reading, reading_system, definition.",
    "Use exact headword as the source-language term. Use Simplified Chinese for zh. Use kana for ja reading. Use IPA for en and pt-BR.",
    "If source language is zh or ja, en.term and pt-BR.term must be translated dictionary terms in English and Portuguese, not hanzi, kana, pinyin, or the original source spelling.",
    "If source language is zh or ja, en.pronunciation and pt-BR.pronunciation must pronounce the translated English/Portuguese term, not the source-language word.",
    "Definitions must be natural explanations in the same language as the localization; do not copy the English meaning gloss as a definition for other languages.",
    "For zh and ja, definition must be a complete Chinese/Japanese explanation, not just the translated term.",
    "gloss_key must be concise: use one meaning label or at most 2 close synonyms, not a long semicolon-separated synonym list.",
    "zh.reading must be pinyin with tone marks or tone numbers, not hanzi. ja.reading must contain Japanese kana, not romaji.",
    "Inputs:",
    ...inputLines
  ];
  if (residualMode) lines.push(...residualPromptRules());
  return lines.join("\n");
}

function residualPromptRules(row = null) {
  const extra = [
    "Residual-mode rules:",
    "The previous generic run failed validation, usually because the model copied source spelling or the English gloss into fields that need localized terms and definitions.",
    "Avoid copying the source headword into other languages unless it is a globally standard proper name, acronym, or loanword.",
    "Avoid using the English gloss verbatim as any definition. Expand it into a short natural explanation in each target language.",
    "For Chinese or Japanese source entries, English and Portuguese terms must be natural translations of meaning_gloss, not pinyin, kana, hanzi, or the original character.",
    "For rare Han characters and variants, translate the gloss into an ordinary target-language term. Keep the source character only in the source-language localization.",
    "For abbreviations, acronyms, brands, and proper names, use the conventional localized name if available; otherwise use a short expanded descriptive term in each target language.",
    "Always provide nonempty IPA for English and Portuguese. If a pronunciation is uncertain, give a conservative pronunciation for the chosen term instead of leaving it blank.",
    "Always provide Japanese reading in kana. For translated Japanese terms, prefer a common kanji/kana term and a kana reading.",
    "Never output Chinese in English or Portuguese terms. Never output romaji as a Japanese reading."
  ];
  const errors = row?.latest_errors;
  if (Array.isArray(errors) && errors.length) extra.push(`Previous validation errors to fix: ${errors.join(", ")}`);
  return extra;
}

function validateOutput(row, output) {
  const errors = [];
  if (!output || typeof output !== "object") return { errors: ["not_json_object"] };
  if (output.source_entry_id !== undefined && String(output.source_entry_id) !== String(row.source_entry_id)) {
    errors.push("source_entry_id_mismatch");
  }
  if (normalize(output.headword) !== normalize(row.word)) errors.push("headword_mismatch");
  if (output.primary_lang !== row.source_lang) errors.push("primary_lang_mismatch");
  if (!nonEmpty(output.gloss_key)) errors.push("missing_gloss_key");
  if (isBroadGlossKey(output.gloss_key)) errors.push("broad_gloss_key");
  if (!output.localizations || typeof output.localizations !== "object") errors.push("missing_localizations");
  for (const lang of LANGS) {
    const loc = output.localizations?.[lang];
    if (!loc || typeof loc !== "object") {
      errors.push(`missing_loc_${lang}`);
      continue;
    }
    if (!nonEmpty(loc.term)) errors.push(`missing_term_${lang}`);
    if (!nonEmpty(loc.definition)) errors.push(`missing_definition_${lang}`);
    if (definitionTooThin(loc.definition, lang, loc.term)) errors.push(`thin_definition_${lang}`);
    if (!termLanguageLooksRight(loc.term, lang)) errors.push(`term_language_${lang}`);
    if (!definitionLanguageLooksRight(loc.definition, lang)) errors.push(`definition_language_${lang}`);
    if (lang === "zh" && !readingLooksRight(loc.reading, "zh")) errors.push("missing_zh_reading");
    if (lang === "ja" && !readingLooksRight(loc.reading, "ja")) errors.push("missing_ja_reading");
    if ((lang === "en" || lang === "pt-BR") && !nonEmpty(loc.pronunciation)) errors.push(`missing_pronunciation_${lang}`);
  }
  const sourceTerm = output.localizations?.[row.source_lang]?.term;
  if (sourceTerm && normalize(sourceTerm) !== normalize(row.word)) errors.push("source_term_mismatch");
  const enTerm = output.localizations?.en?.term;
  const gloss = firstGlossToken(row.first_gloss_key || row.first_gloss_preview || row.gloss_key || row.gloss_preview);
  if (row.source_lang !== "en" && gloss && enTerm && normalize(enTerm) === normalize(row.word) && normalize(enTerm) !== normalize(gloss)) {
    errors.push("en_term_copies_non_english_source");
  }
  return { errors };
}

function normalizeGeneratedOutput(row, output) {
  if (!output || typeof output !== "object") return output;
  const normalized = { ...output };
  normalized.source_entry_id = normalized.source_entry_id ?? row.source_entry_id;
  normalized.source_sense_id = normalized.source_sense_id ?? row.first_sense_id ?? row.useful_senses?.[0]?.id ?? null;
  normalized.source_word = normalized.source_word ?? row.word;
  normalized.source_frequency_rank = normalized.source_frequency_rank ?? row.frequency_rank ?? null;
  normalized.headword = row.word;
  normalized.normalized_key = normalized.normalized_key || row.normalized_key || row.word;
  normalized.primary_lang = row.source_lang;
  normalized.frequency_rank = normalized.frequency_rank ?? row.frequency_rank ?? null;
  normalized.part_of_speech = normalized.part_of_speech ?? row.useful_senses?.[0]?.part_of_speech ?? null;
  normalized.gloss_key = nonEmpty(normalized.gloss_key)
    ? normalized.gloss_key
    : row.first_gloss_key || row.first_gloss_preview || row.gloss_key || row.gloss_preview || "";

  if (!normalized.localizations || typeof normalized.localizations !== "object") return normalized;
  const sourceLoc = normalized.localizations[row.source_lang];
  if (sourceLoc && typeof sourceLoc === "object") {
    normalized.localizations = { ...normalized.localizations };
    normalized.localizations[row.source_lang] = {
      ...sourceLoc,
      term: row.word
    };
  }
  return normalized;
}

function isBroadGlossKey(value) {
  const parts = String(value || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length >= 5;
}

function applyOutputs(items, stats) {
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 30000");
  const now = new Date().toISOString();

  const statements = {
    getEntry: db.prepare("SELECT id FROM product_entries WHERE group_key = ?"),
    insertEntry: db.prepare(`
      INSERT INTO product_entries
        (headword, normalized_key, primary_lang, frequency_rank, group_key, group_method, status, source_count, lang_count, created_at)
      VALUES
        (@headword, @normalized_key, @primary_lang, @frequency_rank, @group_key, 'source_gap_unsloth', @status, 1, 4, @created_at)
    `),
    getSense: db.prepare("SELECT id FROM product_senses WHERE product_entry_id = ? AND gloss_key = ?"),
    existingLocalizationsByEntry: db.prepare(`
      SELECT ps.id AS product_sense_id,
             ps.gloss_key,
             pl.lang,
             pl.term,
             pl.definition
      FROM product_senses ps
      JOIN product_localizations pl ON pl.product_sense_id = ps.id
      WHERE ps.product_entry_id = ?
        AND ps.status = 'accepted'
        AND COALESCE(pl.needs_review, 0) = 0
      ORDER BY ps.sense_order, ps.id, pl.lang
    `),
    getNextSenseOrder: db.prepare(`
      SELECT COALESCE(MAX(sense_order), 0) + 1 AS next_order
      FROM product_senses
      WHERE product_entry_id = ?
    `),
    insertSense: db.prepare(`
      INSERT INTO product_senses
        (product_entry_id, sense_order, part_of_speech, gloss_key, status, confidence, created_at)
      VALUES
        (@product_entry_id, @sense_order, @part_of_speech, @gloss_key, @status, 0.78, @created_at)
    `),
    upsertLocalization: db.prepare(`
      INSERT INTO product_localizations
        (product_sense_id, lang, term, reading, reading_system, pronunciation, pronunciation_system, definition, source, confidence, needs_review)
      VALUES
        (@product_sense_id, @lang, @term, @reading, @reading_system, @pronunciation, @pronunciation_system, @definition, @source, 0.78, @needs_review)
      ON CONFLICT(product_sense_id, lang) DO UPDATE SET
        term = excluded.term,
        reading = excluded.reading,
        reading_system = excluded.reading_system,
        pronunciation = excluded.pronunciation,
        pronunciation_system = excluded.pronunciation_system,
        definition = excluded.definition,
        source = excluded.source,
        confidence = excluded.confidence,
        needs_review = excluded.needs_review
    `),
    insertSourceLink: db.prepare(`
      INSERT OR IGNORE INTO product_sense_source_links
        (product_sense_id, source_entry_id, source_sense_id, source_lang, source_word, source_frequency_rank, match_method, confidence)
      VALUES
        (@product_sense_id, @source_entry_id, @source_sense_id, @source_lang, @source_word, @source_frequency_rank, 'source_gap_unsloth', 0.78)
    `)
  };

  db.transaction(() => {
    for (const item of items) {
      const groupKey = `source-gap:${item.primary_lang}:${normalize(item.normalized_key || item.headword)}`;
      let entryId = statements.getEntry.get(groupKey)?.id;
      if (entryId) {
        stats.entries_reused++;
      } else {
        entryId = Number(
          statements.insertEntry.run({
            headword: item.headword,
            normalized_key: normalize(item.normalized_key || item.headword),
            primary_lang: item.primary_lang,
            frequency_rank: item.frequency_rank ?? null,
            group_key: groupKey,
            status: appliedEntryStatus,
            created_at: now
          }).lastInsertRowid
        );
        stats.entries_inserted++;
      }

      let senseId = statements.getSense.get(entryId, item.gloss_key)?.id;
      if (senseId) {
        stats.senses_reused++;
      } else {
        senseId = findEquivalentSenseId(statements.existingLocalizationsByEntry.all(entryId), item);
        if (senseId) {
          stats.senses_reused++;
        } else {
          const senseOrder = statements.getNextSenseOrder.get(entryId)?.next_order || 1;
          senseId = Number(
            statements.insertSense.run({
              product_entry_id: entryId,
              sense_order: senseOrder,
              part_of_speech: item.part_of_speech || null,
              gloss_key: item.gloss_key,
              status: appliedSenseStatus,
              created_at: now
            }).lastInsertRowid
          );
          stats.senses_inserted++;
        }
      }

      for (const lang of LANGS) {
        const loc = item.localizations[lang];
        statements.upsertLocalization.run({
          product_sense_id: senseId,
          lang,
          term: loc.term,
          reading: loc.reading || null,
          reading_system: loc.reading_system || null,
          pronunciation: loc.pronunciation || null,
          pronunciation_system: loc.pronunciation_system || null,
          definition: loc.definition,
          source: SOURCE,
          needs_review: appliedLocalizationNeedsReview
        });
        stats.localizations_upserted++;
      }
      if (item.source_entry_id && item.source_sense_id) {
        stats.source_links_upserted += statements.insertSourceLink.run({
          product_sense_id: senseId,
          source_entry_id: item.source_entry_id,
          source_sense_id: item.source_sense_id,
          source_lang: item.primary_lang,
          source_word: item.source_word || item.headword,
          source_frequency_rank: item.source_frequency_rank ?? item.frequency_rank ?? null
        }).changes;
      }
    }
  })();
  db.close();
}

function candidateEligibility(row) {
  if (!row || !LANGS.includes(row.source_lang)) return { ok: false, reason: "invalid_lang" };
  const word = String(row.word || "").trim();
  if (!word) return { ok: false, reason: "empty_word" };
  const groupKey = `source-gap:${row.source_lang}:${normalize(row.normalized_key || row.word)}`;
  const glossKey = row.first_gloss_key || row.first_gloss_preview || row.gloss_key || row.gloss_preview || "";
  if (row.first_sense_id && existingLinkedCompleteSense.get(row.first_sense_id)) {
    return { ok: false, reason: "already_linked_complete_source_gap" };
  }
  if (glossKey && existingCompleteSense.get(groupKey, glossKey)) return { ok: false, reason: "already_complete_source_gap" };
  if (row.repairable_from_same_entry) return { ok: false, reason: "deterministic_repair_available" };
  if (row.entry_level_four_lang_available) return { ok: false, reason: "entry_level_four_lang_available" };
  if (!Boolean(glossKey)) return { ok: false, reason: "missing_gloss" };
  const risk = riskReason(row);
  if (risk && !includeRisky) return { ok: false, reason: risk };
  return { ok: true, reason: "" };
}

function findEquivalentSenseId(rows, item) {
  if (!rows.length || !item?.localizations) return null;
  const bySense = new Map();
  for (const row of rows) {
    if (!bySense.has(row.product_sense_id)) bySense.set(row.product_sense_id, []);
    bySense.get(row.product_sense_id).push(row);
  }
  let best = null;
  for (const [senseId, localizations] of bySense) {
    let exactMatches = 0;
    let sourceLangMatches = false;
    let englishMatches = false;
    for (const existing of localizations) {
      const generated = item.localizations[existing.lang];
      if (!generated) continue;
      const same =
        normalizeLocalizationText(existing.term) === normalizeLocalizationText(generated.term) &&
        normalizeLocalizationText(existing.definition) === normalizeLocalizationText(generated.definition);
      if (!same) continue;
      exactMatches++;
      if (existing.lang === item.primary_lang) sourceLangMatches = true;
      if (existing.lang === "en") englishMatches = true;
    }
    const strongDuplicate = exactMatches >= 2 || (exactMatches >= 1 && sourceLangMatches && englishMatches);
    if (!strongDuplicate) continue;
    if (!best || exactMatches > best.exactMatches) best = { senseId, exactMatches };
  }
  return best?.senseId || null;
}

function riskReason(row) {
  const word = String(row.word || "").trim();
  const gloss = String(row.first_gloss_key || row.first_gloss_preview || row.gloss_key || row.gloss_preview || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase();
  const latinOnly = /^[\p{Script=Latin}\s.'’-]+$/u.test(word);
  if (row.source_lang === "en" && normalize(word) === "audible" && /\bfootball play\b/u.test(gloss)) {
    return "known_source_term_residual";
  }
  if (row.source_lang === "en" && /^[A-Za-z]$/u.test(word)) return "latin_single_letter";
  if (row.source_lang === "en" && /^[A-Z]{2,}$/u.test(word)) return "latin_acronym";
  if (row.source_lang === "en" && /^[A-Z][a-z]+(?:[- ][A-Z][a-z]+)*$/u.test(word)) {
    return "english_capitalized_proper_like";
  }
  if (latinOnly && normalizeLatinLetters(word).length <= 2) return "very_short_latin";
  if (/\b(letter of the roman alphabet|blood group|radioactive|unit used in printing)\b/u.test(gloss)) return "encyclopedic_or_symbol_gloss";
  if (/\bsurname\b/u.test(gloss)) return "surname_gloss";
  if (/^boa$/u.test(gloss) || normalize(word) === normalize(gloss)) return "gloss_repeats_word";
  if (row.source_lang === "en" && /\b(one's|possessive|demonstrative)\b/u.test(gloss)) {
    return "possessive_or_demonstrative";
  }
  if (row.source_lang === "pt-BR" && FUNCTION_GLOSSES.has(gloss)) return "pt_function_word";
  if ((row.source_lang === "zh" || row.source_lang === "ja") && word.length === 1 && FUNCTION_GLOSSES.has(gloss)) return "single_cjk_function_word";
  return "";
}

function parseJson(content) {
  const text = String(content || "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("content is not JSON");
  }
}

function readingLooksRight(value, lang) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (lang === "zh") return /[\p{Script=Latin}\u0300-\u036f0-9]/u.test(text) && !/[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
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

function definitionTooThin(definition, lang, term) {
  const text = String(definition || "").trim();
  const termText = String(term || "").trim();
  if (!text) return true;
  if (normalize(text) === normalize(termText)) return true;
  if (lang === "en" || lang === "pt-BR") return text.length < 12;
  return text.length < 4;
}

function firstGlossToken(value) {
  const text = String(value || "").normalize("NFKC").trim().toLowerCase();
  const match = text.match(/^[a-z][a-z -]{0,40}/u);
  return match ? match[0].trim() : "";
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function buildWorkerSlots(rowCount, batchCount) {
  const slots = [];
  if (endpointConcurrency) {
    for (const endpoint of endpoints) {
      const count = endpointConcurrency[endpoint] || 0;
      for (let index = 0; index < count; index++) slots.push(endpoint);
    }
  } else {
    const workerCount = Math.min(concurrency, batchCount || Math.ceil(rowCount / batchSize) || 1);
    for (let index = 0; index < workerCount; index++) slots.push(endpoints[index % endpoints.length]);
  }
  return slots.length ? slots : [endpoints[0]];
}

function parseEndpointConcurrency(value, endpointList) {
  if (!value) return null;
  const byEndpoint = Object.fromEntries(endpointList.map((endpoint) => [endpoint, 0]));
  for (const part of String(value).split(",")) {
    const [rawKey, rawCount] = part.split("=");
    const key = String(rawKey || "").trim();
    const count = Number(rawCount);
    if (!key || !Number.isInteger(count) || count < 0) {
      throw new Error(`Invalid --endpoint-concurrency item: ${part}`);
    }
    const endpoint = endpointList.find((candidate) => {
      const url = new URL(candidate);
      return candidate === key || `${url.hostname}:${url.port}` === key || url.port === key;
    });
    if (!endpoint) throw new Error(`Unknown endpoint in --endpoint-concurrency: ${key}`);
    byEndpoint[endpoint] = count;
  }
  return byEndpoint;
}

function parseSourceLangFilter(value) {
  if (!value) return null;
  const langs = String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const lang of langs) {
    if (!LANGS.includes(lang)) throw new Error(`Invalid --source-langs value: ${lang}`);
  }
  return new Set(langs);
}

function chunkRows(rows, size) {
  const batches = [];
  for (let index = 0; index < rows.length; index += size) {
    batches.push(
      rows.slice(index, index + size).map((row, offset) => ({
        ...row,
        __selected_index: index + offset
      }))
    );
  }
  return batches;
}

function compactGeneratedItem(item) {
  return {
    source_entry_id: item.source_entry_id,
    word: item.word,
    source_lang: item.source_lang,
    frequency_rank: item.frequency_rank,
    endpoint: item.endpoint,
    worker: item.worker,
    batch_size: item.batch_size,
    seconds: item.seconds,
    batch_seconds: item.batch_seconds,
    valid: item.valid,
    errors: item.errors
  };
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalize(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase();
}

function normalizeLocalizationText(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase();
}

function normalizeLatinLetters(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/gu, "");
}

function secondsSince(started) {
  return Number(((performance.now() - started) / 1000).toFixed(2));
}

function errorMessage(error) {
  const base = `${error?.name || "Error"}: ${error?.message || String(error)}`;
  const cause = error?.cause;
  if (!cause) return base;
  const details = [cause.code, cause.message].filter(Boolean).join(" ");
  return details ? `${base} (${details})` : base;
}

function isRecoverableModelLoadError(error) {
  return /No model loaded|Call POST \/inference\/load first|Call POST \/v1\/load first|fetch failed/u.test(errorMessage(error));
}

function isRecoverableGenerationError(error) {
  return /content is not JSON|batch content missing items array|Unexpected token|unterminated string|JSON/u.test(errorMessage(error));
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
