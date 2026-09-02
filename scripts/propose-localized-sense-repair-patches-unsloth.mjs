import './lib/load-local-env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { discoverUnslothStagePool } from './lib/unsloth-cluster-discovery.mjs';

const args = parseArgs(process.argv.slice(2));
const inputPath = requiredPath(args.input, 'input');
const outPath = path.resolve(args.out || 'logs/localized-sense-repair-patches.json');
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
const concurrency = integer(args.concurrency, 2, 1);
const maxAttempts = integer(args['max-attempts'], 2, 1);
const timeoutMs = integer(args['timeout-ms'], 180_000, 1000);
const maxTokens = integer(args['max-tokens'], 2200, 200);
const selection = args.selection || 'eligible';
if (!token) throw new Error('Missing UNSLOTH_API_KEY');
if (!['primary', 'secondary'].includes(role)) throw new Error(`Invalid role: ${role}`);
if (!['eligible', 'all'].includes(selection)) throw new Error(`Invalid selection: ${selection}`);

const input = readJson(inputPath);
const candidates = role === 'primary'
  ? (selection === 'all'
      ? (input.repairs || [])
      : (input.repairs || []).filter((row) => row.evidence_summary?.eligible_for_model_patch_proposal))
  : (input.proposals || []).filter((row) => row.valid &&
      (selection === 'all' || row.decision === 'repair'));
if (!candidates.length) throw new Error('No repair candidates selected');
const discovery = await discoverUnslothStagePool({
  dashboardUrl, configuredEndpoints: fallbackEndpoints, model, token, requireInstalled: true
});
const endpoints = discovery.endpoints || fallbackEndpoints;
if (!endpoints.length) throw new Error('No endpoints available');

const proposals = [];
let next = 0;
const started = performance.now();
await Promise.all(Array.from({ length: Math.min(concurrency, endpoints.length, candidates.length) }, (_, i) => worker(endpoints[i % endpoints.length])));

async function worker(endpoint) {
  while (next < candidates.length) {
    const candidate = candidates[next++];
    const result = await withRetry(candidate, endpoint);
    proposals.push(result);
    console.log(`[${proposals.length}/${candidates.length}] sense=${candidate.sense_id || candidate.candidate?.sense_id} ${result.valid ? result.decision : 'invalid'} @ ${new URL(endpoint).port}`);
  }
}

async function withRetry(candidate, endpoint) {
  let last;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      last = await callModel(candidate, endpoint, attempt);
      if (last.valid) return last;
    } catch (error) {
      last = { valid: false, error: String(error?.message || error), endpoint, attempt, candidate };
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
      model, temperature: 0, max_tokens: maxTokens, stream: false,
      enable_thinking: false, reasoning_effort: 'none',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a conservative multilingual lexicographer. Return one JSON object only. Never modify a database.' },
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
  catch (error) { return { valid: false, error: `json_parse_failed: ${error.message}`, raw_preview: raw.slice(0, 1000), endpoint, attempt, candidate }; }
  const validation = validate(parsed, candidate, role);
  return {
    candidate_id: role === 'primary' ? `sense:${candidate.sense_id}` : candidate.candidate_id,
    sense_id: role === 'primary' ? candidate.sense_id : candidate.sense_id,
    endpoint, model, role, attempt,
    seconds: Number(((performance.now() - requestStarted) / 1000).toFixed(3)),
    valid: validation.errors.length === 0,
    validation_errors: validation.errors,
    decision: parsed.decision,
    confidence: Number(parsed.confidence),
    patches: parsed.patches || [],
    reason: parsed.reason,
    candidate: role === 'primary' ? candidate : candidate.candidate,
    primary_proposal: role === 'secondary' ? compact(candidate) : undefined
  };
}

