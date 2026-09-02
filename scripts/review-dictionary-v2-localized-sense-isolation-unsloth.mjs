import './lib/load-local-env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { discoverUnslothStagePool } from './lib/unsloth-cluster-discovery.mjs';
import {
  needsIndependentReview,
  validateLocalizedSenseReview
} from './lib/localized-sense-review-contract.mjs';

const args = parseArgs(process.argv.slice(2));
const inputPath = path.resolve(args.input || 'logs/product-localized-sense-isolation-risk.json');
const outPath = path.resolve(args.out || 'logs/product-localized-sense-isolation-qwen-review.json');
const role = args.role || 'primary';
const token = args.token || process.env.UNSLOTH_API_KEY;
const model = args.model || (role === 'secondary'
  ? 'unsloth/gemma-4-31B-it-qat-GGUF'
  : 'unsloth/Qwen3.6-35B-A3B-MTP-GGUF');
const fallbackEndpoints = String(args.endpoints || (role === 'secondary'
  ? 'http://127.0.0.1:11444,http://127.0.0.1:11445,http://127.0.0.1:11446'
  : 'http://127.0.0.1:11441,http://127.0.0.1:11447,http://127.0.0.1:11448'))
  .split(',').map((value) => value.trim().replace(/\/$/u, '')).filter(Boolean);
const dashboardUrl = args['dashboard-url'] || 'http://127.0.0.1:18080/api/status';
const limit = boundedInteger(args.limit, 100, 1);
const offset = boundedInteger(args.offset, 0, 0);
const concurrency = boundedInteger(args.concurrency, 4, 1);
const maxAttempts = boundedInteger(args['max-attempts'], 2, 1);
const timeoutMs = boundedInteger(args['timeout-ms'], 180_000, 1000);
const maxTokens = boundedInteger(args['max-tokens'], 1400, 100);
const checkpointEvery = boundedInteger(args['checkpoint-every'], 10, 1);
const circuitBreakerFailures = boundedInteger(args['circuit-breaker-failures'], 2, 1);
const circuitBreakerCooldownMs = boundedInteger(args['circuit-breaker-cooldown-ms'], 30_000, 1000);
const resume = args.resume !== 'false';
const secondaryThreshold = boundedNumber(args['secondary-threshold'], 0.95, 0, 1);
const secondaryReviewAll = args['secondary-review-all'] === 'true';
if (!fs.existsSync(inputPath)) throw new Error(`Input not found: ${inputPath}`);
if (!token) throw new Error('Missing UNSLOTH_API_KEY');
if (!['primary', 'secondary'].includes(role)) throw new Error(`Invalid role: ${role}`);

const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const sourceRows = role === 'secondary'
  ? (input.reviews || []).filter((row) => secondaryReviewAll
      || needsIndependentReview(row, secondaryThreshold)).map((row) => ({
      ...row.candidate,
      primary_review: compactReview(row)
    }))
  : input.candidates || [];
const selected = sourceRows.slice(offset, offset + limit);
if (!selected.length) throw new Error('No candidates selected');

const existing = resume && fs.existsSync(outPath) ? readCheckpoint(outPath) : null;
const reviews = Array.isArray(existing?.reviews) ? existing.reviews : [];
const completed = new Set(reviews.filter((row) => row.valid).map((row) => row.candidate_id));
const pending = selected.filter((row) => !completed.has(row.candidate_id));
const discovery = await discoverUnslothStagePool({
  dashboardUrl,
  configuredEndpoints: fallbackEndpoints,
  model,
  token,
  requireInstalled: true
});
const endpoints = discovery.endpoints || fallbackEndpoints;
if (!endpoints.length) throw new Error('No review endpoints available');

const started = performance.now();
let nextIndex = 0;
let completedSinceCheckpoint = 0;
const endpointState = new Map(endpoints.map((endpoint) => [endpoint, {
  failures: 0, successes: 0, inflight: 0, cooldown_until: 0
}]));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    writeCheckpoint(false);
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}
await Promise.all(Array.from({ length: Math.min(concurrency, endpoints.length, pending.length) }, (_, index) => worker(index)));
writeCheckpoint(true);

async function worker(index) {
  while (nextIndex < pending.length) {
    const candidate = pending[nextIndex++];
    const review = await reviewWithRetry(candidate, index);
    const existingIndex = reviews.findIndex((row) => row.candidate_id === review.candidate_id);
    if (existingIndex >= 0) reviews[existingIndex] = review;
    else reviews.push(review);
    completedSinceCheckpoint++;
    console.log(`[${reviews.length}/${selected.length}] ${candidate.entry.headword} / ${candidate.query_form.term} -> ${review.valid ? review.decision : 'error'} @ ${review.endpoint ? new URL(review.endpoint).port : 'none'}`);
    if (completedSinceCheckpoint >= checkpointEvery) writeCheckpoint(false);
  }
}

