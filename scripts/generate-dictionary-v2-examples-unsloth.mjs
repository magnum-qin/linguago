#!/usr/bin/env node
// Qwen generates one everyday example sentence per selected sense, with
// four-language translations. Output is draft-only; the Gemma reviewer and
// the apply-time structural gates decide what is publishable.

import fs from 'node:fs';
import path from 'node:path';
import { ensureUnslothModel } from './lib/unsloth-elastic-model.mjs';

const args = parseArgs(process.argv.slice(2));
const cohortPath = requiredPath(args.cohort, 'cohort');
const outPath = path.resolve(args.out || 'logs/example-enrichment-generation.json');
const endpoints = String(args.endpoints || 'http://127.0.0.1:11441,http://127.0.0.1:11442,http://127.0.0.1:11443,http://127.0.0.1:11444,http://127.0.0.1:11445,http://127.0.0.1:11446,http://127.0.0.1:11447,http://127.0.0.1:11448')
  .split(',').map((v) => v.trim()).filter(Boolean);
const model = String(args.model || 'unsloth/Qwen3.6-35B-A3B-MTP-GGUF');
const variant = String(args['gguf-variant'] || 'UD-Q4_K_XL');
const token = process.env.UNSLOTH_API_KEY;
const limit = positiveInteger(args.limit, 1_000_000);
const concurrencyPerEndpoint = positiveInteger(args['concurrency-per-endpoint'], 4);
const timeoutMs = positiveInteger(args['timeout-ms'], 60_000);
const checkpointEvery = positiveInteger(args['checkpoint-every'], 50);
if (!token) throw new Error('UNSLOTH_API_KEY is not set');

const cohort = JSON.parse(fs.readFileSync(cohortPath, 'utf8'));
const targets = (cohort.selected || []).slice(0, limit);
if (!targets.length) throw new Error('Cohort has no selected senses');

const generations = [];
const completed = new Set(loadCheckpointKeys());
const workers = endpoints.flatMap((endpoint) =>
  Array.from({ length: concurrencyPerEndpoint }, () => ({ endpoint, ok: true }))
);
let cursor = 0;
let checkpointCounter = 0;
const startedAt = Date.now();

await Promise.all(
  workers.map(async (worker) => {
    const load = await ensureUnslothModel({
      endpoint: worker.endpoint, token, model, variant,
      maxSeqLength: 2048, speculativeType: 'off', loadOptions: { n_parallel: concurrencyPerEndpoint }
    }).catch((error) => ({ ok: false, error: String(error.message || error) }));
    worker.ok = Boolean(load.ok);
    if (!worker.ok) console.log(`[examples] endpoint_unavailable ${worker.endpoint}: ${worker.error}`);
  })
);
const activeEndpoints = workers.filter((w) => w.ok).map((w) => w.endpoint);
if (!activeEndpoints.length) throw new Error('No healthy generation endpoints');

await Promise.all(
  activeEndpoints.map(async (endpoint) => {
    for (let lane = 0; lane < concurrencyPerEndpoint; lane += 1) {
      await runLane(endpoint, lane);
    }
  })
);

writeOutput();
console.log(JSON.stringify({
  ok: generations.every((row) => row.valid),
  generated: generations.length,
  valid: generations.filter((row) => row.valid).length,
  out: path.relative(process.cwd(), outPath),
  seconds: ((Date.now() - startedAt) / 1000).toFixed(1)
}));

async function runLane(endpoint, lane) {
  while (true) {
    const index = cursor++;
    if (index >= targets.length) return;
    const row = targets[index];
    if (completed.has(senseKey(row))) continue;
    const generated = { ...identity(row), endpoint, attempts: 0, valid: false, errors: [], output: null };
    generations.push(generated);
    for (let attempt = 1; attempt <= 3 && !generated.valid; attempt += 1) {
      generated.attempts = attempt;
      try {
        generated.output = await generateExample(endpoint, row, attempt > 1 ? generated.errors[generated.errors.length - 1] : null);
        generated.valid = true;
      } catch (error) {
        generated.errors.push(String(error.message || error).slice(0, 240));
      }
    }
    checkpointCounter += 1;
    if (checkpointCounter % checkpointEvery === 0) writeOutput(true);
    if (generations.length % 100 === 0) {
      console.log(`[examples] progress=${generations.length}/${targets.length} valid=${generations.filter((g) => g.valid).length}`);
    }
  }
}