function prompt(candidate) {
  const base = role === 'primary' ? candidate : candidate.candidate;
  const primary = role === 'secondary' ? compact(candidate) : null;
  const semanticCandidate = sanitizeCandidate(base);
  return `Review one suspected localization error using the locked product row and canonical source evidence. The historical suspicion may already have been fixed: return no_change when the current published localization is semantically valid. Sources may themselves contain mistranslations, so reason across languages and meanings. Prefer Mainland Chinese. Do not invent, broaden, merge, or substitute a different sense. A current localization whose source starts with manual: is protected and cannot be automatically replaced.\n\n` +
    (role === 'secondary'
      ? `You are the independent final reviewer. Either return the primary patch byte-for-byte in semantic JSON values, or reject it with no patches. Never edit or improve the proposed values.\nPrimary proposal:\n${JSON.stringify(primary)}\n\n`
      : `Propose an exact complete replacement only when the error and correction are clear. Preserve correct existing fields. replacement.term must exactly equal one of evidence_summary.replacement_term_candidates for that language. evidence_link_ids must identify the listed supporting links from at least two independent source families; model agreement is not source evidence. Every semantic claim in term and definition must be directly supported by the cited evidence. Do not add usage direction, register, social relation, regional restriction, grammatical role, or nuance unless the cited sources state it explicitly. For zh, use an idiomatic Mainland Chinese dictionary headword and concise definition.\n\n`) +
    `Return exactly: {"decision":"repair|no_change|manual_review","confidence":0.0,"patches":[{"sense_id":1,"lang":"zh","replacement":{"term":"...","reading":"...","reading_system":"pinyin","pronunciation":"","pronunciation_system":"","definition":"..."},"evidence_link_ids":[1],"reason":"short"}],"reason":"short"}. ` +
    `For no_change/manual_review patches must be empty. A repair must contain 1-2 patches. term and definition must be non-empty. zh/ja require reading; en/pt-BR require pronunciation. Do not include markdown.\n\nCandidate:\n${JSON.stringify(semanticCandidate)}`;
}

function validate(parsed, candidate, currentRole) {
  const errors = [];
  if (!['repair', 'no_change', 'manual_review'].includes(parsed?.decision)) errors.push('invalid_decision');
  if (!Number.isFinite(Number(parsed?.confidence)) || Number(parsed.confidence) < 0 || Number(parsed.confidence) > 1) errors.push('invalid_confidence');
  const patches = Array.isArray(parsed?.patches) ? parsed.patches : [];
  if (parsed?.decision === 'repair' && (patches.length < 1 || patches.length > 2)) errors.push('invalid_patch_count');
  if (parsed?.decision !== 'repair' && patches.length) errors.push('patches_for_non_repair');
  const base = currentRole === 'primary' ? candidate : candidate.candidate;
  const validLinkIds = new Set((base.source_evidence || []).filter((row) => row.link_valid).map((row) => row.link_id));
  const trustedLinkIds = new Set((base.source_evidence || []).filter((row) => row.link_valid && !row.source_needs_review).map((row) => row.link_id));
  const familyByLinkId = new Map((base.source_evidence || []).filter((row) => row.link_valid && !row.source_needs_review)
    .map((row) => [Number(row.link_id), row.source_family]));
  const currentLangs = new Set((base.product_localizations || []).map((row) => row.lang));
  const replacementCandidates = base.evidence_summary?.replacement_term_candidates || {};
  for (const patch of patches) {
    if (Number(patch.sense_id) !== Number(base.sense_id)) errors.push('sense_id_mismatch');
    if (!currentLangs.has(patch.lang)) errors.push('unknown_language');
    if (!patch.replacement?.term || !patch.replacement?.definition) errors.push('missing_term_or_definition');
    const replacementCandidate = (replacementCandidates[patch.lang] || [])
      .find((row) => normalizeTerm(row.term) === normalizeTerm(patch.replacement?.term));
    if (!replacementCandidate) errors.push('replacement_term_not_in_locked_candidates');
    if (['zh', 'ja'].includes(patch.lang) && !patch.replacement?.reading) errors.push('missing_reading');
    if (['en', 'pt-BR'].includes(patch.lang) && !patch.replacement?.pronunciation) errors.push('missing_pronunciation');
    if (!Array.isArray(patch.evidence_link_ids) || !patch.evidence_link_ids.length || patch.evidence_link_ids.some((id) => !validLinkIds.has(Number(id)))) errors.push('invalid_evidence_link_ids');
    if (!patch.evidence_link_ids?.some((id) => trustedLinkIds.has(Number(id)))) errors.push('missing_trusted_evidence_link');
    const citedFamilies = new Set((patch.evidence_link_ids || []).map((id) => familyByLinkId.get(Number(id))).filter(Boolean));
    const authoritativeSingleSource = replacementCandidate?.support_policy === 'semantically_aligned_authoritative_source' &&
      citedFamilies.size >= 1 && [...citedFamilies].every(isAuthoritativeFamily);
    if (citedFamilies.size < 2 && !authoritativeSingleSource) errors.push('insufficient_cited_source_families');
    const current = (base.product_localizations || []).find((row) => row.lang === patch.lang);
    if (String(current?.source || '').startsWith('manual:')) errors.push('protected_manual_localization');
    if (current && sameLocalization(current, patch.replacement)) errors.push('no_op_patch');
  }
  if (currentRole === 'secondary' && parsed?.decision === 'repair' &&
      canonical(approvalPayload(patches)) !== canonical(approvalPayload(candidate.patches))) {
    errors.push('secondary_modified_patch');
  }
  if (currentRole === 'secondary' && parsed?.decision !== 'manual_review' &&
      parsed?.decision !== candidate.decision) {
    errors.push('secondary_decision_mismatch');
  }
  return { errors: [...new Set(errors)] };
}