async function reviewWithRetry(candidate, workerIndex) {
  let last;
  const attempted = new Set();
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const endpoint = await acquireEndpoint(attempted, workerIndex + attempt - 1);
    attempted.add(endpoint);
    const state = endpointState.get(endpoint);
    state.inflight++;
    try {
      const retryFeedback = attempt > 1 && last && !last.valid
        ? {
            error: last.error || null,
            validation_errors: last.validation_errors || []
          }
        : null;
      last = await review(candidate, endpoint, attempt, retryFeedback).catch((error) => ({
        candidate_id: candidate.candidate_id,
        endpoint,
        attempt,
        valid: false,
        error: String(error?.message || error),
        candidate
      }));
      if (last.valid) {
        state.failures = 0;
        state.successes++;
        return last;
      }
      state.failures++;
      if (state.failures >= circuitBreakerFailures) state.cooldown_until = Date.now() + circuitBreakerCooldownMs;
    } finally {
      state.inflight--;
    }
    if (attempt < maxAttempts) await sleep(1000 * attempt);
  }
  return last;
}

async function acquireEndpoint(attempted, rotation) {
  while (true) {
    const now = Date.now();
    const fresh = endpoints.filter((endpoint) => !attempted.has(endpoint));
    const pool = fresh.length ? fresh : endpoints;
    const ready = pool.filter((endpoint) => endpointState.get(endpoint).cooldown_until <= now);
    if (ready.length) {
      return ready.sort((left, right) => {
        const a = endpointState.get(left), b = endpointState.get(right);
        const leftRotation = (endpoints.indexOf(left) - rotation + endpoints.length) % endpoints.length;
        const rightRotation = (endpoints.indexOf(right) - rotation + endpoints.length) % endpoints.length;
        return a.inflight - b.inflight || a.failures - b.failures || leftRotation - rightRotation;
      })[0];
    }
    const nextReady = Math.min(...pool.map((endpoint) => endpointState.get(endpoint).cooldown_until));
    await sleep(Math.max(100, Math.min(1000, nextReady - now)));
  }
}

