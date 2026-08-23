import './lib/load-local-env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import Database from 'better-sqlite3';
import * as OpenCC from 'opencc-js';
import {
  validateDefinitionContract,
  validateSourceReviewEnvelope
} from './lib/source-review-contract.mjs';
import {
  matchBlindSourceAnchor,
  normalizeBlindSenses
} from './lib/blind-source-anchor.mjs';
import { ensureUnslothModel } from './lib/unsloth-elastic-model.mjs';

const DEFAULT_REPORT = 'logs/product-coverage-gaps-v83-after-tier-b-complete-strict.json';
const DEFAULT_OUT = 'logs/product-source-gap-candidate-evidence-review.json';
const DEFAULT_ENDPOINTS = ['http://100.99.99.99:11441', 'http://100.99.99.99:11447'];
const DEFAULT_MODEL = 'unsloth/Qwen3.6-35B-A3B-MTP-GGUF';
const DEFAULT_VARIANTS = { 11441: 'UD-Q4_K_XL', 11447: 'UD-IQ4_NL' };
const DECISIONS = new Set(['accept', 'reject', 'manual_review']);
const traditionalToSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });

const args = parseArgs(process.argv.slice(2));
const reportPath = path.resolve(args.report || DEFAULT_REPORT);
const outPath = path.resolve(args.out || DEFAULT_OUT);
const approvedOutPath = path.resolve(args['approved-out'] || outPath.replace(/\.json$/u, '-approved.json'));
const rejectedOutPath = path.resolve(args['rejected-out'] || outPath.replace(/\.json$/u, '-rejected.json'));
const token = args.token || process.env.UNSLOTH_API_KEY;
const endpoints = String(args.endpoints || DEFAULT_ENDPOINTS.join(','))
  .split(',')
  .map((value) => value.trim().replace(/\/$/u, ''))
  .filter(Boolean);
