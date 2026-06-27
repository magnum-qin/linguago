import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const DEFAULT_REPORT = "logs/product-broad-risk-triage-20260625.json";
const DEFAULT_OUT = "logs/product-broad-risk-llm-review-20260625.json";
const DEFAULT_MODEL = "unsloth/Qwen3.6-35B-A3B-MTP-GGUF";
const DEFAULT_ENDPOINTS = [
  "http://100.99.99.99:11441",
  "http://100.99.99.99:11444",
  "http://100.99.99.99:11448",
  "http://100.99.99.99:11447"
];
const LANGS = ["en", "zh", "ja", "pt-BR"];

const args = parseArgs(process.argv.slice(2));
const reportPath = path.resolve(args.report || DEFAULT_REPORT);
const outPath = path.resolve(args.out || DEFAULT_OUT);
const token = args.token || process.env.UNSLOTH_API_KEY;
const model = args.model || DEFAULT_MODEL;
const endpoints = String(args.endpoints || DEFAULT_ENDPOINTS.join(","))
  .split(",")
  .map((item) => item.trim().replace(/\/$/u, ""))
  .filter(Boolean);
const limit = Number(args.limit || 12);
const concurrency = Number(args.concurrency || Math.min(2, endpoints.length));
const timeoutMs = Number(args["timeout-ms"] || 180_000);
const maxTokens = Number(args["max-tokens"] || 900);
const prewarm = args.prewarm !== "false";
const dryRun = args["dry-run"] === "true";
const ggufVariant = args["gguf-variant"] || "UD-IQ4_NL";
const maxSeqLength = Number(args["max-seq-length"] || 8192);
const speculativeType = args["speculative-type"] || "mtp";
const retries = Number(args.retries || 1);

if (!fs.existsSync(reportPath)) throw new Error(`Triage report not found: ${reportPath}`);
if (!Number.isInteger(limit) || limit < 1) throw new Error(`Invalid --limit: ${args.limit}`);
if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error(`Invalid --concurrency: ${args.concurrency}`);
if (!endpoints.length) throw new Error("No endpoints configured");
if (!dryRun && !token) throw new Error("Missing --token or UNSLOTH_API_KEY");

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const candidates = (report.llm_candidates || []).slice(0, limit).map(toReviewCandidate);

if (!candidates.length) throw new Error("No llm_candidates found in triage report");

if (dryRun) {
  const output = {
    ok: true,
    dry_run: true,
    report: path.relative(process.cwd(), reportPath),
    selected: candidates.length,
    candidates
  };
  writeJson(outPath, output);
  console.log(JSON.stringify({ ok: true, dry_run: true, selected: candidates.length, out: path.relative(process.cwd(), outPath) }, null, 2));
  process.exit(0);
}

const started = performance.now();
const prewarm_results = prewarm ? await prewarmEndpoints() : [];
const reviews = await runPool(candidates);
const summary = summarize(reviews);

const output = {
  ok: true,
  created_at: new Date().toISOString(),
  report: path.relative(process.cwd(), reportPath),
  model,
  endpoints,
  limit,
  concurrency,
  retries,
  prewarm,
  gguf_variant: ggufVariant,
  max_seq_length: maxSeqLength,
  speculative_type: speculativeType,
  seconds: secondsSince(started),
  prewarm_results,
  summary,
  reviews
};

writeJson(outPath, output);
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary }, null, 2));

async function runPool(rows) {
  const results = [];
  let nextIndex = 0;
  async function worker(workerIndex) {
    const endpoint = endpoints[workerIndex % endpoints.length];
    while (nextIndex < rows.length) {
      const current = nextIndex++;
      const candidate = rows[current];
      const result = await reviewCandidateWithRetry(candidate, endpoint);
      results[current] = result;
      console.log(
        `[${current + 1}/${rows.length}] ${candidate.product_entry.headword} sense=${candidate.product_sense.id} -> ${
          result.valid ? result.decision : "error"
        }`
      );
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, (_, index) => worker(index)));
  return results;
}

