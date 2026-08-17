import './lib/load-local-env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const args = parseArgs(process.argv.slice(2));
const token = args.token || process.env.UNSLOTH_API_KEY;
if (!token) throw new Error('Missing --token or UNSLOTH_API_KEY');

const model = args.model || 'unsloth/Qwen3.6-35B-A3B-MTP-GGUF';
const outPath = path.resolve(args.out || 'logs/unsloth-studio-cluster-test.json');
const loadTimeoutMs = Number(args['load-timeout-ms'] || 300_000);
const inferTimeoutMs = Number(args['infer-timeout-ms'] || 180_000);
const endpoints = [
  { name: 'a6000-143', url: 'http://100.99.99.99:11441' },
  { name: 'a6000-147', url: 'http://100.99.99.99:11444' },
  { name: 'rtx4090-47', url: 'http://100.99.99.99:11448' },
  { name: 'rtx4090-56', url: 'http://100.99.99.99:11447' }
];

const rows = [];
for (const endpoint of endpoints) {
  console.log(`\n== ${endpoint.name} ${endpoint.url}`);
  const status = await getJson(endpoint, '/v1/status', 30_000).catch((error) => ({
    ok: false,
    error: errorMessage(error)
  }));
  const models = await getJson(endpoint, '/api/models/local', 60_000).catch((error) => ({
    models: [],
    error: errorMessage(error)
  }));
  const hasModel =
    Array.isArray(models.models) && models.models.some((item) => item.id === model || item.model_id === model);
  let load = { ok: false, skipped: false, seconds: 0, error: '' };
  if (!hasModel) {
    load = { ok: false, skipped: true, seconds: 0, error: 'model_not_found' };
  } else if (status.active_model === model) {
    load = { ok: true, skipped: true, seconds: 0, error: '' };
  } else {
    load = await loadModel(endpoint, status);
  }
  console.log(
    `[load] ok=${load.ok} skipped=${load.skipped} seconds=${load.seconds}${load.error ? ` error=${load.error}` : ''}`
  );

  let inference = null;
  if (load.ok) {
    inference = await runDictionarySmoke(endpoint);
    console.log(
      `[infer] ok=${inference.ok} seconds=${inference.seconds} score=${inference.score}/${inference.max_score}` +
        (inference.error ? ` error=${inference.error}` : '')
    );
  }

  rows.push({
    endpoint,
    status_before: compactStatus(status),
    model_available: hasModel,
    load,
    inference
  });
}

const summary = rows.map((row) => ({
  node: row.endpoint.name,
  url: row.endpoint.url,
  model_available: row.model_available,
  load_ok: row.load.ok,
  load_seconds: row.load.seconds,
  infer_ok: Boolean(row.inference?.ok),
  infer_seconds: row.inference?.seconds ?? null,
  score: row.inference ? `${row.inference.score}/${row.inference.max_score}` : null,
  error: row.load.error || row.inference?.error || ''
}));

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(
  outPath,
  JSON.stringify({ ok: true, created_at: new Date().toISOString(), model, summary, rows }, null, 2),
  'utf8'
);
console.table(summary);
console.log(JSON.stringify({ out: path.relative(process.cwd(), outPath), summary }, null, 2));

async function loadModel(endpoint, status) {
  const started = performance.now();
  const speculativeType = status?.llama_cpp_supports_mtp === false ? 'off' : 'mtp';
  try {
    const data = await postJson(
      endpoint,
      '/v1/load',
      {
        model_path: model,
        max_seq_length: 8192,
        load_in_4bit: true,
        speculative_type: speculativeType
      },
      loadTimeoutMs
    );
    return {
      ok: true,
      skipped: false,
      seconds: secondsSince(started),
      display_name: data.display_name || '',
      is_gguf: Boolean(data.is_gguf),
      requested_speculative_type: speculativeType,
      speculative_type: data.speculative_type || speculativeType,
      context_length: data.context_length || null,
      error: ''
    };
  } catch (error) {
    return { ok: false, skipped: false, seconds: secondsSince(started), error: errorMessage(error) };
  }
}

