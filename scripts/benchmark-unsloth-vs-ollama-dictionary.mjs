import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const args = parseArgs(process.argv.slice(2));
const unslothBaseUrl = String(
  args['unsloth-base-url'] || 'https://trading-overhead-herbs-controversial.trycloudflare.com'
).replace(/\/$/, '');
const unslothToken = String(args['unsloth-token'] || process.env.UNSLOTH_API_KEY || '');
const ollamaBaseUrl = String(args['ollama-base-url'] || 'http://100.99.99.99:11441').replace(/\/$/, '');
const outPath = path.resolve(args.out || 'logs/unsloth-vs-ollama-dictionary-benchmark.json');
const maxModels = args['max-models'] ? Number(args['max-models']) : 0;
const unslothModelFilter = args['unsloth-models']
  ? new Set(
      String(args['unsloth-models'])
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  : null;
const perModelTimeoutMs = Number(args['timeout-ms'] || 180_000);
const loadTimeoutMs = Number(args['load-timeout-ms'] || 240_000);
const maxTokens = Number(args['max-tokens'] || 900);

if (!unslothToken) throw new Error('Missing --unsloth-token or UNSLOTH_API_KEY');

const dictionaryTasks = [
  {
    id: 'polyphone-zh-zhong',
    word: '中',
    source_lang: 'zh',
    expectations: {
      zh_readings: ['zhōng', 'zhong1', 'zhòng', 'zhong4'],
      en_terms: ['middle', 'center', 'hit'],
      pt_terms: ['meio', 'acertar'],
      ja_terms: ['中', '当たる']
    }
  },
  {
    id: 'phrase-en-place-order',
    word: 'place an order',
    source_lang: 'en',
    expectations: {
      en_terms: ['place an order', 'order'],
      zh_terms: ['下单', '订购'],
      pt_terms: ['fazer um pedido', 'pedido'],
      ja_terms: ['注文']
    }
  }
];

const ollamaModels = [
  { provider: 'ollama', host: 'a6000-143', model: 'qwen3.6:latest', family: 'qwen' },
  { provider: 'ollama', host: 'a6000-143', model: 'gemma4:26b', family: 'gemma' }
];

const unslothModels = await listUnslothModels();
const filteredUnslothModels = unslothModelFilter
  ? unslothModels.filter((model) => unslothModelFilter.has(model.id) || unslothModelFilter.has(model.display_name))
  : unslothModels;
const selectedUnslothModels = (maxModels ? filteredUnslothModels.slice(0, maxModels) : filteredUnslothModels)
  .map((model) => ({
    provider: 'unsloth',
    host: 'a6000-155',
    model: model.id,
    display_name: model.display_name || model.id,
    family: inferFamily(model.id, model.display_name)
  }))
  .flatMap((model) => {
    if (model.family !== 'qwen-mtp') return [model];
    return [
      { ...model, variant: 'mtp-on', speculative_type: 'mtp', display_name: `${model.display_name} [MTP on]` },
      { ...model, variant: 'mtp-off', speculative_type: 'off', display_name: `${model.display_name} [MTP off]` }
    ];
  });

const candidates = [...ollamaModels, ...selectedUnslothModels];
const rows = [];
const loadRows = [];

for (const candidate of candidates) {
  console.log(`\n== ${candidate.provider} ${candidate.model}`);
  let load = { ok: true, seconds: 0 };
  if (candidate.provider === 'unsloth') {
    load = await loadUnslothModel(candidate);
    loadRows.push({ ...candidate, ...load });
    console.log(`[load] ok=${load.ok} seconds=${load.seconds}${load.error ? ` error=${load.error}` : ''}`);
    if (!load.ok) {
      for (const task of dictionaryTasks) {
        rows.push(failedRow(candidate, task, `load_failed: ${load.error}`, load.seconds));
      }
      continue;
    }
  }

  for (const task of dictionaryTasks) {
    const result =
      candidate.provider === 'ollama' ? await runOllama(candidate, task) : await runUnsloth(candidate, task);
    rows.push(result);
    console.log(
      `[${result.ok ? 'ok' : 'bad'}] task=${task.id} seconds=${result.seconds} score=${result.score}/${result.max_score}` +
        (result.error ? ` error=${result.error}` : '')
    );
  }
  if (candidate.provider === 'unsloth') {
    await unloadUnslothModel(candidate);
  }
}

const summary = summarize(rows, loadRows);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      ok: true,
      created_at: new Date().toISOString(),
      ollama_base_url: ollamaBaseUrl,
      unsloth_base_url: unslothBaseUrl,
      tasks: dictionaryTasks.map(({ id, word, source_lang }) => ({ id, word, source_lang })),
      summary,
      loads: loadRows,
      rows
    },
    null,
    2
  ),
  'utf8'
);

