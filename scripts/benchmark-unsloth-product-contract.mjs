#!/usr/bin/env node

import './lib/load-local-env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const args = parseArgs(process.argv.slice(2));
const positional = args._;
const endpoint = args.endpoint || 'http://100.99.99.99:11445';
const token = process.env.UNSLOTH_API_KEY;
const speculativeType = args['speculative-type'] || positional[0] || 'off';
const models = String(
  args.models || positional[1] ||
    'unsloth/Qwen3.6-35B-A3B-MTP-GGUF,unsloth/gemma-4-31B-it-qat-GGUF,' +
      'unsloth/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF,unsloth/Muse-Glimmer-30B-GGUF'
)
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean);
const outPath = path.resolve(
  args.out || positional[2] || `logs/unsloth-155-product-contract-${speculativeType.replaceAll('+', '-')}.json`
);
const ggufVariant = args['gguf-variant'] || 'UD-Q4_K_XL';
const maxSeqLength = Number(args['max-seq-length'] || 4096);
const repeat = Math.max(1, Number(args.repeat || 1));
const nParallel = Math.max(1, Number(args['n-parallel'] || 1));
const cacheTypeKv = args['cache-type-kv'] || 'q8_0';
const promptSource = fs.readFileSync(path.resolve('worker/prompts.ts'), 'utf8');
const systemPrompt = promptSource.match(/export const ACTIVE_SYSTEM_PROMPT = `([\s\S]*?)`;/)?.[1];
const previewSystemPrompt = promptSource.match(/export const PREVIEW_SYSTEM_PROMPT = `([\s\S]*?)`;/)?.[1];

if (!token) throw new Error('Missing UNSLOTH_API_KEY');
if (!systemPrompt || !previewSystemPrompt) throw new Error('Could not read product system prompts');

const cases = [
  {
    id: 'preview',
    systemPrompt: previewSystemPrompt,
    maxTokens: 512,
    prompt:
      'Source language: zh\nTarget language: en\nWhen returning language-keyed JSON, put en first, then pt-BR, zh, ja.\n' +
      'Text: 网络恢复后，客户端会继续读取流式译文，但用户点击中止时必须立即停止。',
    validate: validatePreview
  },
  {
    id: 'sentence',
    systemPrompt,
    maxTokens: 1536,
    prompt:
      'Source language: zh\nTarget language: en\nWhen returning language-keyed JSON, put en first, then pt-BR, zh, ja.\n' +
      'Text: 网络恢复后，客户端会继续读取流式译文，但用户点击中止时必须立即停止。',
    validate: validateSentence
  },
  {
    id: 'word',
    systemPrompt,
    maxTokens: 1536,
    prompt:
      'Source language: en\nTarget language: zh\nWhen returning language-keyed JSON, put zh first, then en, pt-BR, ja.\n' +
      'Text: schedule',
    validate: validateWord
  }
];

// Keep the benchmark source stable even if a terminal rewrites non-ASCII source text.
const benchmarkSentence =
  '\u7f51\u7edc\u6062\u590d\u540e\uff0c\u5ba2\u6237\u7aef\u4f1a\u7ee7\u7eed\u8bfb\u53d6\u6d41\u5f0f\u8bd1\u6587\uff0c' +
  '\u4f46\u7528\u6237\u70b9\u51fb\u4e2d\u6b62\u65f6\u5fc5\u987b\u7acb\u5373\u505c\u6b62\u3002';
for (const item of cases.filter((candidate) => candidate.id !== 'word')) {
  item.prompt =
    'Source language: zh\nTarget language: en\n' +
    'When returning language-keyed JSON, put en first, then pt-BR, zh, ja.\n' +
    `Text: ${benchmarkSentence}`;
}

const report = {
  created_at: new Date().toISOString(),
  endpoint,
  gguf_variant: ggufVariant,
  max_seq_length: maxSeqLength,
  repeat,
  n_parallel: nParallel,
  cache_type_kv: cacheTypeKv,
  speculative_type: speculativeType,
  models: []
};

