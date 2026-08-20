import './lib/load-local-env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { ensureUnslothModel } from './lib/unsloth-elastic-model.mjs';

const args = parseArgs(process.argv.slice(2));
const generationPath = requiredPath(args.generation, 'generation');
const evidencePath = requiredPath(args.evidence, 'evidence');
const outPath = requiredPath(args.out, 'out');
const acceptedOutPath = path.resolve(
  args['accepted-out'] || outPath.replace(/\.json$/u, '-accepted.json')
);
const token = args.token || process.env.UNSLOTH_API_KEY;
const endpoints = String(args.endpoints || args.endpoint || '')
  .split(',')
  .map((value) => value.trim().replace(/\/$/u, ''))
  .filter(Boolean);
const model = String(args.model || 'unsloth/gemma-4-31B-it-qat-GGUF');
const generationModel = String(args['generation-model'] || '');
const variant = args['gguf-variant'] ? String(args['gguf-variant']) : null;
const endpointVariants = parseEndpointVariants(args['endpoint-gguf-variants']);
const confidenceThreshold = boundedNumber(args['confidence-threshold'], 0.9, 0, 1);
const timeoutMs = boundedInteger(args['timeout-ms'], 180_000, 1_000);
const loadTimeoutMs = boundedInteger(args['load-timeout-ms'], 300_000, 1_000);
const maxTokens = boundedInteger(args['max-tokens'], 320, 128);
const maxAttempts = boundedInteger(args['max-attempts'], 2, 1);
const maxSeqLength = boundedInteger(args['max-seq-length'], 2048, 512);
const limit = boundedInteger(args.limit, 10, 1);
const forceReload = args['force-reload'] === 'true';
const unloadBeforeLoad = args['unload-before-load'] === 'true';
const resume = args.resume === 'true';
const recheckRejected = args['recheck-rejected'] === 'true';
const retryDecisionsOnResume = new Set(
  String(args['retry-decisions'] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);
for (const decision of retryDecisionsOnResume) {
  if (!['accept', 'reject', 'manual_review'].includes(decision)) {
    throw new Error(`Invalid --retry-decisions value: ${decision}`);
  }
}
const includeSupported = args['include-supported'] === 'true';
const onlySupported = args['only-supported'] === 'true';
const chatPath = normalizeChatPath(args['chat-path'] || '/v1/chat/completions');
const streamResponse = args.stream === 'true';
const promptMode = String(args['prompt-mode'] || 'full');
const languageFocus = args['language-focus'] ? String(args['language-focus']) : null;
const concurrency = boundedInteger(args.concurrency, 1, 1);
const checkpointEvery = boundedInteger(args['checkpoint-every'], 10, 1);
const checkpointIntervalMs = boundedInteger(args['checkpoint-interval-ms'], 10_000, 100);

if (languageFocus && !['en', 'pt-BR', 'zh', 'ja'].includes(languageFocus)) {
  throw new Error(`Invalid --language-focus: ${languageFocus}`);
}

if (includeSupported && onlySupported) {
  throw new Error('--include-supported and --only-supported are mutually exclusive');
}

if (!token) throw new Error('Missing --token or UNSLOTH_API_KEY');
if (!endpoints.length) throw new Error('Missing --endpoint or --endpoints');
if (!generationModel) throw new Error('Missing --generation-model');
if (normalizedFamily(model) === normalizedFamily(generationModel)) {
  throw new Error('Reviewer and generation model must be from different model families');
}

const generationReport = readJson(generationPath);
const evidenceReport = readJson(evidencePath);
const generationRows = Array.isArray(generationReport.generated)
  ? generationReport.generated
  : Array.isArray(generationReport.replayed)
    ? generationReport.replayed
    : [];
const generatedById = new Map(
  generationRows
    .filter((row) => row?.valid === true)
    .map((row) => [sourceSenseKey(row.source_entry_id, row.output?.source_sense_id ?? row.source_sense_id), row])
);
const evidenceRows = loadEvidenceRows(evidenceReport);
const targets = evidenceRows
  .map((row) => ({
    evidence: row,
    generation: generatedById.get(sourceSenseKey(row.source_entry_id, row.source_sense_id)) || null
  }))
  .filter((row) => row.generation)
  .slice(0, limit);

if (!targets.length) throw new Error('No non-supported generated candidates found');

const targetIds = new Set(
  targets.map((target) => sourceSenseKey(target.evidence.source_entry_id, target.evidence.source_sense_id))
);
const targetOrder = new Map(
  targets.map((target, index) => [
    sourceSenseKey(target.evidence.source_entry_id, target.evidence.source_sense_id),
    index
  ])
);
const resumedReviews =
  resume && fs.existsSync(outPath)
    ? (readJson(outPath).reviews || []).filter(
        (row) =>
          row?.valid === true &&
          !retryDecisionsOnResume.has(row?.decision) &&
          (!recheckRejected || row?.consensus_accepted === true) &&
          targetIds.has(sourceSenseKey(row.source_entry_id, row.source_sense_id))
      )
    : [];
const completedIds = new Set(
  resumedReviews.map((row) => sourceSenseKey(row.source_entry_id, row.source_sense_id))
);
const pendingTargets = targets.filter(
  (target) =>
    !completedIds.has(sourceSenseKey(target.evidence.source_entry_id, target.evidence.source_sense_id))
);

const prewarm = pendingTargets.length
  ? await Promise.all(endpoints.map((reviewEndpoint) => loadReviewerModel(reviewEndpoint)))
  : endpoints.map((reviewEndpoint) => ({ endpoint: reviewEndpoint, ok: true, skipped: true }));
if (prewarm.every((row) => !row.ok)) {
  throw new Error(`Reviewer model load failed on every endpoint: ${prewarm.map((row) => `${row.endpoint}=${row.error}`).join('; ')}`);
}
const activeEndpoints = prewarm.filter((row) => row.ok).map((row) => row.endpoint);

const reviews = [...resumedReviews];
let nextPendingIndex = 0;
let completedSinceCheckpoint = 0;
let lastCheckpointAt = Date.now();
await Promise.all(
  Array.from({ length: Math.min(concurrency, activeEndpoints.length, Math.max(1, pendingTargets.length)) }, (_, workerIndex) => async () => {
    while (true) {
      const pendingIndex = nextPendingIndex++;
      if (pendingIndex >= pendingTargets.length) return;
      const review = await reviewWithRetry(pendingTargets[pendingIndex], workerIndex);
      reviews.push(review);
      completedSinceCheckpoint++;
      console.log(
        `[${reviews.length}/${targets.length}] source=${review.source_entry_id} ${review.word} ` +
          `decision=${review.valid ? review.decision : 'error'} confidence=${review.confidence ?? '-'}`
      );
      if (
        completedSinceCheckpoint >= checkpointEvery ||
        Date.now() - lastCheckpointAt >= checkpointIntervalMs
      ) {
        writeReports();
        completedSinceCheckpoint = 0;
        lastCheckpointAt = Date.now();
      }
    }
  }).map((worker) => worker())
);
writeReports();

const output = buildOutput();
console.log(
  JSON.stringify(
    {
      ok: output.summary.failed === 0,
      out: path.relative(process.cwd(), outPath),
      accepted_out: path.relative(process.cwd(), acceptedOutPath),
      summary: output.summary
    },
    null,
    2
  )
);

async function reviewWithRetry(target, startEndpointIndex) {
  let lastError = null;
  const endpointAttempts = [];
  const attemptLimit = Math.max(maxAttempts, activeEndpoints.length);
  for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
    const reviewEndpoint = activeEndpoints[(startEndpointIndex + attempt - 1) % activeEndpoints.length];
    try {
      return await reviewTarget(target, reviewEndpoint, attempt, lastError);
    } catch (error) {
      lastError = errorMessage(error);
      endpointAttempts.push({ endpoint: reviewEndpoint, attempt, error: lastError });
    }
  }
  return {
    source_entry_id: Number(target.evidence.source_entry_id),
    source_sense_id: Number(target.evidence.source_sense_id),
    word: target.generation.word,
    anchor: target.evidence.anchor,
    valid: true,
    decision: 'manual_review',
    confidence: 0,
    consensus_accepted: false,
    reason: 'All healthy reviewer endpoints returned invalid or failed responses.',
    corrections: [],
    endpoint_attempts: endpointAttempts,
    error: lastError
  };
}

