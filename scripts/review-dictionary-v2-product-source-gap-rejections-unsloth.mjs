import './lib/load-local-env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const DEFAULT_REPORT = 'logs/product-source-gap-v83-production-500-promote-dry-run-r2.json';
const DEFAULT_OUT = 'logs/product-source-gap-v83-production-500-semantic-review.json';
const DEFAULT_ENDPOINTS = ['http://100.99.99.99:11441', 'http://100.99.99.99:11447'];
const DEFAULT_MODEL = 'unsloth/Qwen3.6-35B-A3B-MTP-GGUF';
const DEFAULT_VARIANTS = { 11441: 'UD-Q4_K_XL', 11447: 'UD-IQ4_NL' };
const DECISIONS = new Set(['accept_synonym', 'reject_mistranslation', 'manual_review']);

const args = parseArgs(process.argv.slice(2));
const reportPath = path.resolve(args.report || DEFAULT_REPORT);
const outPath = path.resolve(args.out || DEFAULT_OUT);
const token = args.token || process.env.UNSLOTH_API_KEY;
const endpoints = String(args.endpoints || DEFAULT_ENDPOINTS.join(','))
  .split(',')
  .map((value) => value.trim().replace(/\/$/u, ''))
  .filter(Boolean);
const variants = parseEndpointMap(args['endpoint-gguf-variants'], DEFAULT_VARIANTS);
const model = String(args.model || DEFAULT_MODEL);
const limit = boundedInteger(args.limit, 500, 1);
const confidenceThreshold = boundedNumber(args['confidence-threshold'], 0.9, 0, 1);
const timeoutMs = boundedInteger(args['timeout-ms'], 180_000, 1_000);
const maxTokens = boundedInteger(args['max-tokens'], 300, 100);
const maxAttempts = boundedInteger(args['max-attempts'], 2, 1, 3);
const prewarm = args.prewarm !== 'false';

if (!fs.existsSync(reportPath)) throw new Error(`Promote report not found: ${reportPath}`);
if (!token) throw new Error('Missing --token or UNSLOTH_API_KEY');
if (!endpoints.length) throw new Error('No endpoints configured');

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const selected = (report.rejected || []).slice(0, limit);
if (!selected.length) throw new Error('Promote report has no rejected rows');

const started = performance.now();
const prewarmResults = prewarm ? await prewarmEndpoints() : [];
const reviews = await runPool(selected);
const output = buildOutput();
writeOutput(output);
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2));

async function runPool(rows) {
  const results = new Array(rows.length);
  let nextIndex = 0;

  async function worker(endpoint) {
    while (nextIndex < rows.length) {
      const index = nextIndex++;
      const row = rows[index];
      results[index] = await reviewWithRetry(row, endpoint);
      const current = results[index];
      console.log(
        `[${index + 1}/${rows.length}] sense=${row.sense_id} ${row.headword} endpoint=${endpointPort(endpoint)} ` +
          `decision=${current.valid ? current.decision : 'error'} confidence=${current.confidence ?? '-'}`
      );
      writeOutput(buildOutput(results.filter(Boolean)));
    }
  }

  await Promise.all(endpoints.map((endpoint) => worker(endpoint)));
  return results;
}

async function reviewWithRetry(row, endpoint) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await reviewRow(row, endpoint, attempt, lastError);
    } catch (error) {
      lastError = errorMessage(error);
    }
  }
  return {
    sense_id: Number(row.sense_id),
    entry_id: Number(row.entry_id),
    headword: row.headword,
    primary_lang: row.primary_lang,
    endpoint,
    valid: false,
    decision: null,
    confidence: null,
    approved: false,
    error: lastError
  };
}

async function reviewRow(row, endpoint, attempt, previousError) {
  const requestStarted = performance.now();
  const payload = compactPayload(row);
  const data = await postJson(
    endpoint,
    '/v1/chat/completions',
    {
      model,
      stream: false,
      temperature: 0,
      max_tokens: maxTokens,
      enable_thinking: false,
      reasoning_effort: 'none',
      messages: [
        {
          role: 'system',
          content:
            'You are a conservative multilingual lexicographer auditing an EN/PT-BR/ZH/JA dictionary. ' +
            'Return one JSON object only. Never approve a plausible-looking mistranslation.'
        },
        { role: 'user', content: buildPrompt(payload, previousError) }
      ]
    },
    timeoutMs
  );
  const content = String(data?.choices?.[0]?.message?.content || '');
  const parsed = parseJson(content);
  const errors = validateReview(parsed);
  if (errors.length) throw new Error(`invalid_review:${errors.join(',')}; raw=${content.slice(0, 300)}`);
  return {
    sense_id: Number(row.sense_id),
    entry_id: Number(row.entry_id),
    headword: row.headword,
    primary_lang: row.primary_lang,
    source_gloss: row.gloss_key,
    deterministic_errors: row.errors,
    endpoint,
    attempt,
    seconds: secondsSince(requestStarted),
    usage: data.usage || null,
    valid: true,
    decision: parsed.decision,
    confidence: parsed.confidence,
    approved: parsed.decision === 'accept_synonym' && parsed.confidence >= confidenceThreshold,
    reason: parsed.reason,
    evidence: parsed.evidence,
    risk_flags: parsed.risk_flags,
    payload,
    raw_preview: content.slice(0, 1000)
  };
}