const model = String(args.model || DEFAULT_MODEL);
const sourceDbPath = path.resolve(args['source-db'] || 'data/processed/linguago_v2_full.db');
const limit = boundedInteger(args.limit, 20, 1);
const offset = boundedInteger(args.offset, 0, 0);
const confidenceThreshold = boundedNumber(args['confidence-threshold'], 0.9, 0, 1);
const timeoutMs = boundedInteger(args['timeout-ms'], 120_000, 1_000);
const maxTokens = boundedInteger(args['max-tokens'], 320, 100);
const maxAttempts = boundedInteger(args['max-attempts'], 2, 1, 4);
const checkpointEvery = boundedInteger(args['checkpoint-every'], 20, 1);
const checkpointIntervalMs = boundedInteger(args['checkpoint-interval-ms'], 10_000, 1_000);
const circuitBreakerFailures = boundedInteger(args['circuit-breaker-failures'], 2, 1, 20);
const circuitBreakerResetMs = boundedInteger(args['circuit-breaker-reset-ms'], 30_000, 1_000, 600_000);
const resume = args.resume === 'true';
const retryInvalidOnResume = args['retry-invalid-on-resume'] === 'true';
const retryDecisionsOnResume = new Set(
  String(args['retry-decisions'] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);
for (const decision of retryDecisionsOnResume) {
  if (!DECISIONS.has(decision)) throw new Error(`Invalid --retry-decisions value: ${decision}`);
}
const stopAfterApproved = boundedInteger(args['stop-after-approved'], Number.MAX_SAFE_INTEGER, 1);
const prewarm = args.prewarm !== 'false';
const forceReload = args['force-reload'] === 'true';
const unloadBeforeLoad = args['unload-before-load'] === 'true';
const loadTimeoutMs = boundedInteger(args['load-timeout-ms'], 300_000, 1_000);
const maxSeqLength = boundedInteger(args['max-seq-length'], 1024, 512);
const speculativeType = String(args['speculative-type'] || 'off');
const promptMode = String(args['prompt-mode'] || 'compact');
const variants = { ...DEFAULT_VARIANTS, ...parseEndpointVariants(args['endpoint-gguf-variants']) };
const debugPromptPath = args['debug-prompt-out'] ? path.resolve(args['debug-prompt-out']) : null;
const debugPromptOnly = args['debug-prompt-only'] === 'true';
const requireSenseAlignment = args['require-sense-alignment'] === 'true';
const requireHintSemanticAlignment = args['require-hint-semantic-alignment'] === 'true';
const requireDefinitionContract = args['require-definition-contract'] === 'true';
const requireDailyPrimary = args['require-daily-primary'] === 'true';
const blindSourceAnchor = args['blind-source-anchor'] === 'true';
const blindSemanticMatch = args['blind-semantic-match'] !== 'false';
const stream = args.stream === 'true';
const responseFormat = String(args['response-format'] || 'none').trim().toLowerCase();
const excludeReviewPaths = String(args['exclude-reviews'] || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => path.resolve(value));
const excludeReviewKey = String(args['exclude-review-key'] || 'entry');

if (!['entry', 'candidate'].includes(excludeReviewKey)) {
  throw new Error(`Invalid --exclude-review-key: ${excludeReviewKey}`);
}
if (!['none', 'json-object'].includes(responseFormat)) {
  throw new Error(`Invalid --response-format: ${responseFormat}`);
}

if (!fs.existsSync(reportPath)) throw new Error(`Coverage report not found: ${reportPath}`);
if (!token) throw new Error('Missing --token or UNSLOTH_API_KEY');
if (!endpoints.length) throw new Error('No endpoints configured');

const sourceDb = fs.existsSync(sourceDbPath) ? new Database(sourceDbPath, { readonly: true, fileMustExist: true }) : null;
const findCorroboratingEvidence = sourceDb?.prepare(`
  SELECT ds.source_key, ss.raw_json
  FROM source_entries se
  JOIN dictionary_sources ds ON ds.id = se.source_id
  JOIN source_senses ss ON ss.source_entry_id = se.id
  WHERE se.lang = ? AND se.normalized_key = ? AND ds.source_key LIKE 'wikdict-%'
  ORDER BY ds.source_key, ss.sense_order, ss.id
`);

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const excludedReviews = excludeReviewPaths.flatMap((filePath) => {
  if (!fs.existsSync(filePath)) throw new Error(`Excluded review report not found: ${filePath}`);
  const excluded = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return Array.isArray(excluded.reviews) ? excluded.reviews : [];
});
const excludedCandidateKeys = new Set(excludedReviews.map(candidateKey));
const excludedEntryIds = new Set(excludedReviews.map((row) => Number(row.source_entry_id)).filter(Number.isInteger));
const allCandidates = (Array.isArray(report.selected) ? report.selected : [])
  .filter((row) =>
    excludeReviewKey === 'candidate'
      ? !excludedCandidateKeys.has(candidateKey(row))
      : !excludedEntryIds.has(Number(row.source_entry_id))
  );
if (!allCandidates.length) throw new Error('Coverage report has no selected rows');
if (blindSourceAnchor) {
  const nonEnglish = allCandidates.filter((row) => row.source_lang !== 'en');
  if (nonEnglish.length) {
    throw new Error(`Blind source-anchor mode accepts only English source candidates; found ${nonEnglish.length} others`);
  }
}
if (requireSenseAlignment) {
  const unaligned = allCandidates.filter(
    (row) =>
      row?.sense_alignment?.status !== 'aligned' ||
      Number(row?.sense_alignment?.aligned_sense_id) !== Number(row?.first_sense_id)
  );
  if (unaligned.length) {
    throw new Error(
      `Coverage report contains ${unaligned.length} unaligned candidates; run ` +
        'dict:v2:coverage:align-source-gap-senses first'
    );
  }
}

const existingReviews = resume ? loadExistingReviews(outPath) : [];
// A completed invalid review has already exhausted maxAttempts. Replaying it on
// every resume wastes model time; make that retry an explicit recovery action.
const reusableReviews = existingReviews.filter(
  (row) =>
    !retryDecisionsOnResume.has(row?.decision) &&
    (row?.valid === true || !retryInvalidOnResume)
);
const completedIds = new Set(reusableReviews.map(candidateKey));
const targetCandidates = allCandidates.slice(offset, offset + limit);
const targetCandidateOrder = new Map(
  targetCandidates.map((row, index) => [candidateKey(row), index])
);
const pendingCandidates = targetCandidates.filter((row) => !completedIds.has(candidateKey(row)));
if (debugPromptPath && targetCandidates.length) {
  const payload = compactPayload(targetCandidates[0]);
  const prompt = buildPrompt(payload, null);
  fs.mkdirSync(path.dirname(debugPromptPath), { recursive: true });
  fs.writeFileSync(
    debugPromptPath,
    `${JSON.stringify(
      {
        source_entry_id: Number(targetCandidates[0].source_entry_id),
        payload,
        prompt,
        prompt_chars: prompt.length,
        prompt_utf8_bytes: Buffer.byteLength(prompt, 'utf8')
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  if (debugPromptOnly) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          debug_prompt_out: path.relative(process.cwd(), debugPromptPath),
          prompt_chars: prompt.length,
          prompt_utf8_bytes: Buffer.byteLength(prompt, 'utf8')
        },
        null,
        2
      )
    );
    sourceDb?.close();
    process.exit(0);
  }
}
const started = performance.now();
let reviews = [
  ...reusableReviews.filter((row) =>
    targetCandidates.some((candidate) => candidateKey(candidate) === candidateKey(row))
  )
];
const prewarmResults = prewarm ? await prewarmEndpoints() : [];

if (prewarm && prewarmResults.every((row) => !row.ok)) {
  throw new Error(
    `All endpoints failed prewarm: ${prewarmResults.map((row) => `${endpointPort(row.endpoint)}=${row.error}`).join('; ')}`
  );
}
const activeEndpoints = prewarm
  ? prewarmResults.filter((row) => row.ok).map((row) => row.endpoint)
  : endpoints;
const endpointRuntimeStates = new Map(
  activeEndpoints.map((endpoint) => [
    endpoint,
    {
      endpoint,
      calls: 0,
      failures: 0,
      timeouts: 0,
      consecutiveFailures: 0,
      circuitOpens: 0,
      recoveries: 0,
      openUntil: 0,
      inFlight: 0
    }
  ])
);

await runPool(pendingCandidates);
writeOutputs();
sourceDb?.close();

const finalOutput = buildOutput();
console.log(
  JSON.stringify(
    {
      ok: finalOutput.ok,
      out: path.relative(process.cwd(), outPath),
      approved_out: path.relative(process.cwd(), approvedOutPath),
      rejected_out: path.relative(process.cwd(), rejectedOutPath),
      summary: finalOutput.summary
    },
    null,
    2
  )
);

async function runPool(rows) {
  let nextIndex = 0;
  let completedSinceWrite = 0;
  let lastWriteAt = performance.now();

  async function worker(workerIndex) {
    while (nextIndex < rows.length && approvedReviewCount() < stopAfterApproved) {
      const row = rows[nextIndex++];
      const review = await reviewWithRetry(row, workerIndex);
      reviews.push(review);
      completedSinceWrite += 1;
      console.log(
        `[${reviews.length}/${targetCandidates.length}] source=${row.source_entry_id} ${row.word} ` +
          `decision=${review.valid ? review.decision : 'error'} confidence=${review.confidence ?? '-'} ` +
          `endpoint=${review.endpoint ? endpointPort(review.endpoint) : '-'}`
      );
      if (
        completedSinceWrite >= checkpointEvery ||
        performance.now() - lastWriteAt >= checkpointIntervalMs
      ) {
        writeOutputs();
        completedSinceWrite = 0;
        lastWriteAt = performance.now();
      }
    }
  }

  await Promise.all(activeEndpoints.map((_, index) => worker(index)));
}

function approvedReviewCount() {
  return reviews.filter((row) => row?.approved === true).length;
}

async function reviewWithRetry(row, startEndpointIndex) {
  let lastError = null;
  const endpointAttempts = [];
  const attemptLimit = Math.max(maxAttempts, activeEndpoints.length);
  const attemptedEndpoints = new Set();
  for (let attempt = 1; attempt <= attemptLimit; attempt++) {
    const endpoint = await acquireEndpoint(startEndpointIndex, attemptedEndpoints);
    if (!endpoint) break;
    attemptedEndpoints.add(endpoint);
    const state = endpointRuntimeStates.get(endpoint);
    state.calls += 1;
    try {
      const review = await reviewRow(row, endpoint, attempt, lastError);
      state.consecutiveFailures = 0;
      return review;
    } catch (error) {
      lastError = errorMessage(error);
      endpointAttempts.push({ endpoint, attempt, error: lastError });
      if (isInfrastructureError(error)) {
        state.failures += 1;
        state.consecutiveFailures += 1;
        if (isTimeoutError(error)) state.timeouts += 1;
        if (state.consecutiveFailures >= circuitBreakerFailures) {
          state.openUntil = Date.now() + circuitBreakerResetMs;
          state.circuitOpens += 1;
        }
      }
    } finally {
      state.inFlight = Math.max(0, state.inFlight - 1);
    }
  }
  return {
    source_entry_id: Number(row.source_entry_id),
    source_sense_id: Number(row.first_sense_id ?? row.source_sense_id) || null,
    word: row.word,
    source_lang: row.source_lang,
    valid: true,
    decision: 'manual_review',
    confidence: 0,
    approved: false,
    endpoint: null,
    reason: 'All healthy model endpoints returned invalid or failed responses.',
    risk_flags: ['model_review_failed_all_endpoints'],
    endpoint_attempts: endpointAttempts,
    error: lastError
  };
}

async function acquireEndpoint(startEndpointIndex, attemptedEndpoints) {
  while (attemptedEndpoints.size < activeEndpoints.length) {
    const now = Date.now();
    for (let offset = 0; offset < activeEndpoints.length; offset++) {
      const endpoint = activeEndpoints[(startEndpointIndex + offset) % activeEndpoints.length];
      if (attemptedEndpoints.has(endpoint)) continue;
      const state = endpointRuntimeStates.get(endpoint);
      if (state.openUntil && state.openUntil <= now) {
        state.openUntil = 0;
        state.consecutiveFailures = 0;
        state.recoveries += 1;
      }
      if (state.openUntil > now || state.inFlight > 0) continue;
      state.inFlight += 1;
      return endpoint;
    }
    await delay(25);
  }
  return null;
}

function isInfrastructureError(error) {
  const message = errorMessage(error).toLowerCase();
  return (
    isTimeoutError(error) ||
    message.includes('fetch failed') ||
    message.includes('econn') ||
    message.includes('socket') ||
    message.includes('network') ||
    message.includes('no model loaded') ||
    message.includes('model_not_loaded') ||
    /http 5\d\d/u.test(message)
  );
}

function isTimeoutError(error) {
  const message = errorMessage(error).toLowerCase();
  return error?.name === 'TimeoutError' || error?.name === 'AbortError' || message.includes('timeout');
}

async function reviewRow(row, endpoint, attempt, previousError) {
  const requestStarted = performance.now();
  const payload = compactPayload(row);
  if (blindSourceAnchor) {
    return reviewRowBlindSourceAnchor(payload, row, endpoint, attempt, previousError, requestStarted);
  }
  if (promptMode === 'nano-per-language') {
    return reviewRowNanoPerLanguage(payload, row, endpoint, attempt, previousError, requestStarted);
  }
  const data = await postJson(
    endpoint,
    '/v1/chat/completions',
    {
      model,
      stream,
      temperature: 0,
      max_tokens: maxTokens,
      enable_thinking: false,
      reasoning_effort: 'none',
      ...(responseFormat === 'json-object' ? { response_format: { type: 'json_object' } } : {}),
      messages:
        promptMode === 'micro' || promptMode === 'nano'
          ? [{ role: 'user', content: buildPrompt(payload, previousError) }]
          : [
              {
                role: 'system',
                content:
                  'You are a conservative multilingual lexicographer screening noisy open-dictionary evidence. ' +
                  'Judge only whether the proposed sense is real for the source-language headword. Return JSON only.'
              },
              { role: 'user', content: buildPrompt(payload, previousError) }
            ]
    },
    timeoutMs
  );
  const content = String(data?.choices?.[0]?.message?.content || '');
  const parsed = parseJson(content);
  const errors = validateReview(parsed, row);
  const unboundErrors = errors.filter((error) => error.startsWith('missing_evidence_bound_preferred_term_'));
  const blockingErrors = errors.filter((error) => !error.startsWith('missing_evidence_bound_preferred_term_'));
  if (blockingErrors.length) {
    throw new Error(`invalid_review:${blockingErrors.join(',')}; raw=${content.slice(0, 300)}`);
  }
  const evidenceBound = unboundErrors.length === 0;
  const decision = evidenceBound ? parsed.decision : 'manual_review';
  const confidence = evidenceBound ? parsed.confidence : 0;
  const unboundLangs = unboundErrors.map((error) => error.slice('missing_evidence_bound_preferred_term_'.length));
  return {
    source_entry_id: Number(row.source_entry_id),
    source_sense_id: Number(row.first_sense_id ?? row.source_sense_id) || null,
    word: row.word,
    source_lang: row.source_lang,
    frequency_rank: row.frequency_rank ?? null,
    gloss_key: row.gloss_key,
    endpoint,
    attempt,
    seconds: secondsSince(requestStarted),
    usage: data.usage || null,
    valid: true,
    decision,
    confidence,
    approved: decision === 'accept' && confidence >= confidenceThreshold,
    english_anchor:
      typeof parsed.english_anchor === 'string' && parsed.english_anchor.trim()
        ? parsed.english_anchor.trim()
        : null,
    reason: evidenceBound
      ? parsed.reason
      : `Preferred terms lack locked independent evidence: ${unboundLangs.join(', ')}.`,
    evidence: parsed.evidence,
    risk_flags: [
      ...(Array.isArray(parsed.risk_flags) ? parsed.risk_flags : []),
      ...(evidenceBound ? [] : unboundLangs.map((lang) => `unbound_preferred_term_${lang}`))
    ],
    preferred_terms: normalizePreferredTerms(parsed.preferred_terms),
    definition_contract: normalizeDefinitionContract(parsed.definition_contract),
    raw_preview: content.slice(0, 800)
  };
}

async function reviewRowBlindSourceAnchor(payload, row, endpoint, attempt, previousError, requestStarted) {
  const input = {
    headword: payload.headword,
    source_language: payload.source_language,
    part_of_speech: payload.part_of_speech
  };
  const prompt = `Without seeing any proposed translation or dictionary gloss, list established modern English dictionary senses of this headword. Include common, secondary, regional, and technical senses when genuinely lexicalized. Give concise English anchors and useful synonymous locator terms. Do not guess from another language and do not include proper names unless the lowercase word itself has that lexical sense. Return JSON only: {"senses":[{"anchor":"concise sense label","part_of_speech":"noun|verb|adjective|adverb|other","aliases":["synonym"],"commonness":"common|secondary|regional|technical"}]} Input=${JSON.stringify(input)}${previousError ? ' Previous output was invalid; return complete JSON only.' : ''}`;
  const data = await postJson(
    endpoint,
    '/v1/chat/completions',
    {
      model,
      stream,
      temperature: 0,
      max_tokens: Math.max(maxTokens, 520),
      enable_thinking: false,
      reasoning_effort: 'none',
      ...(responseFormat === 'json-object' ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        {
          role: 'system',
          content: 'You are an English lexicographer. Work independently from candidate translations. Return JSON only.'
        },
        { role: 'user', content: prompt }
      ]
    },
    timeoutMs
  );
  const content = String(data?.choices?.[0]?.message?.content || '');
  const parsed = parseJson(content);
  const senses = normalizeBlindSenses(parsed?.senses);
  if (!senses.length) throw new Error(`invalid_blind_senses; raw=${content.slice(0, 300)}`);
  const deterministicMatch = matchBlindSourceAnchor(row, senses);
  let match = deterministicMatch;
  let semanticMatch = null;
  if (blindSemanticMatch && match.candidate_terms.length) {
    semanticMatch = await matchLockedBlindSenses(
      match.candidate_terms,
      senses,
      endpoint,
      previousError
    );
    if (semanticMatch.matched) {
      const sense = senses[semanticMatch.match_index];
      match = {
        matched: true,
        reason: 'locked_blind_anchor_semantic_match',
        candidate_terms: match.candidate_terms,
        matched_candidate: semanticMatch.candidate_term,
        matched_alias: sense.anchor,
        score: semanticMatch.confidence,
        sense
      };
    } else {
      match = {
        matched: false,
        reason: semanticMatch.reason || 'locked_blind_anchor_semantic_mismatch',
        candidate_terms: deterministicMatch.candidate_terms,
        best_score: deterministicMatch.score ?? deterministicMatch.best_score ?? 0
      };
    }
  }
  const decision = match.matched ? 'accept' : 'reject';
  const confidence = match.matched ? 0.95 : 0.9;
  const suggestedTerms = Object.fromEntries(
    ['en', 'pt-BR', 'zh', 'ja'].map((lang) => [
      lang,
      lang === row.source_lang
        ? String(row.word || '').trim() || null
        : String(row?.generation_hints?.[lang]?.terms?.[0] || '').trim() || null
    ])
  );
  return {
    source_entry_id: Number(row.source_entry_id),
    source_sense_id: Number(row.first_sense_id ?? row.source_sense_id) || null,
    word: row.word,
    source_lang: row.source_lang,
    frequency_rank: row.frequency_rank ?? null,
    gloss_key: row.gloss_key,
    endpoint,
    attempt,
    seconds: secondsSince(requestStarted),
    usage: data.usage || null,
    valid: true,
    decision,
    confidence,
    approved: decision === 'accept' && confidence >= confidenceThreshold,
    english_anchor: match.matched ? match.sense.anchor : null,
    reason: match.reason,
    evidence: match.matched
      ? [`blind anchor alias ${match.matched_alias} matches candidate locator ${match.matched_candidate}`]
      : ['blind sense inventory has no exact candidate locator'],
    risk_flags: match.matched ? [] : ['blind_anchor_mismatch'],
    preferred_terms: normalizePreferredTerms(suggestedTerms),
    definition_contract: null,
    blind_source_anchor: {
      candidate_terms: match.candidate_terms,
      matched_alias: match.matched_alias || null,
      score: match.score ?? match.best_score ?? 0,
      senses
    },
    blind_semantic_match: semanticMatch,
    raw_preview: content.slice(0, 800)
  };
}

async function matchLockedBlindSenses(candidateTerms, senses, endpoint, previousError) {
  const lockedSenses = senses.map((sense, index) => ({
    index,
    anchor: sense.anchor,
    part_of_speech: sense.part_of_speech,
    aliases: sense.aliases
  }));
  const prompt = `The sense inventory below was created without seeing the candidate locator terms and is now immutable. Decide whether any candidate term is itself an established ENGLISH word or phrase expressing exactly one locked sense. A Portuguese, Chinese, Japanese, proper-name-only, malformed, or mixed-language locator must be rejected even when you know its translation. Do not add, broaden, reinterpret, or infer a new sense. Reject broad/narrow, different referent, different grammatical role, or merely related terms. confidence must be at least 0.95 only for exact lexical equivalence. Return JSON only: {"match_index":null,"candidate_term":null,"candidate_language":"en|other|unknown","confidence":0,"reason":"short"} Input=${JSON.stringify({ candidate_terms: candidateTerms, locked_senses: lockedSenses })}${previousError ? ' Return complete JSON only.' : ''}`;
  const data = await postJson(
    endpoint,
    '/v1/chat/completions',
    {
      model,
      stream,
      temperature: 0,
      max_tokens: 220,
      enable_thinking: false,
      reasoning_effort: 'none',
      ...(responseFormat === 'json-object' ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        {
          role: 'system',
          content: 'Compare only against the locked blind sense inventory. Never invent another sense. Return JSON only.'
        },
        { role: 'user', content: prompt }
      ]
    },
    timeoutMs
  );
  const content = String(data?.choices?.[0]?.message?.content || '');
  const parsed = parseJson(content);
  const matchIndex = parsed?.match_index == null ? null : Number(parsed.match_index);
  const candidateTerm = parsed?.candidate_term == null ? null : String(parsed.candidate_term).trim();
  const candidateLanguage = String(parsed?.candidate_language || '').trim().toLowerCase();
  const confidence = Number(parsed?.confidence);
  const validIndex = Number.isInteger(matchIndex) && matchIndex >= 0 && matchIndex < senses.length;
  const validCandidate = candidateTerms.includes(String(candidateTerm || '').normalize('NFKC').toLocaleLowerCase('en'));
  const matched = validIndex && validCandidate && candidateLanguage === 'en' && Number.isFinite(confidence) && confidence >= 0.95;
  return {
    matched,
    match_index: matched ? matchIndex : null,
    candidate_term: matched ? candidateTerm : null,
    candidate_language: candidateLanguage || 'unknown',
    confidence: Number.isFinite(confidence) ? confidence : 0,
    reason: String(parsed?.reason || '').trim(),
    raw_preview: content.slice(0, 400)
  };
}

async function reviewRowNanoPerLanguage(payload, row, endpoint, attempt, previousError, requestStarted) {
  const reviews = [];
  for (const lang of ['en', 'pt-BR', 'zh', 'ja']) {
    const candidates = nanoLanguageCandidates(payload, lang);
    if (!candidates.length) {
      reviews.push({ lang, decision: 'reject', confidence: 1, term: null, definition: '', reason: 'missing_term' });
      continue;
    }
    const prompt = buildNanoLanguagePrompt(payload, lang, candidates, previousError);
    const data = await postJson(
      endpoint,
      '/v1/chat/completions',
      {
        model,
        stream,
        temperature: 0,
        max_tokens: maxTokens,
        enable_thinking: false,
        reasoning_effort: 'none',
        ...(responseFormat === 'json-object' ? { response_format: { type: 'json_object' } } : {}),
        messages: [{ role: 'user', content: prompt }]
      },
      timeoutMs
    );
    const content = String(data?.choices?.[0]?.message?.content || '');
    const parsed = parseJson(content);
    let decision = String(parsed?.decision || '');
    const confidence = Number(parsed?.confidence);
    let term = parsed?.term == null ? null : String(parsed.term).trim();
    if (!DECISIONS.has(decision)) throw new Error(`invalid_language_decision_${lang}`);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new Error(`invalid_language_confidence_${lang}`);
    }
    if (decision === 'accept' && (!term || !candidates.includes(term))) {
      throw new Error(`invalid_language_term_${lang}`);
    }
    let deterministicReason = '';
    if (decision === 'accept' && lang === 'pt-BR' && isNonLemmaPtClitic(term, payload)) {
      decision = 'reject';
      term = null;
      deterministicReason = 'non_lemma_clitic_form';
    }
    reviews.push({
      lang,
      decision,
      confidence,
      term: decision === 'accept' ? term : null,
      definition: decision === 'accept' ? String(parsed?.definition || '').trim() : '',
      reason: deterministicReason || String(parsed?.reason || '').trim(),
      usage: data.usage || null,
      raw_preview: content.slice(0, 500)
    });
  }

  const rejected = reviews.filter((item) => item.decision === 'reject');
  const manual = reviews.filter((item) => item.decision === 'manual_review');
  const decision = rejected.length ? 'reject' : manual.length ? 'manual_review' : 'accept';
  const confidence = Math.min(...reviews.map((item) => item.confidence));
  const preferredTerms = Object.fromEntries(reviews.map((item) => [item.lang, item.term]));
  const definitionContract = Object.fromEntries(
    reviews.map((item) => [item.lang, item.definition || null])
  );
  const combinedReview = {
    decision,
    confidence,
    english_anchor: preferredTerms.en || String(payload.proposed_gloss || '').trim(),
    reason: reviews.map((item) => `${item.lang}:${item.reason || item.decision}`).join('; '),
    evidence: reviews.map((item) => `${item.lang}:${item.term || item.decision}`),
    risk_flags: reviews
      .filter((item) => item.decision !== 'accept')
      .map((item) => `${item.lang}_${item.decision}`),
    preferred_terms: normalizePreferredTerms(preferredTerms),
    definition_contract: normalizeDefinitionContract(definitionContract)
  };
  const combinedErrors = validateReview(combinedReview, row);
  if (combinedErrors.length) {
    throw new Error(`invalid_combined_review:${combinedErrors.join(',')}`);
  }
  return {
    source_entry_id: Number(row.source_entry_id),
    source_sense_id: Number(row.first_sense_id ?? row.source_sense_id) || null,
    word: row.word,
    source_lang: row.source_lang,
    frequency_rank: row.frequency_rank ?? null,
    gloss_key: row.gloss_key,
    endpoint,
    attempt,
    seconds: secondsSince(requestStarted),
    usage: mergeUsage(reviews.map((item) => item.usage)),
    valid: true,
    decision,
    confidence,
    approved: decision === 'accept' && confidence >= confidenceThreshold,
    ...combinedReview,
    language_reviews: reviews
  };
}

function isNonLemmaPtClitic(term, payload) {
  const value = String(term || '').trim();
  if (!/-(?:me|te|se|lhe|nos|vos|lhes)$/iu.test(value)) return false;
  return payload.source_language !== 'pt-BR' || value !== String(payload.headword || '').trim();
}

function nanoLanguageCandidates(payload, lang) {
  const supplied = payload.verified_translation_hints?.[lang]?.terms;
  if (Array.isArray(supplied) && supplied.length) {
    const seen = new Set();
    return supplied
      .map((value) => {
        const term = String(value).trim();
        return lang === 'zh' ? traditionalToSimplified(term) : term;
      })
      .filter((value) => {
        const key = value.toLocaleLowerCase(lang === 'pt-BR' ? 'pt-BR' : undefined);
        if (!value || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 3);
  }
  if (lang === payload.source_language && payload.headword) return [String(payload.headword)];
  if (lang === 'en' && payload.proposed_gloss) return [String(payload.proposed_gloss).split(/[;,]/u)[0].trim()];
  return [];
}

function buildNanoLanguagePrompt(payload, lang, candidates, previousError) {
  const input = {
    source_word: payload.headword,
    source_lang: payload.source_language,
    sense: payload.proposed_gloss,
    target_lang: lang,
    candidates
  };
  const definitionRule = requireDefinitionContract
    ? ` If accepting, definition must be a nonempty natural ${lang} dictionary definition for this exact sense and grammatical role; never copy the English gloss into another language.`
    : '';
  return `I=${JSON.stringify(input)} Pick the closest neutral candidate only if sense, POS, grammatical form, perspective, number, register and scope match; ignore bad alternatives. If accepting, copy term exactly from candidates; never paraphrase or invent one.${definitionRule} Reject if none; manual if ambiguous. For pt-BR reject pt-PT-only usage. For zh require neutral Mainland usage; allow Taiwan-only usage only when no Mainland equivalent exists. reason<=8 words. JSON only {"decision":"accept|reject|manual_review","confidence":0,"term":null,"definition":"","reason":""}${previousError ? ' Previous output was invalid; return complete JSON only.' : ''}`;
}

function mergeUsage(usages) {
  const valid = usages.filter(Boolean);
  if (!valid.length) return null;
  return {
    prompt_tokens: valid.reduce((sum, item) => sum + Number(item.prompt_tokens || 0), 0),
    completion_tokens: valid.reduce((sum, item) => sum + Number(item.completion_tokens || 0), 0),
    total_tokens: valid.reduce((sum, item) => sum + Number(item.total_tokens || 0), 0)
  };
}

function normalizePreferredTerms(preferredTerms) {
  return {
    ...preferredTerms,
    zh:
      typeof preferredTerms?.zh === 'string' && preferredTerms.zh.trim()
        ? traditionalToSimplified(preferredTerms.zh.trim())
        : preferredTerms?.zh ?? null
  };
}

function normalizeDefinitionContract(contract) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) return null;
  return {
    ...contract,
    zh:
      typeof contract.zh === 'string' && contract.zh.trim()
        ? traditionalToSimplified(contract.zh.trim())
        : contract.zh ?? null
  };
}

function compactPayload(row) {
  return {
    source_entry_id: Number(row.source_entry_id),
    source_sense_id: Number(row.first_sense_id ?? row.source_sense_id) || null,
    headword: row.word,
    source_language: row.source_lang,
    frequency_rank: row.frequency_rank ?? null,
    part_of_speech: row.part_of_speech || null,
    proposed_gloss: row.gloss_key,
    sense_alignment: row.sense_alignment
      ? {
          aligned_sense_id: row.sense_alignment.aligned_sense_id,
          changed: row.sense_alignment.changed,
          aligned_clean_lang_count: row.sense_alignment.aligned_clean_lang_count,
          policy: row.sense_alignment.policy
        }
      : null,
    daily_sense_selection: row.daily_sense_selection
      ? {
          score: row.daily_sense_selection.score,
          changed: row.daily_sense_selection.changed,
          alternatives: (row.daily_sense_selection.alternatives || []).slice(0, 12).map((item) => ({
            source_sense_id: item.id,
            part_of_speech: item.part_of_speech,
            gloss: item.gloss,
            source: item.source,
            blocked_reason: item.blocked_reason
          }))
        }
      : null,
    source_sense_evidence: compactSourceSenseEvidence(row),
    supplemental_evidence: compactSupplementalEvidence(row),
    corroborating_source_evidence: corroboratingSourceEvidence(row),
    verified_translation_hints: compactGenerationHints(row),
    first_sense_localizations: (row.first_sense_localizations || []).map((loc) => ({
      lang: loc.lang,
      term: loc.term,
      definition: loc.definition,
      source: loc.source
    }))
  };
}

function compactSourceSenseEvidence(row) {
  const candidates = Array.isArray(row?.sense_alignment?.candidates)
    ? row.sense_alignment.candidates
    : [];
  const sourcePriority = (source) => {
    const value = String(source || '').toLowerCase();
    if (/^(jmdict|freedict|cc-cedict|ecdict)/u.test(value)) return 0;
    if (value.startsWith('wikdict-')) return 1;
    if (value.startsWith('omw-')) return 2;
    return 3;
  };
  return candidates
    .filter((item) => item?.source && item?.gloss_key)
    .sort((a, b) => sourcePriority(a.source) - sourcePriority(b.source))
    .slice(0, 8)
    .map((item) => ({ source: item.source, gloss: item.gloss_key }));
}

function compactSupplementalEvidence(row) {
  if (!Array.isArray(row?.supplemental_evidence)) return [];
  return row.supplemental_evidence.slice(0, 3).map((item) => ({
    source_key: item.source_key,
    source_language: item.source_lang,
    word: item.word,
    part_of_speech: item.part_of_speech || null,
    gloss: item.gloss
  }));
}

function compactGenerationHints(row) {
  if (!row?.generation_hints || typeof row.generation_hints !== 'object') return {};
  return Object.fromEntries(
    Object.entries(row.generation_hints)
      .filter(([, value]) => Array.isArray(value?.terms) && value.terms.length)
      .map(([lang, value]) => [
        lang,
        {
          terms: value.terms.slice(0, 3),
          provenance: value.provenance || null
        }
      ])
  );
}

function buildPrompt(payload, previousError) {
  if (promptMode === 'locked-contract') {
    const lockedTerms = Object.fromEntries(
      Object.entries(payload.verified_translation_hints || {}).map(([lang, value]) => [
        lang,
        Array.isArray(value?.terms) ? value.terms[0] || null : null
      ])
    );
    const input = {
      word: payload.headword,
      source_language: payload.source_language,
      english_anchor: payload.proposed_gloss,
      locked_terms: lockedTerms,
      evidence: payload.supplemental_evidence.map((row) => [
        row.source_key,
        row.part_of_speech,
        row.gloss
      ])
    };
    return `Review one locked four-language dictionary sense as a whole.
The four locked_terms are immutable: copy them exactly into preferred_terms; never replace, normalize, or inflect them.
Accept only if every locked term has the same concept, part of speech, domain, and semantic breadth as english_anchor. Reject a person/action, material/object, process/state, or broad/narrow mismatch. Use manual_review when evidence is insufficient.
When accepting, write one short explanatory definition in EACH language, not a synonym or the term itself. Each definition must be a natural phrase or sentence with at least four meaningful words (Chinese/Japanese: at least eight characters). Definitions must express exactly the same scope. Chinese must be neutral Mainland Chinese.
Always include evidence as an array containing one short, non-empty comparison grounded in the supplied evidence. Never omit evidence, even when the decision is reject or manual_review.
JSON only: {"decision":"accept|reject|manual_review","confidence":0,"english_anchor":"","preferred_terms":{"en":null,"pt-BR":null,"zh":null,"ja":null},"definition_contract":{"en":null,"pt-BR":null,"zh":null,"ja":null},"reason":"","evidence":[""],"risk_flags":[]}
Input=${JSON.stringify(input)}${previousError ? '\nPrevious output failed validation. Copy locked terms exactly and return complete JSON only.' : ''}`;
  }
  if (promptMode === 'nano') {
    const hints = Object.fromEntries(
      Object.entries(payload.verified_translation_hints || {}).map(([lang, value]) => [
        lang,
        Array.isArray(value?.terms) ? value.terms[0] || null : null
      ])
    );
    const input = {
      w: payload.headword,
      l: payload.source_language,
      g: payload.proposed_gloss,
      h: hints
    };
    return `Exact dictionary-sense gate. Reject homograph, wrong POS, or broad/narrow mismatch; manual if ambiguous. Every non-null h term must mean the same exact w/g sense. zh must be neutral Mainland Chinese; allow a Taiwan-only term only when no established Mainland equivalent exists. confidence>=.90 only if safe. JSON only {"decision":"accept|reject|manual_review","confidence":0,"english_anchor":"","preferred_terms":{"en":null,"pt-BR":null,"zh":null,"ja":null},"definition_contract":{"en":null,"pt-BR":null,"zh":null,"ja":null},"reason":"","evidence":[""],"risk_flags":[]} I=${JSON.stringify(input)}${previousError ? ' Previous output was invalid; return complete JSON only.' : ''}`;
  }
  if (promptMode === 'micro') {
    const verifiedHints = payload.verified_translation_hints || {};
    const microPayload = {
      w: payload.headword,
      l: payload.source_language,
      g: payload.proposed_gloss,
      ...(requireHintSemanticAlignment ? { h: verifiedHints } : {}),
      k: payload.supplemental_evidence.map((row) => [row.source_key, row.part_of_speech, row.gloss]),
      e: payload.first_sense_localizations.map((row) => [
        row.lang,
        row.term,
        row.definition
      ])
    };
    return `Lexical check: is gloss a real sense/inflection/synonym/translation of source headword?
Gloss/localizations may be bilingual target-language translations; never reject only because language differs.
${requireHintSemanticAlignment ? 'Also require the FIRST h term in every language to express this exact sense and grammatical role. Reject any polysemy, homograph, overly broad/narrow, or wrong-part-of-speech hint. Return those exact first h terms as preferred_terms when accepting.\n' : ''}
Reject semantic mismatch/name; manual if ambiguous. confidence>=.90 only if safe.
zh terms must use neutral Mainland Chinese; a Taiwan-only term is allowed only if Mainland Chinese has no established equivalent.
JSON {"decision":"accept|reject|manual_review","confidence":0,"english_anchor":"","preferred_terms":{"en":null,"pt-BR":null,"zh":null,"ja":null},"definition_contract":{"en":null,"pt-BR":null,"zh":null,"ja":null},"reason":"","evidence":[""],"risk_flags":[]}
${previousError ? 'Previous output was invalid; return complete JSON only.\n' : ''}Input=${JSON.stringify(microPayload)}`;
  }
  const strictHintRules = requireHintSemanticAlignment
    ? `This is also a strict target-term gate. Review the FIRST verified_translation_hints term for every language.
Accept only when every returned preferred term expresses the same exact sense, semantic scope, and grammatical category as the source headword.
Reject action/object, process/state, person/profession, material/object, singular/plural, or broad/narrow mismatches. Do not accept an ordinary part-of-speech shift.
Infer grammatical category from morphology and dictionary wording when the source POS field is missing. In particular, do not treat an adjective as a noun merely because an English gloss is ambiguous between both categories.
Distinguish a capability or quality from a concrete feature, and general dispersion from administrative or political decentralization.
Definitions implied by the preferred terms must not add domains absent from english_anchor, such as thermal conductivity when the anchor is specifically electrical.
The zh preferred term must be neutral Mainland Chinese. Reject a Taiwan-only supplied term when an established Mainland equivalent exists; permit Taiwan fallback only when no Mainland equivalent exists.
When accepting, preferred_terms must copy the exact matching supplied hint form; use null only when that language has no safe exact hint.`
    : 'Target-language localizations and hints are reviewed by later gates. A noisy target hint must not reject a genuine source sense; add a risk flag instead.';
  const dailyPrimaryRule = requireDailyPrimary
    ? `This batch is for everyday high-frequency vocabulary. Accept only when proposed_gloss is a common modern daily sense of the headword. Compare daily_sense_selection.alternatives when present. Reject a merely valid but technical, historical, proper-name, metalinguistic, rare-homograph, or non-primary sense when a clearly more common everyday sense exists. Do not invent or switch source_sense_id; rejection sends the entry back for alternate-sense selection.`
    : '';
  return `Conservative source-sense review. Decide only whether proposed_gloss is a real sense of the source-language headword.
accept=genuine primary/secondary, inflected, figurative, regional, archaic, transliterated, or close-synonym sense.
reject=another word/language/homograph/name/spelling or unrelated concept. manual_review=ambiguous or thin evidence.
Use source_sense_evidence as lexical evidence; JMdict/FreeDict/CC-CEDICT/ECDICT entries are authoritative when present.
${dailyPrimaryRule}
${strictHintRules}
Hints passed reverse-dictionary lookup but may reflect the wrong sense of a polysemous English anchor. Use a hinted preferred term only when it matches the exact gloss.
Confidence >=0.90 only when safe for four-language generation. Keep reason/evidence under 14 words; at most two risk flags.
  ${requireDefinitionContract ? 'When accepting, definition_contract must give one short explanatory definition written natively in each matching language. A definition must never equal or merely repeat its preferred term. Use at least six words in English and Portuguese, eight Chinese characters, and twelve Japanese characters. Never copy the English gloss into pt-BR, zh, or ja. All four definitions must have identical grammatical role, domain, and semantic breadth; exclude extra senses and factual details not shared by the anchor.\n' : ''}For reject/manual_review, english_anchor may be null and all preferred_terms/definition_contract values may be null; do not invent fields merely to satisfy the schema.
Return JSON only: {"decision":"accept|reject|manual_review","confidence":0.0,"english_anchor":"exact English sense or null","preferred_terms":{"en":null,"pt-BR":null,"zh":null,"ja":null},"definition_contract":{"en":null,"pt-BR":null,"zh":null,"ja":null},"reason":"short","evidence":["short"],"risk_flags":[]}
${previousError ? 'Previous output was invalid; return complete JSON only.\n' : ''}Input=${JSON.stringify(payload)}`;
}

function buildLegacyPrompt(payload, previousError) {
  return `Verify whether proposed_gloss expresses a genuine dictionary sense of the source-language headword.

Rules:
- proposed_gloss may be a translation or transliteration in any target language; it does not need to be written in the source language.
- accept: the gloss/term is a genuine translation, transliteration, primary or secondary sense, inflected form, or close synonym of the headword.
- reject: the gloss belongs to another word, language, homograph, named entity, spelling, or unrelated concept.
- manual_review: evidence is ambiguous, combines incompatible senses, or is too thin to decide safely.
- Judge semantic equivalence, not whether the gloss language matches source_language. For example, Chinese 苹果树 and Portuguese macieira are a valid pair.
- If one localization is noisy but another independently confirms the headword meaning, prefer manual_review over reject.
- Bilingual open-dictionary evidence is noisy. Agreement between fields helps, but repeated text from one source is not independent proof.
- verified_translation_hints passed deterministic reverse-dictionary checks, but English polysemy can still select the wrong sense. Use a hinted preferred term only when it matches proposed_gloss.
- Do not reject merely because a sense is non-primary, regional, archaic, or narrower when it is still genuine.
- Kana-only Japanese headwords can represent several kanji spellings and senses. Accept when any common kanji spelling has the proposed meaning; do not assume only the most frequent spelling.
- Accept ordinary part-of-speech shifts and figurative dictionary translations when the lexical concept remains the same, such as adjective-to-adverb or stand out-to-shine.
- Reject only when no established spelling, homograph, inflection, figurative use, or close synonym supports the proposed meaning.
- Confidence >= 0.90 means safe to spend a full four-language generation request on this candidate.
- english_anchor must be a concise English sense label for the exact meaning being judged, not merely the untranslated headword.
- preferred_terms must select a source-supported term for each language when available; use null when the evidence does not support one safely.
- Keep reason and evidence under 24 words each. Use at most two risk flags.

Return exactly:
{
  "decision": "accept" | "reject" | "manual_review",
  "confidence": 0.0,
  "english_anchor": "concise English sense label",
  "preferred_terms": {"en": null, "pt-BR": null, "zh": null, "ja": null},
  "reason": "short reason",
  "evidence": ["one concrete lexical comparison"],
  "risk_flags": ["wrong_homograph" | "wrong_language" | "proper_name" | "source_ambiguous" | "rare_or_regional" | "sense_mismatch"]
}
${previousError ? 'Previous output was invalid; return complete JSON only.\n' : ''}
Input:
${JSON.stringify(payload)}`;
}

function validateReview(parsed, row = null) {
  const errors = validateSourceReviewEnvelope(parsed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return errors;
  if (requireDefinitionContract && parsed.decision === 'accept') {
    errors.push(...validateDefinitionContract(parsed.definition_contract, parsed.preferred_terms));
  }
  if (requireHintSemanticAlignment && parsed.decision === 'accept' && row) {
    const bound = evidenceBoundPreferredTerms(row, { preferred_terms: parsed.preferred_terms });
    for (const lang of ['en', 'pt-BR', 'zh', 'ja']) {
      if (!String(bound[lang] || '').trim()) errors.push(`missing_evidence_bound_preferred_term_${lang}`);
    }
  }
  return errors;
}

function buildOutput() {
  const ordered = [...reviews].sort((a, b) => {
    const ai = targetCandidateOrder.get(candidateKey(a)) ?? Number.MAX_SAFE_INTEGER;
    const bi = targetCandidateOrder.get(candidateKey(b)) ?? Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });
  const approved = ordered.filter((row) => row.approved);
  const counts = {
    reviewed: ordered.length,
    valid: ordered.filter((row) => row.valid).length,
    approved: approved.length,
    rejected: ordered.filter((row) => row.decision === 'reject').length,
    manual_review: ordered.filter((row) => row.decision === 'manual_review').length,
    failed: ordered.filter((row) => !row.valid).length
  };
  const endpointCounts = Object.fromEntries(
    activeEndpoints.map((endpoint) => [
      endpoint,
      ordered.filter((row) => row.endpoint === endpoint).length
    ])
  );
  const endpointRuntime = Object.fromEntries(
    [...endpointRuntimeStates.entries()].map(([endpoint, state]) => [
      endpoint,
      {
        calls: state.calls,
        failures: state.failures,
        timeouts: state.timeouts,
        consecutive_failures: state.consecutiveFailures,
        circuit_opens: state.circuitOpens,
        recoveries: state.recoveries,
        circuit_open: state.openUntil > Date.now(),
        open_until: state.openUntil ? new Date(state.openUntil).toISOString() : null
      }
    ])
  );
  return {
    ok: ordered.length === targetCandidates.length && counts.failed === 0,
    created_at: new Date().toISOString(),
    report: path.relative(process.cwd(), reportPath),
    model,
    endpoints,
    prewarm,
    stream,
    response_format: responseFormat,
    prompt_mode: promptMode,
    blind_source_anchor: blindSourceAnchor,
    blind_semantic_match: blindSemanticMatch,
    require_daily_primary: requireDailyPrimary,
    retry_decisions: [...retryDecisionsOnResume],
    circuit_breaker_failures: circuitBreakerFailures,
    circuit_breaker_reset_ms: circuitBreakerResetMs,
    prewarm_results: prewarmResults,
    confidence_threshold: confidenceThreshold,
    offset,
    elapsed_seconds: secondsSince(started),
    summary: {
      ...counts,
      active_endpoints: activeEndpoints.length,
      endpoint_counts: endpointCounts,
      endpoint_runtime: endpointRuntime
    },
    reviews: ordered
  };
}

function buildApprovedReport() {
  const approvedReviews = new Map(
    reviews.filter((row) => row.approved).map((row) => [candidateKey(row), row])
  );
  const selected = targetCandidates
    .filter((row) => approvedReviews.has(candidateKey(row)))
    .map((row) => {
      const review = approvedReviews.get(candidateKey(row));
      const candidate = blindSourceAnchor ? sanitizeBlindApprovedCandidate(row, review) : row;
      const reviewedEnglishAnchor = blindSourceAnchor
        ? candidate.blind_generation_anchor
        : review.english_anchor;
      return {
        ...candidate,
        candidate_evidence_review: {
          decision: review.decision,
          confidence: review.confidence,
          english_anchor: reviewedEnglishAnchor,
          reason: review.reason,
          evidence: review.evidence,
          risk_flags: review.risk_flags,
          preferred_term_policy: blindSourceAnchor ? 'blind_source_anchor_only' : 'source_only_exact',
          preferred_terms: evidenceBoundPreferredTerms(candidate, review),
          definition_contract: review.definition_contract,
          suggested_terms: blindSourceAnchor
            ? { en: String(row.word || '').trim(), 'pt-BR': null, zh: null, ja: null }
            : review.preferred_terms,
          ...(blindSourceAnchor ? { blind_source_anchor: review.blind_source_anchor } : {})
        }
      };
    });
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    source_report: path.relative(process.cwd(), reportPath),
    evidence_review: path.relative(process.cwd(), outPath),
    exclude_review_key: excludeReviewKey,
    confidence_threshold: confidenceThreshold,
    selected_count: selected.length,
    selected
  };
}

function sanitizeBlindApprovedCandidate(row, review) {
  const matchedCandidate = String(review?.blind_semantic_match?.candidate_term || '').trim();
  const anchor = matchedCandidate || String(review?.english_anchor || '').trim();
  const sourceWord = String(row?.word || '').trim();
  return {
    ...row,
    original_gloss_key: row.gloss_key,
    original_gloss_preview: row.gloss_preview,
    original_first_sense_localizations: row.first_sense_localizations || [],
    original_generation_hints: row.generation_hints || {},
    gloss_key: anchor,
    gloss_preview: anchor,
    blind_generation_anchor: anchor,
    blind_inventory_anchor: String(review?.english_anchor || '').trim() || null,
    first_sense_localizations: [],
    generation_hints: {
      en: {
        terms: [sourceWord],
        sources: ['blind_source_anchor'],
        provenance: 'blind_source_anchor'
      }
    },
    blind_generation_policy: {
      target_hints_removed: true,
      target_localizations_removed: true,
      anchor_source: 'blind_model_inventory_then_locked_match'
    }
  };
}

function evidenceBoundPreferredTerms(row, review) {
  const preferred = { en: null, 'pt-BR': null, zh: null, ja: null };
  for (const lang of ['en', 'pt-BR', 'zh', 'ja']) {
    const hint = row?.generation_hints?.[lang];
    const independentFamilies = new Set(Array.isArray(hint?.evidence_families) ? hint.evidence_families : []);
    const isUniqueOmw = hint?.provenance === 'omw_synset';
    const isReviewedSourceEnglishAnchor =
      lang === 'en' &&
      Array.isArray(hint?.sources) &&
      hint.sources.includes('source_english_anchor');
    if (
      (!isUniqueOmw && !isReviewedSourceEnglishAnchor && independentFamilies.size < 2) ||
      !Array.isArray(hint?.terms) ||
      !hint.terms.length
    ) {
      continue;
    }
    const reviewedTerm = String(review?.preferred_terms?.[lang] || '').trim();
    if (!reviewedTerm) continue;
    const normalizedReviewedTerm = normalize(
      lang === 'zh' ? traditionalToSimplified(reviewedTerm) : reviewedTerm
    );
    const matchingHint = hint.terms.find((value) => {
      const term = String(value || '').trim();
      return normalize(lang === 'zh' ? traditionalToSimplified(term) : term) === normalizedReviewedTerm;
    });
    if (!matchingHint) continue;
    const term = String(matchingHint).trim();
    preferred[lang] = lang === 'zh' ? traditionalToSimplified(term) : term;
  }
  const sourceLang = String(row?.source_lang || '');
  if (Object.hasOwn(preferred, sourceLang)) {
    preferred[sourceLang] = String(row?.word || '').trim() || null;
  }
  // A target term is binding only when independent lexical evidence and the
  // semantic source review select the same form. The exact source term remains
  // binding regardless of target-language evidence.
  return preferred;
}

function corroboratingSourceEvidence(row) {
  if (!findCorroboratingEvidence) return [];
  const records = findCorroboratingEvidence.all(row.source_lang, row.normalized_key || normalize(row.word));
  const evidence = [];
  for (const record of records) {
    const raw = safeJsonObject(record.raw_json);
    const wikdict = raw.wikdict || {};
    if (wikdict.is_good !== 1 || Number(wikdict.score || 0) < 80) continue;
    const targetLang = normalizeTargetLang(raw.target_lang);
    if (!targetLang) continue;
    for (const term of Array.isArray(raw.translations) ? raw.translations : []) {
      const value = String(term || '').trim();
      if (!value) continue;
      evidence.push({ target_lang: targetLang, term: value, source: record.source_key, score: wikdict.score });
    }
  }
  return evidence.slice(0, 16);
}

function normalizeTargetLang(value) {
  const lang = String(value || '').trim();
  if (lang === 'pt' || lang === 'por' || lang === 'pt-BR') return 'pt-BR';
  if (lang === 'en' || lang === 'eng') return 'en';
  if (lang === 'zh' || lang === 'zho') return 'zh';
  if (lang === 'ja' || lang === 'jpn') return 'ja';
  return null;
}

function safeJsonObject(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function normalize(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase();
}

function buildRejectedReport() {
  const rejectedIds = new Set(
    reviews.filter((row) => row.valid && !row.approved).map(candidateKey)
  );
  const selected = targetCandidates.filter((row) => rejectedIds.has(candidateKey(row)));
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    source_report: path.relative(process.cwd(), reportPath),
    evidence_review: path.relative(process.cwd(), outPath),
    exclude_review_key: excludeReviewKey,
    selected_count: selected.length,
    selected
  };
}

function candidateKey(row) {
  const entryId = Number(row?.source_entry_id);
  const senseId = Number(row?.source_sense_id ?? row?.first_sense_id);
  return `${entryId}:${Number.isInteger(senseId) && senseId > 0 ? senseId : '*'}`;
}

function writeOutputs() {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  writeJsonAtomic(outPath, buildOutput());
  fs.mkdirSync(path.dirname(approvedOutPath), { recursive: true });
  writeJsonAtomic(approvedOutPath, buildApprovedReport());
  fs.mkdirSync(path.dirname(rejectedOutPath), { recursive: true });
  writeJsonAtomic(rejectedOutPath, buildRejectedReport());
}

function writeJsonAtomic(targetPath, value) {
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
  try {
    fs.renameSync(temporaryPath, targetPath);
  } catch (error) {
    // Windows can reject replacement when the destination already exists.
    // Removing it creates only a short missing-file window, never partial JSON.
    if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
    fs.rmSync(targetPath, { force: true });
    fs.renameSync(temporaryPath, targetPath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

async function postJson(endpoint, pathName, body, timeout) {
  const response = await fetch(`${endpoint}${pathName}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 400)}`);
  if (body?.stream === true) return parseOpenAiEventStream(text);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`non_json_response:${text.slice(0, 400)}`);
  }
}

function parseOpenAiEventStream(text) {
  let content = '';
  let usage = null;
  let sawChunk = false;
  for (const line of String(text || '').split(/\r?\n/u)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      throw new Error(`invalid_sse_json:${payload.slice(0, 400)}`);
    }
    sawChunk = true;
    const delta = chunk?.choices?.[0]?.delta;
    const message = chunk?.choices?.[0]?.message;
    if (typeof delta?.content === 'string') content += delta.content;
    else if (typeof message?.content === 'string') content += message.content;
    if (chunk?.usage) usage = chunk.usage;
  }
  if (!sawChunk) throw new Error(`empty_sse_response:${String(text || '').slice(0, 400)}`);
  return { choices: [{ message: { content } }], usage };
}

async function prewarmEndpoints() {
  return Promise.all(
    endpoints.map(async (endpoint) => {
      const variant = variants[endpointPort(endpoint)] || null;
      return ensureUnslothModel({
        endpoint,
        token,
        model,
        variant,
        maxSeqLength,
        speculativeType,
        loadTimeoutMs,
        forceReload,
        unloadBeforeLoad
      });
    })
  );
}

async function getJson(endpoint, pathName, timeout) {
  const response = await fetch(`${endpoint}${pathName}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(timeout)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 400)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`non_json_response:${text.slice(0, 400)}`);
  }
}

