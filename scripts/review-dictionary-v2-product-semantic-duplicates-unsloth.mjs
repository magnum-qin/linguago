import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const DEFAULT_REPORT = "logs/product-semantic-duplicate-review-20260624.json";
const DEFAULT_OUT = "logs/product-semantic-duplicate-llm-review-20260624.json";
const DEFAULT_ENDPOINTS = [
  "http://100.99.99.99:11441",
  "http://100.99.99.99:11444",
  "http://100.99.99.99:11448",
  "http://100.99.99.99:11447"
];
const DEFAULT_MODEL = "unsloth/Qwen3.6-35B-A3B-MTP-GGUF";
const LANGS = ["en", "pt-BR", "zh", "ja"];

const args = parseArgs(process.argv.slice(2));
const reportPath = path.resolve(args.report || DEFAULT_REPORT);
const outPath = path.resolve(args.out || DEFAULT_OUT);
const token = args.token || process.env.UNSLOTH_API_KEY;
const endpoints = String(args.endpoints || DEFAULT_ENDPOINTS.join(","))
  .split(",")
  .map((item) => item.trim().replace(/\/$/u, ""))
  .filter(Boolean);
const model = args.model || DEFAULT_MODEL;
const limit = Number(args.limit || 18);
const concurrency = Number(args.concurrency || Math.min(2, endpoints.length));
const timeoutMs = Number(args["timeout-ms"] || 180_000);
const prewarm = args.prewarm !== "false";
const maxTokens = Number(args["max-tokens"] || 700);
const ggufVariant = args["gguf-variant"] || null;
const maxSeqLength = Number(args["max-seq-length"] || 8192);
const speculativeType = args["speculative-type"] || "mtp";
const recommendations = String(args.recommendations || "llm_semantic_review")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

if (!fs.existsSync(reportPath)) throw new Error(`Review report not found: ${reportPath}`);
if (!token) throw new Error("Missing --token or UNSLOTH_API_KEY");
if (!endpoints.length) throw new Error("No endpoints configured");
if (!Number.isInteger(limit) || limit < 1) throw new Error(`Invalid --limit: ${args.limit}`);
if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error(`Invalid --concurrency: ${args.concurrency}`);

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const groupsByPair = new Map();
for (const group of report.groups || []) {
  if (!groupsByPair.has(group.pair_key)) groupsByPair.set(group.pair_key, []);
  groupsByPair.get(group.pair_key).push(group);
}

const selected = (report.pair_review || [])
  .filter((pair) => recommendations.includes(pair.recommendation))
  .slice(0, limit)
  .map((pair) => ({ pair, groups: groupsByPair.get(pair.pair_key) || [] }));

if (!selected.length) throw new Error(`No pairs found for recommendations: ${recommendations.join(",")}`);

const started = performance.now();
const prewarmResults = prewarm ? await prewarmEndpoints() : [];
const reviews = await runPool(selected);
const summary = summarize(reviews);

const output = {
  ok: true,
  created_at: new Date().toISOString(),
  report: path.relative(process.cwd(), reportPath),
  model,
  endpoints,
  limit,
  concurrency,
  recommendations,
  prewarm,
  gguf_variant: ggufVariant,
  max_seq_length: maxSeqLength,
  speculative_type: speculativeType,
  seconds: secondsSince(started),
  prewarm_results: prewarmResults,
  summary,
  reviews
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary }, null, 2));