async function reviewCandidateWithRetry(candidate, endpoint) {
  let lastResult = null;
  const attempts = Math.max(1, retries + 1);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await reviewCandidate(candidate, endpoint).catch((error) => ({
      sense_id: candidate.product_sense.id,
      headword: candidate.product_entry.headword,
      endpoint,
      valid: false,
      error: errorMessage(error)
    }));
    result.attempt = attempt;
    lastResult = result;
    if (result.valid) return result;
    if (attempt < attempts && shouldRetry(result)) {
      await sleep(1000 * attempt);
      continue;
    }
    return result;
  }
  return lastResult;
}

async function reviewCandidate(candidate, endpoint) {
  const requestStarted = performance.now();
  const data = await postJson(
    endpoint,
    "/v1/chat/completions",
    {
      model,
      stream: false,
      temperature: 0,
      max_tokens: maxTokens,
      messages: [
        {
          role: "system",
          content:
            "You audit a four-language dictionary. Return only valid JSON. " +
            "Judge whether one published product sense is over-broad and should be split, manually repaired, blocked, or kept."
        },
        { role: "user", content: buildPrompt(candidate) }
      ]
    },
    timeoutMs
  );
  const content = data?.choices?.[0]?.message?.content || "";
  let parsed;
  try {
    parsed = parseJson(content);
  } catch (error) {
    return {
      sense_id: candidate.product_sense.id,
      entry_id: candidate.product_entry.id,
      headword: candidate.product_entry.headword,
      primary_lang: candidate.product_entry.primary_lang,
      frequency_rank: candidate.product_entry.frequency_rank,
      endpoint,
      seconds: secondsSince(requestStarted),
      usage: data.usage || null,
      valid: false,
      validation_errors: ["json_parse_failed"],
      decision: null,
      confidence: null,
      reason: "",
      suggested_senses: [],
      evidence: [],
      candidate,
      error: errorMessage(error),
      raw_preview: content.slice(0, 3000)
    };
  }
  const validation = validateReview(parsed);
  return {
    sense_id: candidate.product_sense.id,
    entry_id: candidate.product_entry.id,
    headword: candidate.product_entry.headword,
    primary_lang: candidate.product_entry.primary_lang,
    frequency_rank: candidate.product_entry.frequency_rank,
    endpoint,
    seconds: secondsSince(requestStarted),
    usage: data.usage || null,
    valid: validation.ok,
    validation_errors: validation.errors,
    decision: parsed?.decision || null,
    confidence: parsed?.confidence ?? null,
    reason: parsed?.reason || "",
    suggested_senses: Array.isArray(parsed?.suggested_senses) ? parsed.suggested_senses : [],
    evidence: Array.isArray(parsed?.evidence) ? parsed.evidence : [],
    candidate,
    raw_preview: content.slice(0, 1200)
  };
}