function parseJson(content) {
  const text = String(content || '')
    .trim()
    .replace(/^```(?:json)?\s*/u, '')
    .replace(/\s*```$/u, '');
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error(`json_parse_failed:${text.slice(0, 300)}`);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadExistingReviews(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return Array.isArray(parsed.reviews)
    ? parsed.reviews.map((review) => ({
        ...review,
        preferred_terms: normalizePreferredTerms(review.preferred_terms)
      }))
    : [];
}

function parseEndpointVariants(value) {
  if (!value) return {};
  const parsed = {};
  for (const item of String(value).split(',')) {
    const separator = item.indexOf('=');
    if (separator < 1) throw new Error(`Invalid --endpoint-gguf-variants item: ${item}`);
    parsed[item.slice(0, separator).trim()] = item.slice(separator + 1).trim();
  }
  return parsed;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index++;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

function boundedInteger(value, fallback, min) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min) throw new Error(`Invalid integer: ${value}`);
  return parsed;
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`Invalid number: ${value}`);
  return parsed;
}

function endpointPort(endpoint) {
  try {
    return new URL(endpoint).port;
  } catch {
    return endpoint;
  }
}

function secondsSince(startedAt) {
  return Number(((performance.now() - startedAt) / 1000).toFixed(2));
}

function errorMessage(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (!cause) return error.message;
  const details = [cause.code, cause.errno, cause.syscall, cause.address, cause.port]
    .filter((value) => value !== undefined && value !== null && value !== '')
    .join(':');
  const causeMessage = cause instanceof Error ? cause.message : String(cause);
  return `${error.message}; cause=${causeMessage}${details ? ` (${details})` : ''}`;
}