for (const model of models) {
  console.log(`\n== ${model}`);
  const loadStarted = performance.now();
  const load = await request('/v1/load', {
    model_path: model,
    max_seq_length: maxSeqLength,
    load_in_4bit: true,
    gguf_variant: ggufVariant,
    speculative_type: speculativeType,
    n_parallel: nParallel,
    cache_type_kv: cacheTypeKv,
    force_cancel_active: true,
    ...(speculativeType.includes('mtp') ? { spec_draft_n_max: 2 } : {})
  }, 900_000);
  const loadSeconds = seconds(loadStarted);
  const rows = [];
  console.log(`[load] ${loadSeconds}s`);

  for (let iteration = 1; iteration <= repeat; iteration += 1) {
    for (const item of cases) {
      const started = performance.now();
      const response = await request('/v1/chat/completions', {
      model,
      stream: false,
      temperature: 0,
      max_tokens: item.maxTokens,
      enable_thinking: false,
      reasoning_effort: 'none',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: item.systemPrompt },
        { role: 'user', content: item.prompt }
      ]
      }, 180_000);
      const raw = String(response.choices?.[0]?.message?.content || '');
      const reasoning = String(
        response.choices?.[0]?.message?.reasoning_content || response.choices?.[0]?.message?.reasoning || ''
      );
      let payload = null;
      try {
        payload = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
      } catch {}
      const checks = item.validate(payload);
      const row = {
        id: item.id,
        iteration,
        total_ms: Math.round(performance.now() - started),
        completion_tokens: response.usage?.completion_tokens || null,
        json_ok: Boolean(payload),
        passed: checks.filter((check) => check.ok).length,
        total: checks.length,
        checks,
        payload,
        raw,
        reasoning
      };
      rows.push(row);
      console.log(
        `[${item.id}#${iteration}] ${row.passed}/${row.total} json=${row.json_ok} total=${row.total_ms}ms`
      );
    }
  }

  report.models.push({
    model,
    load_seconds: loadSeconds,
    passed: rows.reduce((sum, row) => sum + row.passed, 0),
    total: rows.reduce((sum, row) => sum + row.total, 0),
    rows,
    load_response: load
  });
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.table(report.models.map(({ model, passed, total, rows }) => ({
  model,
  contract: `${passed}/${total}`,
  preview_median_ms: median(rows.filter((row) => row.id === 'preview').map((row) => row.total_ms)),
  full_sentence_median_ms: median(rows.filter((row) => row.id === 'sentence').map((row) => row.total_ms)),
  word_median_ms: median(rows.filter((row) => row.id === 'word').map((row) => row.total_ms)),
  json: `${rows.filter((row) => row.json_ok).length}/${rows.length}`
})));
console.log(`Wrote: ${outPath}`);

function validateSentence(value) {
  const item = object(value);
  return [
    check('type', item.type === 'sentence'),
    check('source-language', typeof item.detected_source_lang === 'string'),
    check('target-translation', typeof item.translation === 'string' && item.translation.length > 0),
    ...languageObjectChecks(item.translations, 'text', 'translations'),
    ...languageStringChecks(item.explanations, 'explanations'),
    check('abort-meaning', /abort|stop/i.test(String(item.translations?.en?.text || item.translation || ''))),
    check('stream-meaning', /stream/i.test(String(item.translations?.en?.text || item.translation || ''))),
    check('japanese-readings', /\{[^{}|]+\|[^{}]+\}/.test(String(item.translations?.ja?.text || '')))
  ];
}

function validatePreview(value) {
  const item = object(value);
  return [
    check('type', item.type === 'sentence'),
    check('source-language', typeof item.detected_source_lang === 'string'),
    check('translation', typeof item.translation === 'string' && /abort|stop/i.test(item.translation)),
    check('explanation', typeof item.explanation === 'string' && item.explanation.length > 0)
  ];
}

function validateWord(value) {
  const item = object(value);
  const examples = Array.isArray(item.examples) ? item.examples : [];
  const senses = Array.isArray(item.senses) ? item.senses : [];
  return [
    check('type', item.type === 'word'),
    check('source-language', typeof item.detected_source_lang === 'string'),
    check('target-translation', typeof item.translation === 'string' && item.translation.length > 0),
    ...languageObjectChecks(item.translations, 'text', 'translations-text'),
    ...languageObjectChecks(item.translations, 'phonetic', 'translations-phonetic'),
    ...languageObjectChecks(item.translations, 'audio_text', 'translations-audio'),
    ...languageObjectChecks(item.word_details, 'definition', 'definitions'),
    check('examples', examples.length > 0 && ['zh', 'en', 'pt-BR', 'ja'].every((lang) => examples[0]?.translations?.[lang])),
    check('senses', senses.length > 0 && ['zh', 'en', 'pt-BR', 'ja'].every((lang) => senses[0]?.definitions?.[lang])),
    check('japanese-readings', /\{[^{}|]+\|[^{}]+\}/.test(String(item.word_details?.ja?.definition || '')))
  ];
}

function languageObjectChecks(value, field, prefix) {
  const item = object(value);
  return ['zh', 'en', 'pt-BR', 'ja'].map((lang) =>
    check(`${prefix}-${lang}`, typeof item[lang]?.[field] === 'string' && item[lang][field].length > 0)
  );
}

function languageStringChecks(value, prefix) {
  const item = object(value);
  return ['zh', 'en', 'pt-BR', 'ja'].map((lang) =>
    check(`${prefix}-${lang}`, typeof item[lang] === 'string' && item[lang].length > 0)
  );
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function check(name, ok) {
  return { name, ok: Boolean(ok) };
}

async function request(pathName, body, timeoutMs) {
  const response = await fetch(`${endpoint}${pathName}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathName} HTTP ${response.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

function seconds(started) {
  return Number(((performance.now() - started) / 1000).toFixed(2));
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      parsed._.push(value);
      continue;
    }
    const key = value.slice(2);
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