function compactPayload(row) {
  return {
    sense_id: Number(row.sense_id),
    headword: row.headword,
    source_language: row.primary_lang,
    source_gloss: row.gloss_key,
    deterministic_errors: row.errors,
    generated: Object.fromEntries(
      Object.entries(row.localizations || {}).map(([lang, loc]) => [
        lang,
        {
          term: loc?.term || null,
          reading: loc?.reading || null,
          pronunciation: loc?.pronunciation || null,
          definition: loc?.definition || null
        }
      ])
    )
  };
}

function buildPrompt(payload, previousError) {
  return `Decide whether this generated four-language sense faithfully represents the source headword and source gloss.

Decision rules:
- Treat the source-language headword as the lexical object being defined. Source glosses are noisy bilingual evidence and may contain approximate synonyms, terse wording, or several close alternatives; they are not an exact-string gold standard.
- accept_synonym: the generated sense is a valid common sense of the source headword, all four generated terms/definitions agree, and it is compatible with at least one reasonable interpretation of the source gloss. Different wording, inflection, register-neutral equivalents, or true synonyms are acceptable. For example, mate/friend and squeeze/embrace can be compatible when the headword supports that sense.
- reject_mistranslation: any generated language changes the meaning, selects the wrong homograph/reading, invents a named entity, or supplies only a romanization when a normal translated term exists.
- manual_review: the source gloss combines multiple incompatible senses, is too ambiguous/thin to verify, evidence is insufficient, or the row is primarily a proper name/person/place rather than a general dictionary sense.
- A broad source gloss may be accepted only when its alternatives are close synonyms for one coherent sense and the generated sense preserves that meaning.
- Be conservative. Natural-looking definitions are not evidence that the selected source sense is correct.
- Keep the response concise: reason at most 20 words, exactly one evidence item at most 20 words, and at most two risk flags.

Return exactly:
{
  "decision": "accept_synonym" | "reject_mistranslation" | "manual_review",
  "confidence": 0.0,
  "reason": "at most 20 words",
  "evidence": ["one specific comparison, at most 20 words"],
  "risk_flags": ["wrong_homograph" | "romanization_only" | "sense_narrowing" | "sense_broadening" | "source_ambiguous" | "cross_language_mismatch"]
}
${previousError ? `Previous attempt failed validation: ${previousError.slice(0, 300)}\n` : ''}
Input:
${JSON.stringify(payload, null, 2)}`;
}

function validateReview(parsed) {
  const errors = [];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return ['not_object'];
  if (!DECISIONS.has(parsed.decision)) errors.push('invalid_decision');
  if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1)
    errors.push('invalid_confidence');
  if (typeof parsed.reason !== 'string' || !parsed.reason.trim()) errors.push('missing_reason');
  if (!Array.isArray(parsed.evidence) || !parsed.evidence.length) errors.push('missing_evidence');
  if (!Array.isArray(parsed.risk_flags)) errors.push('invalid_risk_flags');
  return errors;
}

async function prewarmEndpoints() {
  return Promise.all(
    endpoints.map(async (endpoint) => {
      const started = performance.now();
      try {
        const data = await postJson(
          endpoint,
          '/v1/load',
          {
            model_path: model,
            max_seq_length: 1024,
            load_in_4bit: false,
            speculative_type: 'off',
            gguf_variant: variants[endpointPort(endpoint)]
          },
          300_000
        );
        return {
          endpoint,
          ok: true,
          seconds: secondsSince(started),
          variant: variants[endpointPort(endpoint)],
          model: data.model_path || model
        };
      } catch (error) {
        return {
          endpoint,
          ok: false,
          seconds: secondsSince(started),
          variant: variants[endpointPort(endpoint)],
          error: errorMessage(error)
        };
      }
    })
  );
}

async function postJson(endpoint, pathName, body, timeout) {
  const response = await fetch(`${endpoint}${pathName}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`non_json_response:${text.slice(0, 500)}`);
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

function buildOutput(rows = reviews || []) {
  const completed = rows.filter(Boolean);
  return {
    ok: completed.every((row) => row.valid),
    created_at: new Date().toISOString(),
    report: path.relative(process.cwd(), reportPath),
    model,
    endpoints,
    endpoint_variants: variants,
    confidence_threshold: confidenceThreshold,
    seconds: secondsSince(started),
    prewarm_results: prewarmResults,
    summary: {
      selected: selected.length,
      completed: completed.length,
      valid: completed.filter((row) => row.valid).length,
      invalid: completed.filter((row) => !row.valid).length,
      approved: completed.filter((row) => row.approved).length,
      by_decision: countBy(completed.map((row) => (row.valid ? row.decision : 'invalid'))),
      by_endpoint: countBy(completed.map((row) => endpointPort(row.endpoint))),
      avg_seconds: completed.length
        ? Number((completed.reduce((sum, row) => sum + Number(row.seconds || 0), 0) / completed.length).toFixed(2))
        : 0
    },
    reviews: completed
  };
}

function writeOutput(value) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tempPath = `${outPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tempPath, outPath);
}

function parseEndpointMap(value, defaults) {
  const result = { ...defaults };
  for (const part of String(value || '').split(',')) {
    const separator = part.indexOf('=');
    if (separator > 0) result[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
  }
  return result;
}

function endpointPort(endpoint) {
  try {
    return new URL(endpoint).port;
  } catch {
    return endpoint;
  }
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function boundedInteger(value, fallback, min, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`Invalid integer: ${value}`);
  return parsed;
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`Invalid number: ${value}`);
  return parsed;
}

function secondsSince(startedAt) {
  return Number(((performance.now() - startedAt) / 1000).toFixed(2));
}

function errorMessage(error) {
  return error?.message || String(error);
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
      parsed[key] = 'true';
    }
  }
  return parsed;
}