function isAuthoritativeFamily(family) {
  return ['cc-cedict', 'jmdict', 'wordnet', 'freedict'].includes(family);
}

const output = {
  ok: proposals.every((row) => row.valid), final: true, role, model, selection,
  created_at: new Date().toISOString(), input: path.relative(process.cwd(), inputPath),
  database_write: false, discovery, seconds: Number(((performance.now() - started) / 1000).toFixed(3)),
  summary: { selected: candidates.length, valid: proposals.filter((row) => row.valid).length,
    repair: proposals.filter((row) => row.valid && row.decision === 'repair').length,
    no_change: proposals.filter((row) => row.valid && row.decision === 'no_change').length,
    manual_review: proposals.filter((row) => row.valid && row.decision === 'manual_review').length },
  proposals
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: output.ok, out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2));
process.exitCode = output.ok ? 0 : 2;

function compact(row) { return { candidate_id: row.candidate_id, sense_id: row.sense_id, decision: row.decision, confidence: row.confidence, patches: row.patches, reason: row.reason }; }
function sanitizeCandidate(row) {
  return {
    sense_id: row.sense_id,
    headword: row.headword,
    query_forms: row.query_forms,
    product_sense: row.product_sense,
    product_localizations: row.product_localizations,
    evidence_summary: row.evidence_summary,
    source_evidence: (row.source_evidence || []).map((source) => ({
      link_id: source.link_id,
      source_family: source.source_family,
      link_valid: source.link_valid,
      source_needs_review: source.source_needs_review,
      source_word: source.source_word,
      source_lang: source.source_lang,
      part_of_speech: source.part_of_speech,
      gloss_key: source.gloss_key,
      localizations: source.localizations
    }))
  };
}
function sameLocalization(current, replacement) {
  return ['term', 'reading', 'reading_system', 'pronunciation', 'pronunciation_system', 'definition']
    .every((key) => String(current?.[key] || '') === String(replacement?.[key] || ''));
}
function normalizeTerm(value) { return String(value || '').normalize('NFKC').trim().toLocaleLowerCase(); }
function approvalPayload(patches) {
  return (patches || []).map((patch) => ({
    sense_id: Number(patch.sense_id),
    lang: patch.lang,
    replacement: patch.replacement,
    evidence_link_ids: [...(patch.evidence_link_ids || [])].map(Number).sort((a, b) => a - b)
  }));
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function parseJson(text) { const cleaned=String(text).trim().replace(/^```(?:json)?\s*/iu,'').replace(/\s*```$/u,''); const a=cleaned.indexOf('{'), b=cleaned.lastIndexOf('}'); if(a<0||b<a) throw new Error('JSON object not found'); return JSON.parse(cleaned.slice(a,b+1)); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function requiredPath(value, name) { if (!value) throw new Error(`Missing --${name}`); const file=path.resolve(value); if(!fs.existsSync(file)) throw new Error(`File not found: ${file}`); return file; }
function integer(value, fallback, minimum) { const parsed=value==null?fallback:Number(value); if(!Number.isInteger(parsed)||parsed<minimum) throw new Error(`Invalid integer: ${value}`); return parsed; }
function parseArgs(argv) { const out={}; for(let i=0;i<argv.length;i++){if(!argv[i].startsWith('--'))continue; const key=argv[i].slice(2),next=argv[i+1]; out[key]=next&&!next.startsWith('--')?argv[++i]:'true';} return out; }