async function reviewTarget(target, reviewEndpoint, attempt, previousError) {
  if (promptMode === 'nano-per-language') {
    return reviewTargetPerLanguage(target, reviewEndpoint, attempt, previousError);
  }
  const started = performance.now();
  const payload = compactPayload(target);
  const response = await postChat(
    reviewEndpoint,
    chatPath,
    {
      model,
      stream: streamResponse,
      temperature: 0,
      max_tokens: maxTokens,
      enable_thinking: false,
      reasoning_effort: 'none',
      response_format: { type: 'json_object' },
      messages:
        promptMode === 'nano'
          ? [{ role: 'user', content: buildNanoPrompt(payload, previousError) }]
          : [
              {
                role: 'system',
                content:
                  'You are an independent conservative four-language lexicographer. ' +
                  'Review another model output against the source sense and dictionary conflict evidence. ' +
                  'Do not approve merely because a translation is a loose synonym. Return JSON only.'
              },
              { role: 'user', content: buildPrompt(payload, previousError) }
            ]
    },
    timeoutMs
  );
  const content = String(response?.choices?.[0]?.message?.content || '');
  const parsed = normalizeReview(parseJson(content));
  validateReview(parsed);
  validateDeterministicCorrectionPolicy(parsed, payload);
  const corrections = Array.isArray(parsed.corrections)
    ? parsed.corrections.map(normalizeCorrection).filter(Boolean)
    : [];
  const consensusAccepted =
    parsed.decision === 'accept' &&
    Number(parsed.confidence) >= confidenceThreshold &&
    corrections.length === 0;
  return {
    source_entry_id: Number(target.evidence.source_entry_id),
    source_sense_id: Number(target.evidence.source_sense_id),
    word: target.generation.word,
    source_lang: target.generation.source_lang,
    anchor: target.evidence.anchor,
    deterministic_decision: target.evidence.decision,
    valid: true,
    decision: parsed.decision,
    confidence: Number(parsed.confidence),
    reason: String(parsed.reason).trim(),
    corrections,
    consensus_accepted: consensusAccepted,
    endpoint: reviewEndpoint,
    model,
    attempt,
    seconds: roundSeconds(performance.now() - started),
    usage: response.usage || null
  };
}