async function review(candidate, endpoint, attempt, retryFeedback = null) {
  const requestStarted = performance.now();
  const response = await fetch(`${endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: maxTokens,
      stream: false,
      enable_thinking: false,
      reasoning_effort: 'none',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a conservative multilingual lexicographer. Return one JSON object only. Never modify the database.' },
        { role: 'user', content: buildPrompt(candidate, retryFeedback) }
      ]
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const payload = await response.json();
  const message = payload?.choices?.[0]?.message || {};
  const content = message.content || '';
  let parsed;
  try { parsed = parseJson(content); } catch (error) {
    return {
      candidate_id: candidate.candidate_id,
      endpoint,
      attempt,
      valid: false,
      error: `json_parse_failed: ${error.message}`,
      finish_reason: payload?.choices?.[0]?.finish_reason || null,
      reasoning_preview: String(message.reasoning_content || '').slice(0, 1000),
      raw_preview: content.slice(0, 1000),
      candidate
    };
  }
  const validation = validateLocalizedSenseReview(parsed, candidate);
  return {
    candidate_id: candidate.candidate_id,
    entry_id: candidate.entry.id,
    headword: candidate.entry.headword,
    query_lang: candidate.query_form.lang,
    query_term: candidate.query_form.term,
    endpoint,
    model,
    role,
    attempt,
    seconds: Number(((performance.now() - requestStarted) / 1000).toFixed(3)),
    valid: validation.ok,
    validation_errors: validation.errors,
    decision: parsed.decision,
    confidence: Number(parsed.confidence),
    matched_sense_ids: parsed.matched_sense_ids,
    reason_codes: parsed.reason_codes,
    reason: parsed.reason,
    actions: parsed.actions,
    candidate
  };
}

function buildPrompt(candidate, retryFeedback = null) {
  const semanticCandidate = {
    ...candidate,
    deterministic_matched_sense_ids: undefined,
    risk: undefined
  };
  const correction = retryFeedback
    ? `Your previous response failed deterministic validation: ${JSON.stringify(retryFeedback)}. Correct those exact errors in this response. Do not repeat the invalid structure.\n\n`
    : '';
  return correction + `Audit which published senses are semantically valid results for one localized lookup form in a fused four-language dictionary entry.\n\n` +
    `Decisions:\n` +
    `- keep: every listed sense is semantically valid for the query, including duplicate senses, ordinary synonyms, spelling variants, inflections, register variants, and a specific/common form that denotes the same concept.\n` +
    `- isolate: the entry has genuinely different meanings and at least one meaning would be false or misleading for this query; return every semantically valid sense in matched_sense_ids.\n` +
    `- split: the underlying entry combines unrelated lexemes or pronunciations and should later be split.\n` +
    `- repair: the senses express the same concept but one or more localized terms/readings/definitions are mistranslated and need a manual override.\n` +
    `- block: unsupported or corrupt sense should not remain published.\n` +
    `- manual_review: evidence is insufficient or ambiguous.\n\n` +
    `First decide whether the listed senses are genuinely different meanings or duplicate/paraphrased records. If they are duplicate meanings, isolation is forbidden: use keep when all localizations are acceptable, or repair when one localization is wrong. ` +
    `A different localized term string is NOT sufficient reason to isolate. Do not isolate merely because terms differ, such as 给/交给, 选举人/选民, 調節/調整, nerve cell/neuron, marrow/bone marrow, numeric/numerical, alume/alúmen, or kana/kanji variants, when their definitions denote the same concept. ` +
    `Treat paraphrases such as a person who votes and a person entitled to vote as the same voter concept unless the supplied senses explicitly establish a legal or jurisdiction-specific distinction. ` +
    `Use definition, part of speech, pronunciation, and actual denotation. Do not treat another LLM's opinion as evidence. Be conservative. Mainland Chinese wording is preferred. ` +
    `For split/repair/block, actions are proposals only and must identify sense_ids. Keep reason under 80 words, reason_codes to at most 4, and actions to at most 2. Do not narrate your deliberation.\n\n` +
    `Return exactly:\n` +
    `{"decision":"keep|isolate|split|repair|block|manual_review","confidence":0.0,"matched_sense_ids":[1],"reason_codes":["code"],"reason":"short explanation","actions":[{"type":"query_isolation|split_entry|repair_localization|block_sense|manual_review","sense_ids":[1],"target_lang":"en|pt-BR|zh|ja","fields":["term|definition|reading|pronunciation"],"note":"short note"}]}\n\n` +
    `For keep, matched_sense_ids must contain every candidate sense ID. For isolate, it must be a non-empty proper subset. For repair, identify the bad localization in an action and do not substitute isolation merely because the bad term differs.\n\n` +
    `Candidate:\n${JSON.stringify(semanticCandidate)}`;
}

function writeCheckpoint(final) {
  const ordered = reviews.sort((a, b) => selected.findIndex((row) => row.candidate_id === a.candidate_id) - selected.findIndex((row) => row.candidate_id === b.candidate_id));
  const output = {
    ok: final ? ordered.length >= selected.length : true,
    final,
    updated_at: new Date().toISOString(),
    role,
    model,
    input: path.relative(process.cwd(), inputPath),
    discovery,
    endpoint_state: Object.fromEntries([...endpointState].map(([endpoint, state]) => [endpoint, {
      ...state,
      cooldown_remaining_ms: Math.max(0, state.cooldown_until - Date.now())
    }])),
    selected: selected.length,
    pending: selected.length - new Set(ordered.filter((row) => row.valid).map((row) => row.candidate_id)).size,
    seconds: Number(((performance.now() - started) / 1000).toFixed(3)),
    summary: summarize(ordered),
    reviews: ordered
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const temporaryPath = `${outPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, outPath);
  completedSinceCheckpoint = 0;
}

function readCheckpoint(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed.reviews)) throw new Error('reviews must be an array');
    return parsed;
  } catch (error) {
    throw new Error(`Invalid checkpoint ${file}: ${error.message}`);
  }
}

function summarize(rows) {
  const decisions = {};
  for (const row of rows) decisions[row.valid ? row.decision : 'invalid'] = (decisions[row.valid ? row.decision : 'invalid'] || 0) + 1;
  return { reviewed: rows.length, valid: rows.filter((row) => row.valid).length, decisions };
}
function compactReview(row) {
  return { decision: row.decision, confidence: row.confidence, matched_sense_ids: row.matched_sense_ids, reason_codes: row.reason_codes, reason: row.reason, actions: row.actions };
}
function parseJson(text) {
  const cleaned = String(text).trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('JSON object not found');
  return JSON.parse(cleaned.slice(start, end + 1));
}
function parseArgs(argv) { const out = {}; for (let i = 0; i < argv.length; i++) { if (!argv[i].startsWith('--')) continue; const key = argv[i].slice(2); const next = argv[i + 1]; out[key] = next && !next.startsWith('--') ? argv[++i] : 'true'; } return out; }
function boundedInteger(value, fallback, minimum) { const parsed = value == null ? fallback : Number(value); if (!Number.isInteger(parsed) || parsed < minimum) throw new Error(`Invalid integer: ${value}`); return parsed; }
function boundedNumber(value, fallback, minimum, maximum) { const parsed = value == null ? fallback : Number(value); if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) throw new Error(`Invalid number: ${value}`); return parsed; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