async function runDictionarySmoke(endpoint) {
  const started = performance.now();
  try {
    const data = await postJson(
      endpoint,
      '/v1/chat/completions',
      {
        model,
        stream: false,
        temperature: 0,
        max_tokens: 700,
        enable_thinking: false,
        reasoning_effort: 'none',
        messages: [
          {
            role: 'system',
            content: 'You generate four-language dictionary data. Return only valid JSON.'
          },
          {
            role: 'user',
            content:
              'Create a compact dictionary entry for the Chinese character \\u4e2d. ' +
              'Return JSON with word, source_lang, senses. Include two readings: zhong1 and zhong4. ' +
              'Each sense must include en, zh, ja, pt-BR term, reading_or_pronunciation, definition, example.'
          }
        ]
      },
      inferTimeoutMs
    );
    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = parseJson(content);
    const score = scoreOutput(parsed);
    return {
      ok: score.errors.length === 0 && score.score >= 8,
      seconds: secondsSince(started),
      score: score.score,
      max_score: score.max_score,
      errors: score.errors,
      usage: data.usage || null,
      raw_preview: content.slice(0, 1200),
      output: parsed,
      error: ''
    };
  } catch (error) {
    return {
      ok: false,
      seconds: secondsSince(started),
      score: 0,
      max_score: 10,
      errors: [errorMessage(error)],
      raw_preview: '',
      output: null,
      error: errorMessage(error)
    };
  }
}

function scoreOutput(output) {
  const errors = [];
  let score = 0;
  const max_score = 10;
  if (!output || typeof output !== 'object') return { score, max_score, errors: ['not_json'] };
  const text = JSON.stringify(output).toLowerCase();
  if (text.includes('\\u4e2d') || text.includes('中')) score += 1;
  else errors.push('missing_word');
  if (text.includes('zhong1') || text.includes('zhōng')) score += 1;
  else errors.push('missing_zhong1');
  if (text.includes('zhong4') || text.includes('zhòng')) score += 1;
  else errors.push('missing_zhong4');
  for (const lang of ['en', 'zh', 'ja', 'pt-br']) {
    if (text.includes(lang)) score += 1;
    else errors.push(`missing_${lang}`);
  }
  if (text.includes('middle') || text.includes('center')) score += 1;
  else errors.push('missing_middle_meaning');
  if (text.includes('hit') || text.includes('target') || text.includes('acert')) score += 1;
  else errors.push('missing_hit_meaning');
  if (Array.isArray(output.senses) && output.senses.length >= 2) score += 1;
  else errors.push('not_split_into_two_senses');
  return { score, max_score, errors };
}

async function getJson(endpoint, pathName, timeoutMs) {
  return fetchJson(endpoint.url + pathName, {
    headers: { authorization: `Bearer ${token}` },
    timeoutMs
  });
}

async function postJson(endpoint, pathName, body, timeoutMs) {
  return fetchJson(endpoint.url + pathName, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs
  });
}

async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = 30_000 }) {
  const response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`non_json_response: ${text.slice(0, 500)}`);
  }
}

function parseJson(content) {
  const text = String(content || '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function compactStatus(status) {
  return {
    active_model: status.active_model || null,
    loading: status.loading || [],
    loaded: status.loaded || [],
    llama_cpp_supports_mtp: status.llama_cpp_supports_mtp ?? null,
    context_length: status.context_length || null
  };
}

function secondsSince(started) {
  return Number(((performance.now() - started) / 1000).toFixed(2));
}

function errorMessage(error) {
  return `${error?.name || 'Error'}: ${error?.message || String(error)}`;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) parsed[key] = 'true';
    else {
      parsed[key] = next;
      index++;
    }
  }
  return parsed;
}