async function reviewTargetPerLanguage(target, reviewEndpoint, attempt, previousError) {
  const started = performance.now();
  const payload = compactPayload(target);
  const languageReviews = [];
  for (const [lang, localization] of Object.entries(payload.generated_localizations || {})) {
    const response = await postChat(
      reviewEndpoint,
      chatPath,
      {
        model,
        stream: streamResponse,
        temperature: 0,
        max_tokens: maxTokens,
        enable_thinking: false,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: buildPerLanguagePrompt(payload, lang, localization, previousError) }]
      },
      timeoutMs
    );
    const parsed = normalizeReview(parseJson(String(response?.choices?.[0]?.message?.content || '')));
    validateReview(parsed);
    languageReviews.push({
      lang,
      decision: parsed.decision,
      confidence: Number(parsed.confidence),
      reason: String(parsed.reason).trim()
    });
  }
  const rejected = languageReviews.find((row) => row.decision === 'reject');
  const manual = languageReviews.find((row) => row.decision === 'manual_review');
  const decision = rejected ? 'reject' : manual ? 'manual_review' : 'accept';
  const confidence = Math.min(...languageReviews.map((row) => row.confidence));
  return {
    source_entry_id: Number(target.evidence.source_entry_id),
    source_sense_id: Number(target.evidence.source_sense_id),
    word: target.generation.word,
    source_lang: target.generation.source_lang,
    anchor: target.evidence.anchor,
    deterministic_decision: target.evidence.decision,
    valid: true,
    decision,
    confidence,
    reason: languageReviews.map((row) => `${row.lang}:${row.reason}`).join(' | '),
    corrections: [],
    language_reviews: languageReviews,
    consensus_accepted: decision === 'accept' && confidence >= confidenceThreshold,
    endpoint: reviewEndpoint,
    model,
    attempt,
    seconds: roundSeconds(performance.now() - started),
    usage: null
  };
}

