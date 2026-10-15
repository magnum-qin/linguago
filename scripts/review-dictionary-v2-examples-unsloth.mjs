#!/usr/bin/env node
// Gemma independently reviews each generated example: does the sentence use
// the headword in the intended sense, and are all four translations faithful?
// Accepts only explicit accepts at confidence >= threshold (default 0.9).

import fs from 'node:fs';
import path from 'node:path';
import { ensureUnslothModel } from './lib/unsloth-elastic-model.mjs';

const args = parseArgs(process.argv.slice(2));
const generationPath = requiredPath(args.generation, 'generation');
const outPath = path.resolve(args.out || 'logs/example-enrichment-review.json');
const endpoints = String(args.endpoints || 'http://127.0.0.1:11441,http://127.0.0.1:11442,http://127.0.0.1:11443,http://127.0.0.1:11444,http://127.0.0.1:11445,http://127.0.0.1:11446,http://127.0.0.1:11447,http://127.0.0.1:11448')
  .split(',').map((v) => v.trim()).filter(Boolean);
const model = String(args.model || 'unsloth/gemma-4-31B-it-qat-GGUF');
const variant = String(args['gguf-variant'] || 'UD-Q4_K_XL');
const token = process.env.UNSLOTH_API_KEY;
const confidenceThreshold = boundedNumber(args['confidence-threshold'], 0.9, 0, 1);
const concurrencyPerEndpoint = positiveInteger(args['concurrency-per-endpoint'], 4);
const timeoutMs = positiveInteger(args['timeout-ms'], 60_000);
const retryDecisions = new Set(['manual_review']);
if (!token) throw new Error('UNSLOTH_API_KEY is not set');

const generation = JSON.parse(fs.readFileSync(generationPath, 'utf8'));
const targets = (generation.generated || []).filter((row) => row.valid && row.output);
if (!targets.length) throw new Error('Generation report has no valid rows');

const previous = loadPreviousDecisions();
const reviews = [];
let cursor = 0;
const startedAt = Date.now();

await Promise.all(
  endpoints.map(async (endpoint) => {
    const load = await ensureUnslothModel({
      endpoint, token, model, variant,
      maxSeqLength: 2048, speculativeType: 'off', loadOptions: { n_parallel: concurrencyPerEndpoint }
    }).catch((error) => ({ ok: false, error: String(error.message || error) }));
    if (!load.ok) {
      console.log(`[examples-review] endpoint_unavailable ${endpoint}: ${load.error}`);
      return;
    }
    await Promise.all(
      Array.from({ length: concurrencyPerEndpoint }, () => reviewLane(endpoint))
    );
  })
);

const output = {
  ok: reviews.every((row) => row.valid),
  generated_at: new Date().toISOString(),
  generation_report: path.relative(process.cwd(), generationPath),
  policy: {
    reviewer_model: model,
    endpoints,
    confidence_threshold: confidenceThreshold,
    retry_decisions: [...retryDecisions],
    automatic_publication: false
  },
  summary: {
    reviewed: reviews.length,
    accepted: reviews.filter((row) => row.decision === 'accept').length,
    rejected: reviews.filter((row) => row.decision === 'reject').length,
    manual_review: reviews.filter((row) => row.decision === 'manual_review').length
  },
  reviews
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(output.summary));

async function reviewLane(endpoint) {
  while (true) {
    const index = cursor++;
    if (index >= targets.length) return;
    const row = targets[index];
    const key = `sense:${Number(row.product_sense_id)}`;
    if (previous.has(key) && !retryDecisions.has(previous.get(key))) continue;
    const review = {
      product_sense_id: row.product_sense_id,
      headword: row.headword,
      primary_lang: row.primary_lang,
      source_text: row.output.source_text,
      translations: row.output.translations,
      ja_reading: row.output.ja_reading || null,
      endpoint,
      attempts: 0,
      decision: 'manual_review',
      confidence: null,
      reason: '',
      valid: false,
      errors: []
    };
    reviews.push(review);
    for (let attempt = 1; attempt <= 3 && !review.valid; attempt += 1) {
      review.attempts = attempt;
      try {
        const verdict = await reviewExample(endpoint, row, attempt > 1 ? review.errors[review.errors.length - 1] : null);
        review.decision = verdict.decision;
        review.confidence = verdict.confidence;
        review.reason = verdict.reason;
        review.valid = true;
      } catch (error) {
        review.errors.push(String(error.message || error).slice(0, 240));
      }
    }
    if (!review.valid) review.decision = 'manual_review';
  }
}

async function reviewExample(endpoint, row, previousError) {
  const output = row.output;
  const prompt = [
    'JSON only. Independently check this dictionary example.',
    `W=${JSON.stringify(row.headword)};L=${JSON.stringify(row.primary_lang)};M=${JSON.stringify(String(row.gloss_key || '').slice(0, 160))};S=${JSON.stringify(output.source_text)};X=${JSON.stringify(output.translations)};R=${JSON.stringify(output.ja_reading || '')}.`,
    'Check: (1) sentence S is in language L, is natural everyday usage, and uses W in sense M; (2) all four entries of X are faithful translations of S; (3) R is correct kana for X.ja when present.',
    'Return keys d,c,r: d=A accept, R reject, M unsure; c=confidence 0..1; r=short reason. Use A and c>=0.9 only if all checks pass.'
  ].join(' ') + (previousError ? ` Fix:${JSON.stringify(previousError)}.` : '');
  const data = await postJson(endpoint, '/v1/chat/completions', {
    model, stream: false, temperature: 0, max_tokens: 400,
    enable_thinking: false, reasoning_effort: 'none',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are a strict multilingual dictionary reviewer. Return JSON only.' },
      { role: 'user', content: prompt }
    ]
  }, timeoutMs);
  const content = String(data?.choices?.[0]?.message?.content || '');
  const parsed = parseJson(content);
  const raw = String(parsed?.d ?? parsed?.decision ?? '').toUpperCase();
  const decision = { A: 'accept', ACCEPT: 'accept', R: 'reject', REJECT: 'reject', M: 'manual_review', MANUAL_REVIEW: 'manual_review' }[raw];
  if (!decision) throw new Error(`invalid decision; raw=${content.slice(0, 160)}`);
  const confidence = Number(parsed?.c ?? parsed?.confidence);
  if (!Number.isFinite(confidence)) throw new Error('missing confidence');
  const reason = String(parsed?.r ?? parsed?.reason ?? '').slice(0, 240);
  if (decision === 'accept' && confidence < confidenceThreshold) {
    return { decision: 'manual_review', confidence, reason: reason || 'below threshold' };
  }
  return { decision, confidence, reason };
}

function parseJson(content) {
  const text = String(content || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error(`no json; raw=${text.slice(0, 160)}`);
  return JSON.parse(text.slice(start, end + 1));
}

async function postJson(endpoint, pathname, body, timeout) {
  const response = await fetch(new URL(pathname, endpoint), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`);
  return response.json();
}

function loadPreviousDecisions() {
  try {
    const existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    return new Map((existing.reviews || []).map((row) => [`sense:${Number(row.product_sense_id)}`, row.decision]));
  } catch {
    return new Map();
  }
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) throw new Error(`Required file not found: ${resolved}`);
  return resolved;
}
function positiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Invalid positive integer: ${value}`);
  return parsed;
}
function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`Invalid number: ${value}`);
  return parsed;
}
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    out[key] = next && !next.startsWith('--') ? argv[++i] : 'true';
  }
  return out;
}
