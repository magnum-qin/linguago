import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

const args = parseArgs(process.argv.slice(2));
const reportPath = path.resolve(args.report);
const outPath = path.resolve(args.out);
const endpoint = String(args.endpoint || '').replace(/\/$/u, '');
const model = String(args.model || '');
const variant = String(args['gguf-variant'] || '');
const token = args.token || process.env.UNSLOTH_API_KEY;
const reviewer = String(args.reviewer || model);
const limit = integer(args.limit, 20, 1);
const offset = integer(args.offset, 0, 0);
const maxAttempts = integer(args['max-attempts'], 2, 1);
const timeoutMs = integer(args['timeout-ms'], 120000, 1000);
const loadTimeoutMs = integer(args['load-timeout-ms'], 300000, 1000);
const maxSeqLength = integer(args['max-seq-length'], 2048, 1024);
const confidenceThreshold = number(args['confidence-threshold'], 0.9, 0, 1);
const resume = args.resume === 'true';
if (!reportPath || !outPath || !endpoint || !model || !token) throw new Error('Required: --report --out --endpoint --model and UNSLOTH_API_KEY');

const source = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (source.research_only !== true || source.production_publishable !== false) throw new Error('Expected research-only probe');
const candidates = (source.review_candidates || []).slice(offset, offset + limit);
const fingerprint = sha256(JSON.stringify(candidates));
const existing = resume && fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : null;
if (existing && existing.input_fingerprint !== fingerprint) throw new Error('Resume fingerprint mismatch');
const reviews = Array.isArray(existing?.reviews) ? existing.reviews : [];
const completed = new Set(reviews.map((row) => row.candidate_key));
const prewarm = await loadModel();

for (const candidate of candidates) {
  if (completed.has(candidate.candidate_key)) continue;
  const result = await reviewWithRetry(candidate);
  reviews.push(result);
  writeReport();
  console.log(`[${reviews.length}/${candidates.length}] ${candidate.candidate_key} ${result.decision || 'error'} ${result.confidence ?? '-'}`);
}
writeReport();
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary: summarize() }, null, 2));

async function reviewWithRetry(candidate) {
  let lastError = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const started = performance.now();
    try {
      const response = await postJson('/v1/chat/completions', {
        model, stream: false, temperature: 0, max_tokens: 300,
        enable_thinking: false, reasoning_effort: 'none',
        messages: [
          { role: 'system', content: 'You are a conservative Portuguese-English lexicographer. Return one JSON object only.' },
          { role: 'user', content: prompt(candidate, lastError) }
        ]
      }, timeoutMs);
      const parsed = parseJson(String(response?.choices?.[0]?.message?.content || ''));
      validate(parsed);
      const confidence = Number(parsed.confidence);
      return {
        candidate_key: candidate.candidate_key,
        valid: true,
        decision: parsed.decision,
        confidence,
        approved: parsed.decision === 'accept' && confidence >= confidenceThreshold && parsed.supporting_definition_orders.length > 0,
        supporting_definition_orders: parsed.supporting_definition_orders,
        reason: parsed.reason.trim(),
        risk_flags: parsed.risk_flags.map(String),
        attempt,
        seconds: Number(((performance.now() - started) / 1000).toFixed(3)),
        usage: response?.usage || null
      };
    } catch (error) { lastError = String(error?.message || error); }
  }
  return { candidate_key: candidate.candidate_key, valid: false, decision: null, confidence: null, approved: false, error: lastError };
}

function prompt(candidate, previousError) {
  const definitions = candidate.dicionario_aberto_definitions.map((row, index) => ({
    order: index + 1,
    pos: row.part_of_speech || row.part_of_speech_raw || null,
    definition_pt: row.definition,
    usage: row.usage
  }));
  return [
    'Decide whether at least one supplied Portuguese dictionary definition supports exactly the same lexical sense as the English anchor.',
    'The dictionary is historical. Accept only semantic equivalence; reject obsolete-only, different scope, different part of speech, named entity, and merely related concepts.',
    'Do not translate or rewrite the entry. Select only definition order numbers from the supplied list.',
    `Portuguese term: ${candidate.term}`,
    `Expected part of speech: ${candidate.part_of_speech || 'unknown'}`,
    `English anchor: ${candidate.english_anchor}`,
    `Definitions: ${JSON.stringify(definitions)}`,
    previousError ? `Previous response error: ${previousError}` : '',
    'Return exactly: {"decision":"accept|reject|manual_review","confidence":0.0,"supporting_definition_orders":[],"reason":"","risk_flags":[]}'
  ].filter(Boolean).join('\n');
}