async function generateExample(endpoint, row, previousError) {
  const langName = { zh: 'Simplified Chinese', ja: 'Japanese', en: 'English', 'pt-BR': 'Brazilian Portuguese' }[row.primary_lang] || row.primary_lang;
  const prompt = [
    'Write ONE natural everyday example sentence for the dictionary sense below.',
    `W=${JSON.stringify(row.headword)};L=${JSON.stringify(row.primary_lang)};M=${JSON.stringify(String(row.gloss_key || '').slice(0, 160))};POS=${JSON.stringify(String(row.part_of_speech || '').slice(0, 40))}.`,
    `The sentence MUST be written in ${langName} (language L) and must actually contain the word W in this sense. Everyday register, 6-18 words for latin scripts or 8-30 chars for CJK.`,
    'Also give faithful translations of the same sentence in the other three languages.',
    'Return JSON only: {"source_text":"...","translations":{"en":"...","zh":"...","ja":"...","pt-BR":"..."},"ja_reading":"kana reading of the ja sentence or empty"}.',
    previousError ? `Fix:${JSON.stringify(previousError)}.` : ''
  ].join(' ');
  const data = await postJson(endpoint, '/v1/chat/completions', {
    model, stream: false, temperature: 0.3, max_tokens: 500,
    enable_thinking: false, reasoning_effort: 'none',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are a multilingual lexicographer writing concise dictionary examples. Return JSON only.' },
      { role: 'user', content: prompt }
    ]
  }, timeoutMs);
  const content = String(data?.choices?.[0]?.message?.content || '');
  const parsed = parseJson(content);
  const sourceText = cleanSentence(parsed?.source_text);
  const translations = {};
  for (const lang of ['en', 'zh', 'ja', 'pt-BR']) {
    translations[lang] = cleanSentence(parsed?.translations?.[lang]);
  }
  if (!sourceText) throw new Error(`missing source_text; raw=${content.slice(0, 160)}`);
  if (Object.values(translations).some((text) => !text)) throw new Error('missing translation');
  // Cheap language sanity gate before the expensive review: zh sentences must
  // not be kana-dominant Japanese, ja sentences must contain kana.
  const kanaCount = (sourceText.match(/[\u3040-\u30ff]/gu) || []).length;
  const cjkCount = (sourceText.match(/[\u4e00-\u9fff]/gu) || []).length;
  if (row.primary_lang === 'zh' && kanaCount > cjkCount / 2) throw new Error('source_text is Japanese, not Chinese');
  if (row.primary_lang === 'ja' && kanaCount === 0 && cjkCount > 0 && !translations.ja) throw new Error('source_text lacks kana');
  if (translations[row.primary_lang] !== sourceText && row.primary_lang !== 'en') {
    // Keep the source-language slot aligned with the generated sentence.
    translations[row.primary_lang] = sourceText;
  }
  const jaReading = cleanSentence(parsed?.ja_reading) || null;
  // Reading is optional enrichment; a romaji or malformed reading drops the
  // reading, not the whole example.
  if (jaReading && !/^[\u3040-\u30ff\u3005\u30fc\s]+$/u.test(jaReading)) return {
    source_text: sourceText,
    translations,
    ja_reading: null
  };
  return { source_text: sourceText, translations, ja_reading: jaReading };
}

function cleanSentence(value) {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  if (!text || text.length > 200) return '';
  if (/[\uFFFD]|<[^>]+>|\{|\}/u.test(text)) return '';
  return text;
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

function identity(row) {
  return {
    product_sense_id: row.product_sense_id,
    sense_order: row.sense_order,
    headword: row.headword,
    primary_lang: row.primary_lang,
    frequency_rank: row.frequency_rank,
    gloss_key: row.gloss_key
  };
}

function senseKey(row) {
  return `sense:${Number(row.product_sense_id)}`;
}

function loadCheckpointKeys() {
  try {
    const existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    return (existing.generated || [])
      .filter((row) => row?.valid && row?.output)
      .map((row) => `sense:${Number(row.product_sense_id)}`);
  } catch {
    return [];
  }
}

function writeOutput(silent) {
  const output = {
    ok: generations.every((row) => row.valid),
    generated_at: new Date().toISOString(),
    cohort: path.relative(process.cwd(), cohortPath),
    policy: {
      model,
      endpoints,
      concurrency_per_endpoint: concurrencyPerEndpoint,
      automatic_publication: false,
      draft_only: true
    },
    summary: {
      generated: generations.length,
      valid: generations.filter((row) => row.valid).length
    },
    generated: generations.map((row) => ({ ...row, output: row.valid ? row.output : null }))
  };
  const temporary = `${outPath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify(output, null, 2) + '\n', 'utf8');
  fs.renameSync(temporary, outPath);
  if (!silent) return output;
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