console.table(
  summary.map((row) => ({
    model: row.display_name || row.model,
    provider: row.provider,
    family: row.family,
    load_s: row.load_seconds,
    ok: `${row.ok_count}/${row.task_count}`,
    avg_s: row.avg_seconds,
    avg_score: row.avg_score,
    tokens_s: row.avg_tokens_per_second,
    rank: row.rank
  }))
);
console.log(JSON.stringify({ out: path.relative(process.cwd(), outPath), summary }, null, 2));

async function listUnslothModels() {
  const data = await fetchJson(`${unslothBaseUrl}/api/models/local`, {
    headers: { authorization: `Bearer ${unslothToken}` },
    timeoutMs: 60_000
  });
  return Array.isArray(data.models) ? data.models : [];
}

async function loadUnslothModel(candidate) {
  const started = performance.now();
  try {
    const body = {
      model_path: candidate.model,
      max_seq_length: 8192,
      load_in_4bit: true,
      speculative_type: candidate.speculative_type || (candidate.model.toLowerCase().includes('mtp') ? 'mtp' : 'off')
    };
    const data = await fetchJson(`${unslothBaseUrl}/v1/load`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${unslothToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body),
      timeoutMs: loadTimeoutMs
    });
    return {
      ok: true,
      seconds: secondsSince(started),
      is_gguf: Boolean(data.is_gguf),
      is_diffusion: Boolean(data.is_diffusion),
      speculative_type: data.speculative_type || body.speculative_type || null,
      context_length: data.context_length || null
    };
  } catch (error) {
    await cancelUnsloth();
    return { ok: false, seconds: secondsSince(started), error: errorMessage(error) };
  }
}

async function unloadUnslothModel(candidate) {
  try {
    await fetchJson(`${unslothBaseUrl}/v1/unload`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${unslothToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ model_path: candidate.model }),
      timeoutMs: 30_000
    });
  } catch {
    // Loading the next model is the authoritative state transition.
  }
}

async function runOllama(candidate, task) {
  const started = performance.now();
  try {
    const data = await fetchJson(`${ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: candidate.model,
        stream: false,
        think: false,
        messages: buildMessages(task),
        options: { temperature: 0, num_predict: maxTokens }
      }),
      timeoutMs: perModelTimeoutMs
    });
    const content = data?.message?.content || '';
    return scoredRow(candidate, task, content, secondsSince(started), {
      eval_count: data.eval_count || null,
      tokens_per_second: data.eval_count
        ? Number((data.eval_count / Math.max(secondsSince(started), 0.001)).toFixed(2))
        : null
    });
  } catch (error) {
    return failedRow(candidate, task, errorMessage(error), secondsSince(started));
  }
}

async function runUnsloth(candidate, task) {
  const started = performance.now();
  try {
    const data = await fetchJson(`${unslothBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${unslothToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: candidate.model,
        stream: false,
        temperature: 0,
        max_tokens: maxTokens,
        enable_thinking: false,
        reasoning_effort: 'none',
        messages: buildMessages(task)
      }),
      timeoutMs: perModelTimeoutMs
    });
    const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || '';
    const usage = data?.usage || {};
    return scoredRow(candidate, task, content, secondsSince(started), {
      eval_count: usage.completion_tokens || null,
      tokens_per_second: usage.completion_tokens
        ? Number((usage.completion_tokens / Math.max(secondsSince(started), 0.001)).toFixed(2))
        : null
    });
  } catch (error) {
    await cancelUnsloth();
    return failedRow(candidate, task, errorMessage(error), secondsSince(started));
  }
}

