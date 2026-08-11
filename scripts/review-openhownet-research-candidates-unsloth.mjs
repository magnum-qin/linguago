import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

const args = parseArgs(process.argv.slice(2));
const reportPath = path.resolve(args.report || 'logs/product-source-gap-v90-openhownet-research-probe.json');
const outPath = path.resolve(args.out || 'logs/product-source-gap-v90-openhownet-research-review.json');
const endpoint = String(args.endpoint || '').replace(/\/$/u, '');
const model = String(args.model || '');
const variant = String(args['gguf-variant'] || '');
const reviewer = String(args.reviewer || model || 'unspecified');
const token = args.token || process.env.UNSLOTH_API_KEY;
const limit = integer(args.limit, 21, 1);
const confidenceThreshold = number(args['confidence-threshold'], 0.9, 0, 1);
const maxAttempts = integer(args['max-attempts'], 2, 1);
const timeoutMs = integer(args['timeout-ms'], 120000, 1000);
const loadTimeoutMs = integer(args['load-timeout-ms'], 300000, 1000);
const maxSeqLength = integer(args['max-seq-length'], 1024, 512);
const forceReload = args['force-reload'] === 'true';
const resume = args.resume === 'true';
const recheckFailed = args['recheck-failed'] === 'true';
const excludeReviewPaths = String(args['exclude-reviews'] || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => path.resolve(value));
const candidateSet = String(args['candidate-set'] || 'research').trim().toLowerCase();
if (!['research', 'selection'].includes(candidateSet)) throw new Error(`Unsupported --candidate-set: ${candidateSet}`);

if (!fs.existsSync(reportPath)) throw new Error(`Report not found: ${reportPath}`);
if (!endpoint || !model || !token) throw new Error('Required: --endpoint, --model, and UNSLOTH_API_KEY');

const source = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (source?.policy?.research_only !== true || source?.policy?.production_publishable !== false) {
  throw new Error('Input is not explicitly marked research-only and non-publishable');
}
const candidateRows = candidateSet === 'selection' ? source.selection_candidates : source.research_candidates;
const excludedCandidateKeys = loadExcludedCandidateKeys(excludeReviewPaths);
const candidates = (candidateRows || [])
  .filter((row) => !excludedCandidateKeys.has(row.candidate_key))
  .slice(0, limit);
const fingerprint = sha256(JSON.stringify(candidates));
const existing = resume && fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : null;
if (existing && existing.input_fingerprint !== fingerprint) throw new Error('Resume fingerprint mismatch');
const reviews = Array.isArray(existing?.reviews)
  ? existing.reviews.filter((row) => !(recheckFailed && row?.valid !== true))
  : [];
const completed = new Set(reviews.map((row) => row.candidate_key));
const prewarm = await loadModel();

for (const candidate of candidates) {
  if (completed.has(candidate.candidate_key)) continue;
  const review = await reviewWithRetry(candidate);
  reviews.push(review);
  writeReport();
  console.log(`[${reviews.length}/${candidates.length}] ${candidate.candidate_key} ${review.decision || 'error'} ${review.confidence ?? '-'}`);
}

writeReport();
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary: summarize() }, null, 2));

async function reviewWithRetry(candidate) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const started = performance.now();
    try {
      const response = await postJson('/v1/chat/completions', {
        model,
        stream: false,
        temperature: 0,
        max_tokens: 256,
        enable_thinking: false,
        reasoning_effort: 'none',
        messages: [
          {
            role: 'system',
            content: 'You are a conservative multilingual lexicographer. Return one JSON object only.'
          },
          { role: 'user', content: prompt(candidate, lastError) }
        ]
      }, timeoutMs);
      const content = String(response?.choices?.[0]?.message?.content || '');
      const parsed = parseJson(content);
      validate(parsed, candidate);
      const suggested = parsed.suggested_zh_term == null ? null : String(parsed.suggested_zh_term).trim() || null;
      const selected = parsed.selected_zh_term == null ? null : String(parsed.selected_zh_term).trim() || null;
      return {
        candidate_key: candidate.candidate_key,
        valid: true,
        decision: parsed.decision,
        confidence: Number(parsed.confidence),
        approved: parsed.decision === 'accept' && Number(parsed.confidence) >= confidenceThreshold && !suggested &&
          (candidateSet !== 'selection' || candidate.zh_terms.includes(selected)),
        reason: String(parsed.reason || '').trim(),
        risk_flags: Array.isArray(parsed.risk_flags) ? parsed.risk_flags.map(String) : [],
        suggested_zh_term: suggested,
        selected_zh_term: selected,
        attempt,
        seconds: Number(((performance.now() - started) / 1000).toFixed(3)),
        usage: response?.usage || null
      };
    } catch (error) {
      lastError = String(error?.message || error);
    }
  }
  return { candidate_key: candidate.candidate_key, valid: false, decision: null, confidence: null, approved: false, error: lastError };
}