function shouldRetry(result) {
  const error = `${result.error || ""} ${(result.validation_errors || []).join(" ")}`;
  return /fetch failed|No model loaded|json_parse_failed|HTTP 5\d\d|ECONNRESET|ETIMEDOUT/iu.test(error);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toReviewCandidate(row) {
  return {
    product_entry: {
      id: row.entry_id,
      headword: row.headword,
      primary_lang: row.primary_lang,
      frequency_rank: row.frequency_rank,
      group_method: row.group_method,
      source_count: row.entry_source_count
    },
    product_sense: {
      id: row.sense_id,
      sense_order: row.sense_order,
      part_of_speech: row.part_of_speech,
      gloss_key: row.gloss_key,
      confidence: row.confidence
    },
    current_localizations: Object.fromEntries(
      LANGS.map((lang) => {
        const loc = row.localizations?.[lang];
        return [
          lang,
          loc
            ? {
                term: loc.term,
                reading: loc.reading,
                pronunciation: loc.pronunciation,
                definition: loc.definition
              }
            : null
        ];
      })
    ),
    source_links: row.source_links || [],
    triage: row.triage,
    features: row.features
  };
}

function buildPrompt(candidate) {
  return `Review this published dictionary sense.

Decision rules:
- "keep": one broad but valid lexical sense; no immediate product problem.
- "split": multiple common meanings, pronunciations, parts of speech, or translations are mixed and can be separated into 2-5 dictionary senses.
- "manual_repair": the current localization is mistranslated, too broad, inflected-form noise, named-entity noise, or needs deterministic cleanup before LLM completion.
- "block": unsafe to publish because the sense is too generic, corrupt, or unsupported.

For "split", suggested_senses should be compact product senses. Do not invent obscure meanings. Preserve the lookup language, readings/pronunciations when evidence supports them, and keep examples empty unless already evidenced.

Return JSON exactly:
{
  "decision": "keep" | "split" | "manual_repair" | "block",
  "confidence": number between 0 and 1,
  "reason": string,
  "suggested_senses": [
    {
      "label": string,
      "part_of_speech": string | null,
      "localizations": {
        "en": {"term": string, "definition": string},
        "zh": {"term": string, "reading": string | null, "definition": string},
        "ja": {"term": string, "reading": string | null, "definition": string},
        "pt-BR": {"term": string, "definition": string}
      }
    }
  ],
  "evidence": string[]
}

Input:
${JSON.stringify(candidate, null, 2)}`;
}

function validateReview(parsed) {
  const errors = [];
  if (!parsed || typeof parsed !== "object") return { ok: false, errors: ["not_json_object"] };
  if (!["keep", "split", "manual_repair", "block"].includes(parsed.decision)) errors.push("invalid_decision");
  if (typeof parsed.confidence !== "number" || parsed.confidence < 0 || parsed.confidence > 1) errors.push("invalid_confidence");
  if (typeof parsed.reason !== "string" || !parsed.reason.trim()) errors.push("missing_reason");
  if (!Array.isArray(parsed.evidence) || parsed.evidence.length < 1) errors.push("missing_evidence");
  if (!Array.isArray(parsed.suggested_senses)) errors.push("missing_suggested_senses");
  if (parsed.decision === "split" && parsed.suggested_senses?.length < 2) errors.push("split_requires_2_senses");
  if (parsed.decision !== "split" && parsed.suggested_senses?.length) errors.push("non_split_suggested_senses_must_be_empty");
  return { ok: errors.length === 0, errors };
}

async function prewarmEndpoints() {
  const results = [];
  await Promise.all(
    endpoints.map(async (endpoint) => {
      const started = performance.now();
      try {
        const data = await postJson(
          endpoint,
          "/v1/load",
          {
            model_path: model,
            max_seq_length: maxSeqLength,
            load_in_4bit: true,
            speculative_type: speculativeType,
            ...(ggufVariant ? { gguf_variant: ggufVariant } : {})
          },
          300_000
        );
        results.push({ endpoint, ok: true, seconds: secondsSince(started), active_model: data.model_path || data.display_name || model });
      } catch (error) {
        results.push({ endpoint, ok: false, seconds: secondsSince(started), error: errorMessage(error) });
      }
    })
  );
  return results;
}

async function postJson(endpoint, pathName, body, timeout) {
  const response = await fetch(`${endpoint}${pathName}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`non_json_response: ${text.slice(0, 500)}`);
  }
}

function parseJson(content) {
  const text = String(content || "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error(`json_parse_failed: ${text.slice(0, 300)}`);
  }
}

function summarize(rows) {
  return {
    total: rows.length,
    valid: rows.filter((row) => row.valid).length,
    invalid: rows.filter((row) => !row.valid).length,
    by_decision: countBy(rows.map((row) => (row.valid ? row.decision : "invalid"))),
    avg_seconds: rows.length ? Number((rows.reduce((sum, row) => sum + (row.seconds || 0), 0) / rows.length).toFixed(2)) : 0
  };
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function secondsSince(started) {
  return Number(((performance.now() - started) / 1000).toFixed(2));
}

function errorMessage(error) {
  return error?.stack || error?.message || String(error);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index++;
    } else {
      parsed[key] = "true";
    }
  }
  return parsed;
}