function compactPayload(target) {
  const output = target.generation.output || {};
  const concerns = {};
  for (const [lang, result] of Object.entries(target.evidence.languages || {})) {
    if (result?.decision === 'supported') continue;
    concerns[lang] = {
      decision: result?.decision || null,
      reason: result?.reason || null,
      matching_glosses: result?.evidence?.counts?.matching_glosses ?? null,
      matching_sources: result?.evidence?.counts?.matching_sources ?? null,
      match_ratio: result?.evidence?.counts?.match_ratio ?? null,
      strong_matches: (result?.evidence?.strong_matches || []).slice(0, 3),
      strong_nonmatches: (result?.evidence?.strong_nonmatches || []).slice(0, 4)
    };
  }
  return {
    source_entry_id: target.evidence.source_entry_id,
    source_sense_id: target.evidence.source_sense_id,
    source_language: output.primary_lang || target.generation.source_lang,
    source_word: output.source_word || target.generation.word,
    english_anchor: output.gloss_key || target.evidence.anchor,
    generated_localizations: output.localizations,
    generated_example: output.example || null,
    deterministic_decision: target.evidence.decision,
    deterministic_concerns: concerns,
    source_review: target.evidence.source_review || null
  };
}

function loadEvidenceRows(report) {
  if (Array.isArray(report.validations)) {
    return report.validations.filter((row) => {
      if (onlySupported) return row?.decision === 'supported';
      return includeSupported || row?.decision !== 'supported';
    });
  }
  if (Array.isArray(report.reviews)) {
    return report.reviews
      .filter(
        (row) =>
          row?.valid === true &&
          row?.decision === 'accept' &&
          row?.approved === true
      )
      .map((row) => ({
        source_entry_id: Number(row.source_entry_id),
        source_sense_id: Number(row.source_sense_id),
        anchor: row.english_anchor || row.gloss_key || null,
        decision: 'source_review_accepted',
        languages: {},
        source_review: {
          reason: row.reason || null,
          evidence: Array.isArray(row.evidence) ? row.evidence.slice(0, 6) : [],
          risk_flags: Array.isArray(row.risk_flags) ? row.risk_flags.slice(0, 6) : [],
          preferred_terms: row.preferred_terms || null,
          confidence: Number(row.confidence)
        }
      }));
  }
  throw new Error('Evidence report must contain validations or reviews');
}

function sourceSenseKey(sourceEntryId, sourceSenseId) {
  return `${Number(sourceEntryId)}:${Number(sourceSenseId)}`;
}