function prompt(candidate, previousError) {
  if (candidateSet === 'selection') {
    return [
      'Select the one Simplified Chinese lemma that precisely expresses the same lexical sense as the source word and exact English anchor.',
      'You may select only from the supplied candidates. Reject when none is exact; use manual_review when the evidence is insufficient.',
      'Require the same part of speech, scope, register, and modern ordinary meaning.',
      `Source: ${candidate.word} (${candidate.source_lang})`,
      `English anchor: ${candidate.english_anchor}`,
      `Expected POS: ${candidate.expected_pos || 'unknown'}`,
      `Chinese candidates and sememes: ${JSON.stringify(candidate.term_evidence || [])}`,
      previousError ? `Previous response error: ${previousError}` : '',
      'Return exactly: {"decision":"accept|reject|manual_review","confidence":0.0,"selected_zh_term":null,"reason":"","risk_flags":[],"suggested_zh_term":null}'
    ].filter(Boolean).join('\n');
  }
  return [
    'Judge whether the proposed Simplified Chinese lemma precisely expresses the same lexical sense as the source word and exact English anchor.',
    'Apply a strict bidirectional equivalence test: the Chinese lemma in this sense must entail the English anchor, and the English anchor must identify this Chinese sense without relying on unstated context.',
    'Require the same part of speech, scope, register, domain, and modern ordinary meaning.',
    'Reject a generic English hypernym when the Chinese lemma is more specific, even if the generic word appears as one dictionary gloss.',
    'Use the complete OpenHowNet gloss list contrastively. If another gloss reveals a narrower or different core sense than the anchor, reject unless the matching glosses and sememes clearly isolate the requested sense.',
    'Reject overly broad/narrow terms, obsolete terms, domain mismatch, literal calques, non-lemma phrases, and matches that work only in one collocation.',
    'Use manual_review when ambiguity cannot be resolved from the supplied evidence.',
    `Source: ${candidate.word} (${candidate.source_lang})`,
    `English anchor: ${candidate.english_anchor}`,
    `Expected POS: ${candidate.expected_pos || 'unknown'}`,
    `Proposed zh lemma: ${candidate.zh_term}`,
    `OpenHowNet glosses matching the anchor: ${JSON.stringify(candidate.matching_glosses || [])}`,
    `All OpenHowNet glosses for the Chinese lemma: ${JSON.stringify(candidate.all_openhownet_glosses || [])}`,
    `Sememe definitions: ${JSON.stringify(candidate.sememe_definitions || [])}`,
    previousError ? `Previous response error: ${previousError}` : '',
    'Return exactly: {"decision":"accept|reject|manual_review","confidence":0.0,"reason":"","risk_flags":[],"suggested_zh_term":null}'
  ].filter(Boolean).join('\n');
}

function validate(value, candidate) {
  if (!value || !['accept', 'reject', 'manual_review'].includes(value.decision)) throw new Error('invalid_decision');
  if (!Number.isFinite(Number(value.confidence)) || Number(value.confidence) < 0 || Number(value.confidence) > 1) throw new Error('invalid_confidence');
  if (typeof value.reason !== 'string' || !value.reason.trim()) throw new Error('missing_reason');
  if (!Array.isArray(value.risk_flags)) throw new Error('invalid_risk_flags');
  if (candidateSet === 'selection' && value.decision === 'accept' && !candidate.zh_terms.includes(String(value.selected_zh_term || '').trim())) {
    throw new Error('selected_term_not_in_candidates');
  }
}

async function loadModel() {
  const started = performance.now();
  const status = await getJson('/v1/status', 30000).catch(() => ({}));
  const same = status?.active_model === model && (!variant || status?.gguf_variant === variant);
  if (!same || forceReload) {
    const body = { model_path: model, max_seq_length: maxSeqLength, load_in_4bit: false, speculative_type: 'off' };
    if (variant) body.gguf_variant = variant;
    await postJson('/v1/load', body, loadTimeoutMs);
  }
  return { skipped: same && !forceReload, seconds: Number(((performance.now() - started) / 1000).toFixed(3)) };
}

async function getJson(route, timeout) {
  const response = await fetch(`${endpoint}${route}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeout) });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function postJson(route, body, timeout) {
  const response = await fetch(`${endpoint}${route}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeout)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function parseJson(content) {
  const text = content.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '');
  try { return JSON.parse(text); } catch {
    const start = text.indexOf('{'); const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error(`json_parse_failed:${text.slice(0, 200)}`);
  }
}

function summarize() {
  return {
    total: reviews.length,
    valid: reviews.filter((r) => r.valid).length,
    accepted: reviews.filter((r) => r.decision === 'accept').length,
    approved: reviews.filter((r) => r.approved).length,
    rejected: reviews.filter((r) => r.decision === 'reject').length,
    manual_review: reviews.filter((r) => r.decision === 'manual_review').length,
    errors: reviews.filter((r) => !r.valid).length
  };
}

function writeReport() {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    ok: true, generated_at: new Date().toISOString(), research_only: true, production_publishable: false,
    generation_allowed: false, publication_evidence: false, source_report: path.relative(process.cwd(), reportPath),
    input_fingerprint: fingerprint, candidate_set: candidateSet, reviewer, endpoint, model, gguf_variant: variant || null,
    excluded_review_reports: excludeReviewPaths.map((file) => path.relative(process.cwd(), file)),
    excluded_candidate_count: excludedCandidateKeys.size,
    confidence_threshold: confidenceThreshold, prewarm, summary: summarize(), reviews
  }, null, 2), 'utf8');
}

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function loadExcludedCandidateKeys(files) {
  const keys = new Set();
  for (const file of files) {
    if (!fs.existsSync(file)) throw new Error(`Exclude review not found: ${file}`);
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const row of [...(report.reviews || []), ...(report.decisions || [])]) {
      if (row?.candidate_key) keys.add(String(row.candidate_key));
    }
  }
  return keys;
}
function parseArgs(argv) { const out = {}; for (let i = 0; i < argv.length; i++) { if (!argv[i].startsWith('--')) continue; const key = argv[i].slice(2); const next = argv[i + 1]; if (next && !next.startsWith('--')) { out[key] = next; i++; } else out[key] = true; } return out; }
function integer(value, fallback, min) { const n = Number(value ?? fallback); if (!Number.isInteger(n) || n < min) throw new Error(`Invalid integer: ${value}`); return n; }
function number(value, fallback, min, max) { const n = Number(value ?? fallback); if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Invalid number: ${value}`); return n; }