async function runPool(rows) {
  const results = [];
  let nextIndex = 0;
  async function worker(workerIndex) {
    const endpoint = endpoints[workerIndex % endpoints.length];
    while (nextIndex < rows.length) {
      const current = nextIndex++;
      const row = rows[current];
      const result = await reviewPair(row, endpoint).catch((error) => ({
        pair_key: row.pair.pair_key,
        entry_id: row.pair.entry_id,
        headword: row.pair.headword,
        valid: false,
        error: errorMessage(error),
        endpoint
      }));
      results[current] = result;
      const decision = result.valid ? result.decision : "error";
      console.log(`[${current + 1}/${rows.length}] ${row.pair.headword} ${row.pair.pair_key} -> ${decision}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, (_, index) => worker(index)));
  return results;
}

async function reviewPair(row, endpoint) {
  const requestStarted = performance.now();
  const payload = buildReviewPayload(row);
  const data = await postJson(
    endpoint,
    "/v1/chat/completions",
    {
      model,
      stream: false,
      temperature: 0,
      max_tokens: maxTokens,
      enable_thinking: false,
      reasoning_effort: "none",
      messages: [
        {
          role: "system",
          content:
            "You are auditing a four-language dictionary. Return only valid JSON. " +
            "Decide whether two senses under the same entry should be merged, kept separate, or repaired before any merge."
        },
        { role: "user", content: buildPrompt(payload) }
      ]
    },
    timeoutMs
  );
  const content = data?.choices?.[0]?.message?.content || "";
  const parsed = parseJson(content);
  if (parsed && parsed.decision !== "merge") {
    parsed.keep_sense_id = null;
    parsed.remove_sense_id = null;
  }
  const validation = validateDecision(parsed, payload);
  return {
    pair_key: row.pair.pair_key,
    entry_id: row.pair.entry_id,
    headword: row.pair.headword,
    frequency_rank: row.pair.frequency_rank,
    endpoint,
    seconds: secondsSince(requestStarted),
    usage: data.usage || null,
    valid: validation.ok,
    validation_errors: validation.errors,
    decision: parsed?.decision || null,
    confidence: parsed?.confidence ?? null,
    keep_sense_id: parsed?.keep_sense_id ?? null,
    remove_sense_id: parsed?.remove_sense_id ?? null,
    reason: parsed?.reason || "",
    evidence: Array.isArray(parsed?.evidence) ? parsed.evidence : [],
    payload,
    raw_preview: content.slice(0, 1200)
  };
}

function buildReviewPayload(row) {
  const representative = row.groups[0];
  return {
    entry: {
      id: row.pair.entry_id,
      headword: row.pair.headword,
      primary_lang: row.pair.primary_lang,
      frequency_rank: row.pair.frequency_rank
    },
    duplicate_langs: row.pair.duplicate_langs,
    reasons: row.pair.reasons,
    senses: (representative?.senses || []).map((sense) => ({
      id: sense.id,
      sense_order: sense.sense_order,
      part_of_speech: sense.part_of_speech,
      gloss_key: sense.gloss_key,
      localizations: Object.fromEntries(
        LANGS.map((lang) => {
          const loc = sense.localizations?.[lang];
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
      source_links: (sense.source_links || []).map((link) => ({
        source_lang: link.source_lang,
        source_word: link.source_word,
        source_sense_id: link.source_sense_id,
        match_method: link.match_method
      }))
    }))
  };
}

function buildPrompt(payload) {
  return `Review this possible duplicate sense pair.

Rules:
- "merge" only if the senses represent the same lexical meaning across languages.
- "keep_separate" if they differ by part of speech, reading/pronunciation, usage, register, named entity vs common noun, or meaning.
- "repair_before_merge" if one localization is clearly mistranslated or too broad, so a merge decision would be unsafe before repair.
- Prefer keeping the lower sense_order as keep_sense_id when merging, unless the other sense has clearly better definitions.

Return JSON with exactly:
{
  "decision": "merge" | "keep_separate" | "repair_before_merge",
  "confidence": number between 0 and 1,
  "keep_sense_id": number | null,
  "remove_sense_id": number | null,
  "reason": string,
  "evidence": string[]
}

Input:
${JSON.stringify(payload, null, 2)}`;
}

function validateDecision(parsed, payload) {
  const errors = [];
  if (!parsed || typeof parsed !== "object") return { ok: false, errors: ["not_json_object"] };
  if (!["merge", "keep_separate", "repair_before_merge"].includes(parsed.decision)) errors.push("invalid_decision");
  if (typeof parsed.confidence !== "number" || parsed.confidence < 0 || parsed.confidence > 1) errors.push("invalid_confidence");
  const ids = new Set(payload.senses.map((sense) => sense.id));
  if (parsed.decision === "merge") {
    if (!ids.has(parsed.keep_sense_id)) errors.push("invalid_keep_sense_id");
    if (!ids.has(parsed.remove_sense_id)) errors.push("invalid_remove_sense_id");
    if (parsed.keep_sense_id === parsed.remove_sense_id) errors.push("same_keep_remove");
  }
  if (parsed.decision !== "merge" && (parsed.keep_sense_id !== null || parsed.remove_sense_id !== null)) {
    errors.push("non_merge_ids_must_be_null");
  }
  if (typeof parsed.reason !== "string" || !parsed.reason.trim()) errors.push("missing_reason");
  if (!Array.isArray(parsed.evidence) || parsed.evidence.length < 1) errors.push("missing_evidence");
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