function buildPrompt(payload, previousError) {
  return [
    'Review this proposed dictionary sense independently.',
    'Return exactly:',
    '{"decision":"accept|reject|manual_review","confidence":0.0,"reason":"brief reason","corrections":[{"language":"en|pt-BR|zh|ja|all","field":"term|definition|reading|pronunciation|example|sense","current":"wrong value or summary","replacement":"safe replacement or null","issue":"brief error"}]}',
    'Use accept only when every EN/PT-BR/ZH/JA term and definition expresses the same source sense.',
    'When generated_example is present, accept only if its Simplified Chinese source sentence and all four localized sentences naturally demonstrate the exact same sense.',
    'Each definition must also be a complete, grammatical, natural sentence or dictionary-style phrase in its own language. Reject malformed syntax, missing particles, and unnatural wording even when the intended sense is recoverable.',
    languageFocus
      ? `Closely proofread the ${languageFocus} localization word by word for grammar, particles, syntax, and native dictionary style. Return a structured correction for every defect found.`
      : '',
    'Use reject for a wrong term, wrong sense, or misleading definition.',
    'A reading or pronunciation with a pronunciation_source or reading_source beginning with deterministic: was supplied by a dictionary or deterministic language tool. Treat it as authoritative and never reject or correct it from model memory. Review only pronunciations without a deterministic source.',
    'Use manual_review when evidence is insufficient or polysemy cannot be resolved.',
    'Every correction must use the exact structured fields above. Never put the wrong current term in replacement.',
    'Use replacement=null when no single safe replacement is justified. An accepted result must have an empty corrections array.',
    previousError ? `Previous response error: ${previousError}` : '',
    JSON.stringify(payload)
  ]
    .filter(Boolean)
    .join('\n');
}

function buildNanoPrompt(payload, previousError) {
  const compact = Object.fromEntries(
    Object.entries(payload.generated_localizations || {}).map(([lang, value]) => [
      lang,
      {
        term: String(value?.term || '').trim(),
        pronunciation: String(value?.reading || value?.pronunciation || '').trim(),
        definition: String(value?.definition || '').trim().slice(0, 220)
      }
    ])
  );
  return [
    'JSON only. Check all X terms and definitions mean M.',
    `W=${JSON.stringify(payload.source_word)};L=${payload.source_language};M=${JSON.stringify(payload.english_anchor)};X=${JSON.stringify(compact)}.`,
    'Return keys d,c,r: d=A accept, R reject, M unsure; c=actual 0..1; r=actual short reason. Use A and c>=0.9 only if all are correct.',
    previousError ? `Fix:${previousError}.` : ''
  ]
    .filter(Boolean)
    .join(' ');
}

function buildPerLanguagePrompt(payload, lang, localization, previousError) {
  const pronunciation = localization?.reading || localization?.pronunciation || '';
  return [
    'JSON only. Independently check this localization matches source sense M and is natural.',
    `W=${JSON.stringify(payload.source_word)};M=${JSON.stringify(payload.english_anchor)};T=${JSON.stringify(String(localization?.term || '').trim())};P=${JSON.stringify(String(pronunciation).trim())};D=${JSON.stringify(String(localization?.definition || '').trim().slice(0, 220))};X=${lang}.`,
    'Return keys d,c,r: d=A accept, R reject, M unsure; c=actual 0..1; r=actual short reason. Use A and c>=0.9 only if term, P, and D are correct.',
    previousError ? `Fix:${previousError}.` : ''
  ]
    .filter(Boolean)
    .join(' ');
}

function normalizeReview(value) {
  if (!value || typeof value !== 'object') return value;
  if (!promptMode.startsWith('nano')) {
    // Some otherwise valid structured responses omit the empty array on an
    // acceptance. This normalization is safe only for accept: negative
    // decisions still require explicit, actionable corrections below.
    if (value.decision === 'accept' && value.corrections === undefined) {
      return { ...value, corrections: [] };
    }
    return value;
  }
  const decisions = {
    A: 'accept',
    ACCEPT: 'accept',
    R: 'reject',
    REJECT: 'reject',
    M: 'manual_review',
    MANUAL_REVIEW: 'manual_review'
  };
  const compactDecision = String(value.d ?? value.decision ?? '').toUpperCase();
  return {
    decision: decisions[compactDecision] || value.decision,
    confidence: value.c ?? value.confidence,
    reason: value.r ?? value.reason,
    corrections: []
  };
}