async function cancelUnsloth() {
  try {
    await fetch(`${unslothBaseUrl}/v1/cancel`, {
      method: 'POST',
      headers: { authorization: `Bearer ${unslothToken}` },
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    // best-effort cleanup after timeout
  }
}

function buildMessages(task) {
  return [
    {
      role: 'system',
      content:
        'You are generating data for a four-language dictionary. Return only strict JSON. No markdown, no commentary.'
    },
    {
      role: 'user',
      content:
        `Create a dictionary entry for ${JSON.stringify(task.word)} with source_lang=${task.source_lang}.\n` +
        'Return this exact JSON shape:\n' +
        '{"word":"","source_lang":"","senses":[{"sense_order":1,"part_of_speech":"","translations":{"en":{"term":"","pronunciation":"","definition":"","example":""},"zh":{"term":"","reading":"","definition":"","example":""},"ja":{"term":"","reading":"","definition":"","example":""},"pt-BR":{"term":"","pronunciation":"","definition":"","example":""}}}]}.\n' +
        'Requirements: include all four languages en, zh, ja, pt-BR; include pronunciation for en and pt-BR; include reading for zh and ja; include at least one example sentence per language. If the word has multiple pronunciations with different meanings, split them into separate senses.'
    }
  ];
}

function scoredRow(candidate, task, content, seconds, extra = {}) {
  const parsed = parseJson(content);
  const score = scoreOutput(parsed, task);
  return {
    ...candidate,
    task_id: task.id,
    word: task.word,
    seconds,
    ok: score.score >= 9 && score.errors.length === 0,
    score: score.score,
    max_score: score.max_score,
    errors: score.errors,
    raw_preview: content.slice(0, 1000),
    output: parsed,
    ...extra
  };
}

function failedRow(candidate, task, error, seconds) {
  return {
    ...candidate,
    task_id: task.id,
    word: task.word,
    seconds,
    ok: false,
    score: 0,
    max_score: 12,
    errors: [error],
    error,
    raw_preview: '',
    output: null,
    eval_count: null,
    tokens_per_second: null
  };
}

function scoreOutput(output, task) {
  const errors = [];
  let score = 0;
  const max_score = 12;
  if (!output || typeof output !== 'object') return { score, max_score, errors: ['not_json'] };
  if (String(output.word || '').trim()) score++;
  if (String(output.source_lang || '') === task.source_lang) score++;
  const senses = Array.isArray(output.senses) ? output.senses : [];
  if (senses.length > 0) score++;
  else errors.push('missing_senses');
  const allText = JSON.stringify(output).toLowerCase();
  const langs = ['en', 'zh', 'ja', 'pt-BR'];
  const first = senses[0] || {};
  const translations = first.translations || {};
  for (const lang of langs) {
    if (translations[lang]?.term) score += 0.75;
    else errors.push(`missing_${lang}_term`);
    if (translations[lang]?.definition) score += 0.5;
    else errors.push(`missing_${lang}_definition`);
    if (translations[lang]?.example) score += 0.25;
    else errors.push(`missing_${lang}_example`);
  }
  if (translations.en?.pronunciation) score++;
  else errors.push('missing_en_pronunciation');
  if (translations['pt-BR']?.pronunciation) score++;
  else errors.push('missing_pt_pronunciation');
  if (translations.zh?.reading) score++;
  else errors.push('missing_zh_reading');
  if (translations.ja?.reading) score++;
  else errors.push('missing_ja_reading');

  let matched = 0;
  for (const values of Object.values(task.expectations)) {
    if (values.some((value) => allText.includes(String(value).toLowerCase()))) matched++;
  }
  score += Math.min(2, matched * 0.5);
  if (task.id === 'polyphone-zh-zhong' && senses.length >= 2) score += 1;
  if (task.id === 'polyphone-zh-zhong' && senses.length < 2) errors.push('polyphone_not_split');
  return { score: Number(Math.min(max_score, score).toFixed(2)), max_score, errors };
}

function parseJson(content) {
  const text = String(content || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
      try {
        return JSON.parse(fenced.trim());
      } catch {}
    }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {}
    }
    return null;
  }
}

async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = 60_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method, headers, body, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`non_json_response: ${text.slice(0, 500)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function summarize(rows, loads) {
  const byModel = new Map();
  for (const row of rows) {
    const key = `${row.provider}\t${row.model}\t${row.variant || ''}`;
    if (!byModel.has(key)) byModel.set(key, []);
    byModel.get(key).push(row);
  }
  const loadByModel = new Map(loads.map((row) => [`${row.provider}\t${row.model}\t${row.variant || ''}`, row]));
  const summary = [...byModel.entries()].map(([key, items]) => {
    const first = items[0];
    const load = loadByModel.get(key);
    const avgSeconds = avg(items.map((row) => row.seconds));
    const avgScore = avg(items.map((row) => row.score));
    const okCount = items.filter((row) => row.ok).length;
    return {
      provider: first.provider,
      host: first.host,
      model: first.model,
      variant: first.variant || null,
      display_name: first.display_name || first.model,
      family: first.family,
      load_seconds: load ? load.seconds : 0,
      is_gguf: load?.is_gguf ?? null,
      is_diffusion: load?.is_diffusion ?? first.family === 'diffusion',
      speculative_type: load?.speculative_type ?? null,
      task_count: items.length,
      ok_count: okCount,
      ok_rate: Number((okCount / items.length).toFixed(3)),
      avg_seconds: Number(avgSeconds.toFixed(2)),
      avg_score: Number(avgScore.toFixed(2)),
      avg_tokens_per_second: nullableAvg(items.map((row) => row.tokens_per_second))
    };
  });
  summary.sort(
    (a, b) =>
      b.ok_rate - a.ok_rate ||
      b.avg_score - a.avg_score ||
      a.avg_seconds - b.avg_seconds ||
      a.load_seconds - b.load_seconds
  );
  summary.forEach((row, index) => (row.rank = index + 1));
  return summary;
}

function avg(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : 0;
}

function nullableAvg(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  return nums.length ? Number(avg(nums).toFixed(2)) : null;
}

function inferFamily(id, displayName = '') {
  const text = `${id} ${displayName}`.toLowerCase();
  if (text.includes('diffusion')) return 'diffusion';
  if (text.includes('mtp')) return 'qwen-mtp';
  if (text.includes('qwen')) return 'qwen';
  if (text.includes('gemma')) return 'gemma';
  return 'other';
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
