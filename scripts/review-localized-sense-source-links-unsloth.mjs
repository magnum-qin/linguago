import './lib/load-local-env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { discoverUnslothStagePool } from './lib/unsloth-cluster-discovery.mjs';

const args = parseArgs(process.argv.slice(2));
const inputPath = requiredPath(args.input, 'input');
const outPath = path.resolve(args.out || 'logs/localized-sense-source-link-semantic-review.json');
const role = args.role || 'primary';
const token = args.token || process.env.UNSLOTH_API_KEY;
const model = args.model || (role === 'secondary'
  ? 'unsloth/gemma-4-31B-it-qat-GGUF'
  : 'unsloth/Qwen3.6-35B-A3B-MTP-GGUF');
const fallbackEndpoints = String(args.endpoints || (role === 'secondary'
  ? 'http://127.0.0.1:11442,http://127.0.0.1:11444,http://127.0.0.1:11445,http://127.0.0.1:11446'
  : 'http://127.0.0.1:11441,http://127.0.0.1:11447,http://127.0.0.1:11448'))
  .split(',').map((value) => value.trim().replace(/\/$/u, '')).filter(Boolean);
const dashboardUrl = args['dashboard-url'] || 'http://127.0.0.1:18080/api/status';
const concurrency = integer(args.concurrency, 2, 1);
const maxAttempts = integer(args['max-attempts'], 2, 1);
const timeoutMs = integer(args['timeout-ms'], 180_000, 1000);
if (!token) throw new Error('Missing UNSLOTH_API_KEY');
if (!['primary', 'secondary'].includes(role)) throw new Error(`Invalid role: ${role}`);

const input = readJson(inputPath);
const candidates = input.candidates || [];
if (!candidates.length) throw new Error('No source-link candidates selected');
const discovery = await discoverUnslothStagePool({
  dashboardUrl, configuredEndpoints: fallbackEndpoints, model, token, requireInstalled: true
});
const endpoints = discovery.endpoints || fallbackEndpoints;
if (!endpoints.length) throw new Error('No endpoints available');

const reviews = [];
let next = 0;
const started = performance.now();
await Promise.all(Array.from({ length: Math.min(concurrency, endpoints.length, candidates.length) }, (_, index) => worker(endpoints[index % endpoints.length])));

async function worker(endpoint) {
  while (next < candidates.length) {
    const candidate = candidates[next++];
    const review = await withRetry(candidate, endpoint);
    reviews.push(review);
    console.log(`[${reviews.length}/${candidates.length}] ${candidate.candidate_id} ${review.valid ? review.decision : 'invalid'} @ ${new URL(endpoint).port}`);
  }
}

async function withRetry(candidate, endpoint) {
  let last;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      last = await callModel(candidate, endpoint, attempt);
      if (last.valid) return last;
    } catch (error) {
      last = { candidate_id: candidate.candidate_id, valid: false, error: String(error?.message || error), endpoint, attempt };
    }
  }
  return last;
}

async function callModel(candidate, endpoint, attempt) {
  const requestStarted = performance.now();
  const response = await fetch(`${endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model, temperature: 0, max_tokens: 900, stream: false,
      enable_thinking: false, reasoning_effort: 'none',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a conservative multilingual lexicographer. Return one JSON object only. Never modify data.' },
        { role: 'user', content: prompt(candidate) }
      ]
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const payload = await response.json();
  const raw = payload?.choices?.[0]?.message?.content || '';
  let parsed;
  try { parsed = parseJson(raw); }
  catch (error) { return { candidate_id: candidate.candidate_id, valid: false, error: `json_parse_failed: ${error.message}`, raw_preview: raw.slice(0, 1000), endpoint, attempt }; }
  const validationErrors = validate(parsed);
  return {
    candidate_id: candidate.candidate_id,
    product_sense_id: candidate.product_sense.sense_id,
    source_sense_id: candidate.proposed_source_sense.sense_id,
    endpoint, model, role, attempt,
    seconds: Number(((performance.now() - requestStarted) / 1000).toFixed(3)),
    valid: validationErrors.length === 0,
    validation_errors: validationErrors,
    decision: parsed.decision,
    confidence: Number(parsed.confidence),
    reason_codes: parsed.reason_codes || [],
    reason: parsed.reason,
    candidate
  };
}

function prompt(candidate) {
  return `Decide whether one proposed dictionary source sense describes exactly the same lexical sense as the locked product sense. This is source-link validation, not translation generation. Matching spelling is not sufficient: homographs and polysemy must be rejected. Require the same concept, part of speech, domain, and semantic breadth. A narrower, broader, related, named-person, or different physical meaning is misaligned. Example: English bill meaning invoice/law/note is misaligned with bill meaning a bird's beak, even if two dictionaries translate the beak sense as Portuguese bico. Use only the supplied snapshots. Choose manual_review when evidence is insufficient. Review independently; do not infer approval from the deterministic match method.\n\n` +
    `Return exactly {"decision":"aligned|misaligned|manual_review","confidence":0.0,"reason_codes":["short_code"],"reason":"short"}. No markdown.\n\nCandidate:\n${JSON.stringify(candidate)}`;
}

function validate(value) {
  const errors = [];
  if (!['aligned', 'misaligned', 'manual_review'].includes(value?.decision)) errors.push('invalid_decision');
  if (!Number.isFinite(Number(value?.confidence)) || Number(value.confidence) < 0 || Number(value.confidence) > 1) errors.push('invalid_confidence');
  if (!Array.isArray(value?.reason_codes) || !value.reason_codes.length || value.reason_codes.some((item) => typeof item !== 'string' || !item.trim())) errors.push('invalid_reason_codes');
  if (typeof value?.reason !== 'string' || !value.reason.trim()) errors.push('missing_reason');
  return errors;
}

const output = {
  ok: reviews.every((row) => row.valid), final: true, role, model,
  created_at: new Date().toISOString(), input: path.relative(process.cwd(), inputPath),
  database_write: false, discovery,
  seconds: Number(((performance.now() - started) / 1000).toFixed(3)),
  summary: count(reviews), reviews
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: output.ok, out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2));
process.exitCode = output.ok ? 0 : 2;

function count(rows) { const out={selected:rows.length,valid:0,aligned:0,misaligned:0,manual_review:0}; for(const row of rows){if(row.valid)out.valid++; if(row.valid&&out[row.decision]!==undefined)out[row.decision]++;} return out; }
function parseJson(text) { const cleaned=String(text).trim().replace(/^```(?:json)?\s*/iu,'').replace(/\s*```$/u,''); const a=cleaned.indexOf('{'),b=cleaned.lastIndexOf('}'); if(a<0||b<a)throw new Error('JSON object not found'); return JSON.parse(cleaned.slice(a,b+1)); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function requiredPath(value,name){if(!value)throw new Error(`Missing --${name}`);const file=path.resolve(value);if(!fs.existsSync(file))throw new Error(`File not found: ${file}`);return file;}
function integer(value,fallback,minimum){const parsed=value==null?fallback:Number(value);if(!Number.isInteger(parsed)||parsed<minimum)throw new Error(`Invalid integer: ${value}`);return parsed;}
function parseArgs(argv){const out={};for(let i=0;i<argv.length;i++){if(!argv[i].startsWith('--'))continue;const key=argv[i].slice(2),next=argv[i+1];out[key]=next&&!next.startsWith('--')?argv[++i]:'true';}return out;}