async function loadReviewerModel(reviewEndpoint) {
  const endpointVariant = endpointVariants[endpointPort(reviewEndpoint)] || variant;
  return ensureUnslothModel({
    endpoint: reviewEndpoint,
    token,
    model,
    variant: endpointVariant,
    maxSeqLength,
    speculativeType: 'off',
    loadTimeoutMs,
    forceReload,
    unloadBeforeLoad,
    loadOptions: { n_parallel: 1, cache_type_kv: 'q8_0' }
  });
}

function buildOutput() {
  const orderedReviews = [...reviews].sort(
    (left, right) =>
      (targetOrder.get(sourceSenseKey(left.source_entry_id, left.source_sense_id)) ?? Number.MAX_SAFE_INTEGER) -
      (targetOrder.get(sourceSenseKey(right.source_entry_id, right.source_sense_id)) ?? Number.MAX_SAFE_INTEGER)
  );
  const valid = orderedReviews.filter((row) => row.valid);
  const endpointCounts = Object.fromEntries(
    activeEndpoints.map((endpoint) => [
      endpoint,
      orderedReviews.filter((row) => row.endpoint === endpoint).length
    ])
  );
  return {
    ok: orderedReviews.every((row) => row.valid),
    generated_at: new Date().toISOString(),
    generation_report: path.relative(process.cwd(), generationPath),
    evidence_report: path.relative(process.cwd(), evidencePath),
    policy: {
      generation_model: generationModel,
      reviewer_model: model,
      endpoints,
      independent_model_families: true,
      confidence_threshold: confidenceThreshold,
      chat_path: chatPath,
      stream: streamResponse,
      prompt_mode: promptMode,
      language_focus: languageFocus,
      concurrency,
      checkpoint_every: checkpointEvery,
      checkpoint_interval_ms: checkpointIntervalMs,
      retry_decisions: [...retryDecisionsOnResume],
      automatic_promotion: false
    },
    prewarm,
    summary: {
      targeted: targets.length,
      valid: valid.length,
      accepted: valid.filter((row) => row.decision === 'accept').length,
      rejected: valid.filter((row) => row.decision === 'reject').length,
      manual_review: valid.filter((row) => row.decision === 'manual_review').length,
      consensus_accepted: valid.filter((row) => row.consensus_accepted).length,
      failed: orderedReviews.filter((row) => !row.valid).length,
      active_endpoints: activeEndpoints.length,
      endpoint_counts: endpointCounts
    },
    reviews: orderedReviews
  };
}

function writeReports() {
  const output = buildOutput();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  writeJsonAtomically(outPath, output);
  fs.mkdirSync(path.dirname(acceptedOutPath), { recursive: true });
  writeJsonAtomically(acceptedOutPath, {
    ...output,
    reviews: output.reviews.filter((row) => row.consensus_accepted)
  });
}

function writeJsonAtomically(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.rmSync(filePath, { force: true });
  fs.renameSync(temporaryPath, filePath);
}