function validate(value) {
  if (!value || !['accept', 'reject', 'manual_review'].includes(value.decision)) throw new Error('invalid_decision');
  if (!Number.isFinite(Number(value.confidence)) || Number(value.confidence) < 0 || Number(value.confidence) > 1) throw new Error('invalid_confidence');
  if (!Array.isArray(value.supporting_definition_orders) || value.supporting_definition_orders.some((n) => !Number.isInteger(Number(n)) || Number(n) < 1)) throw new Error('invalid_definition_orders');
  if (value.decision === 'accept' && value.supporting_definition_orders.length === 0) throw new Error('accept_without_definition');
  if (typeof value.reason !== 'string' || !value.reason.trim()) throw new Error('missing_reason');
  if (!Array.isArray(value.risk_flags)) throw new Error('invalid_risk_flags');
}

async function loadModel() {
  const started = performance.now();
  const status = await getJson('/v1/status', 30000).catch(() => ({}));
  const same = status?.active_model === model && (!variant || status?.gguf_variant === variant);
  if (!same) {
    const body = { model_path: model, max_seq_length: maxSeqLength, load_in_4bit: false, speculative_type: 'off' };
    if (variant) body.gguf_variant = variant;
    await postJson('/v1/load', body, loadTimeoutMs);
  }
  return { skipped: same, seconds: Number(((performance.now() - started) / 1000).toFixed(3)) };
}
async function getJson(route, timeout) { const response = await fetch(`${endpoint}${route}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeout) }); const body = await response.text(); if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`); return JSON.parse(body); }
async function postJson(route, value, timeout) { const response = await fetch(`${endpoint}${route}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(value), signal: AbortSignal.timeout(timeout) }); const body = await response.text(); if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`); return JSON.parse(body); }
function parseJson(value) { const cleaned = value.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, ''); try { return JSON.parse(cleaned); } catch { const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}'); if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)); throw new Error(`json_parse_failed:${cleaned.slice(0, 200)}`); } }
function summarize() { return { total: reviews.length, valid: reviews.filter((row) => row.valid).length, approved: reviews.filter((row) => row.approved).length, rejected: reviews.filter((row) => row.decision === 'reject').length, manual_review: reviews.filter((row) => row.decision === 'manual_review').length, errors: reviews.filter((row) => !row.valid).length, average_seconds: average(reviews.filter((row) => row.valid).map((row) => row.seconds)) }; }
function writeReport() { fs.mkdirSync(path.dirname(outPath), { recursive: true }); fs.writeFileSync(outPath, `${JSON.stringify({ ok: true, generated_at: new Date().toISOString(), research_only: true, production_publishable: false, publication_evidence: false, source_report: path.relative(process.cwd(), reportPath), input_fingerprint: fingerprint, reviewer, endpoint, model, gguf_variant: variant || null, confidence_threshold: confidenceThreshold, prewarm, summary: summarize(), reviews }, null, 2)}\n`, 'utf8'); }
function average(values) { return values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)) : null; }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function parseArgs(argv) { const out = {}; for (let i = 0; i < argv.length; i += 1) { if (!argv[i].startsWith('--')) continue; const key = argv[i].slice(2); const next = argv[i + 1]; out[key] = next && !next.startsWith('--') ? argv[++i] : true; } return out; }
function integer(value, fallback, min) { const parsed = Number(value ?? fallback); if (!Number.isInteger(parsed) || parsed < min) throw new Error(`Invalid integer: ${value}`); return parsed; }
function number(value, fallback, min, max) { const parsed = Number(value ?? fallback); if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`Invalid number: ${value}`); return parsed; }