async function postJson(reviewEndpoint, pathName, body, timeout) {
  const response = await fetch(`${reviewEndpoint}${pathName}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
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

async function postChat(reviewEndpoint, pathName, body, timeout) {
  const response = await fetch(`${reviewEndpoint}${pathName}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 400)}`);
  }
  if (!streamResponse) return JSON.parse(await response.text());
  const content = await readChatCompletionStream(response, timeout);
  return { choices: [{ message: { content } }], usage: null };
}

async function readChatCompletionStream(response, bodyTimeoutMs) {
  if (!response.body) throw new Error('stream response missing body');
  const reader = response.body.getReader();
  let timer;
  const consume = (async () => {
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        content += JSON.parse(data)?.choices?.[0]?.delta?.content || '';
      }
      if (done) break;
    }
    return content;
  })();
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reader.cancel('stream_body_timeout').catch(() => {});
      reject(new Error(`stream_body_timeout_${bodyTimeoutMs}ms`));
    }, bodyTimeoutMs);
  });
  try {
    return await Promise.race([consume, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(reviewEndpoint, pathName, timeout) {
  const response = await fetch(`${reviewEndpoint}${pathName}`, {
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

function validateReview(parsed) {
  if (!['accept', 'reject', 'manual_review'].includes(parsed?.decision)) {
    throw new Error(`invalid_decision:${JSON.stringify(parsed).slice(0, 240)}`);
  }
  const confidence = Number(parsed?.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error('invalid_confidence');
  }
  if (typeof parsed?.reason !== 'string' || !parsed.reason.trim()) {
    throw new Error('missing_reason');
  }
  if (!Array.isArray(parsed?.corrections)) throw new Error('invalid_corrections');
  if (parsed.decision === 'accept' && parsed.corrections.length) {
    throw new Error('accepted_with_corrections');
  }
  if (!promptMode.startsWith('nano') && parsed.decision !== 'accept' && !parsed.corrections.length) {
    throw new Error('rejected_without_corrections');
  }
  for (const correction of parsed.corrections) validateCorrection(correction);
}

function validateDeterministicCorrectionPolicy(parsed, payload) {
  for (const correction of parsed?.corrections || []) {
    if (!['reading', 'pronunciation'].includes(correction?.field)) continue;
    const localization = payload?.generated_localizations?.[correction.language];
    const source = String(
      correction.field === 'reading'
        ? localization?.reading_source || ''
        : localization?.pronunciation_source || ''
    );
    if (source.startsWith('deterministic:')) {
      throw new Error(
        `reviewer_overrode_authoritative_${correction.field}:${correction.language}:${source}`
      );
    }
  }
}

function validateCorrection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_correction_object');
  }
  if (!['en', 'pt-BR', 'zh', 'ja', 'all'].includes(value.language)) {
    throw new Error('invalid_correction_language');
  }
  if (!['term', 'definition', 'reading', 'pronunciation', 'example', 'sense'].includes(value.field)) {
    throw new Error('invalid_correction_field');
  }
  if (typeof value.current !== 'string' || !value.current.trim()) {
    throw new Error('invalid_correction_current');
  }
  if (value.replacement !== null && (typeof value.replacement !== 'string' || !value.replacement.trim())) {
    throw new Error('invalid_correction_replacement');
  }
  if (typeof value.issue !== 'string' || !value.issue.trim()) {
    throw new Error('invalid_correction_issue');
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

function normalizeCorrection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    language: value.language,
    field: value.field,
    current: value.current.trim(),
    replacement: typeof value.replacement === 'string' ? value.replacement.trim() : null,
    issue: value.issue.trim()
  };
}

function normalizedFamily(value) {
  const text = String(value).toLowerCase();
  if (text.includes('qwen')) return 'qwen';
  if (text.includes('gemma')) return 'gemma';
  return text.split('/').pop()?.split(/[-_:]/u)[0] || text;
}

function normalizeChatPath(value) {
  const normalized = String(value || '').trim();
  if (!normalized.startsWith('/') || normalized.includes('://') || normalized.includes('..')) {
    throw new Error(`Invalid --chat-path: ${value}`);
  }
  return normalized;
}

function parseEndpointVariants(value) {
  const parsed = {};
  for (const item of String(value || '').split(',').map((part) => part.trim()).filter(Boolean)) {
    const separator = item.indexOf('=');
    if (separator < 1) throw new Error(`Invalid --endpoint-gguf-variants item: ${item}`);
    parsed[item.slice(0, separator).trim()] = item.slice(separator + 1).trim();
  }
  return parsed;
}

function endpointPort(value) {
  try {
    return new URL(value).port;
  } catch {
    return value;
  }
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return path.resolve(value);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function roundSeconds(milliseconds) {
  return Number((milliseconds / 1000).toFixed(2));
}

function boundedInteger(value, fallback, minimum) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < minimum) throw new Error(`Invalid integer: ${value}`);
  return parsed;
}

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Invalid number: ${value}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}
