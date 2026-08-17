#!/usr/bin/env node

import './lib/load-local-env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const args = parseArgs(process.argv.slice(2));
const scenarioName = args.scenario || 'qwen-a6000';
const repeat = Number(args.repeat || 2);
const maxTokens = Number(args['max-tokens'] || 900);
const token = process.env.UNSLOTH_API_KEY;
const outPath = path.resolve(
  args.out || `logs/unsloth-cluster-${scenarioName}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
);

if (!token) throw new Error('Missing UNSLOTH_API_KEY');

const QWEN = {
  model: 'unsloth/Qwen3.6-35B-A3B-MTP-GGUF',
  speculative_type: 'mtp'
};
const GEMMA = {
  model: 'unsloth/gemma-4-31B-it-qat-GGUF',
  speculative_type: 'off'
};
const nodes = [
  { name: 'a6000-144', endpoint: 'http://100.99.99.99:11442', gpu: 'A6000' },
  { name: 'a6000-147', endpoint: 'http://100.99.99.99:11444', gpu: 'A6000' },
  { name: 'rtx4090-224', endpoint: 'http://100.99.99.99:11446', gpu: 'RTX4090' },
  { name: 'rtx4090-47', endpoint: 'http://100.99.99.99:11448', gpu: 'RTX4090' },
  { name: 'rtx4090-56', endpoint: 'http://100.99.99.99:11447', gpu: 'RTX4090' }
].map((node) => {
  const qwen = scenarioName === 'qwen-a6000' ? node.gpu === 'A6000' : node.gpu === 'RTX4090';
  return {
    ...node,
    ...(qwen ? QWEN : GEMMA),
    gguf_variant: qwen && node.gpu === 'RTX4090' ? 'UD-IQ4_NL' : 'UD-Q4_K_XL'
  };
});

if (!['qwen-a6000', 'qwen-4090'].includes(scenarioName)) {
  throw new Error(`Unknown --scenario ${scenarioName}`);
}

const headwords = [
  ['zh', '权衡'], ['zh', '落实'], ['zh', '中'], ['zh', '吃'], ['zh', '韧性'],
  ['ja', '見込む'], ['ja', '取り組む'], ['ja', '上手'], ['ja', '何時'], ['ja', '国際'],
  ['pt-BR', 'saudade'], ['pt-BR', 'desenrolar'], ['pt-BR', 'esclarecer'], ['pt-BR', 'prazo'], ['pt-BR', 'aproveitar'],
  ['en', 'schedule'], ['en', 'accountability'], ['en', 'resilient'], ['en', 'overlook'], ['en', 'trade-off']
];
const tasks = Array.from({ length: repeat }, (_, iteration) =>
  headwords.map(([language, term], index) => ({ id: `${iteration + 1}-${index + 1}`, language, term }))
).flat();

const report = {
  created_at: new Date().toISOString(),
  scenario: scenarioName,
  repeat,
  task_count: tasks.length,
  max_tokens: maxTokens,
  nodes: [],
  rows: []
};

console.log(`Loading ${nodes.length} nodes for ${scenarioName}...`);
report.nodes = await Promise.all(nodes.map(loadNode));
const unavailable = report.nodes.filter((node) => !node.load_ok);
if (unavailable.length) {
  writeReport();
  throw new Error(`Load failed: ${unavailable.map((node) => `${node.name}: ${node.error}`).join('; ')}`);
}

await Promise.all(nodes.map((node) => runOne(node, { id: 'warmup', language: 'en', term: 'test' })));

let cursor = 0;
const started = performance.now();
await Promise.all(nodes.map(async (node) => {
  while (true) {
    const index = cursor++;
    if (index >= tasks.length) return;
    const row = await runOne(node, tasks[index]);
    report.rows.push(row);
    console.log(`[${node.name}] ${row.id} ${row.term} ok=${row.ok} ${row.total_ms}ms`);
  }
}));
const wallMs = Math.round(performance.now() - started);

report.summary = summarize(report.rows, wallMs);
writeReport();
console.table(report.summary.nodes);
console.log(JSON.stringify(report.summary.cluster, null, 2));
console.log(`Wrote: ${outPath}`);

async function loadNode(node) {
  const started = performance.now();
  try {
    await post(node, '/v1/load', {
      model_path: node.model,
      gguf_variant: node.gguf_variant,
      max_seq_length: 2048,
      load_in_4bit: true,
      cache_type_kv: 'q8_0',
      speculative_type: node.speculative_type,
      ...(node.speculative_type === 'mtp' ? { spec_draft_n_max: 2 } : {}),
      n_parallel: 1,
      gpu_memory_mode: 'auto',
      force_cancel_active: true
    }, 900_000);
    const status = await get(node, '/v1/status', 30_000);
    const expectedModel = status.active_model === node.model;
    const expectedVariant = status.gguf_variant === node.gguf_variant;
    const fullGpu = status.gpu_layers === -1 && !status.cpu_fallback_reason && Number(status.n_cpu_moe || 0) === 0;
    return {
      ...node,
      load_ok: expectedModel && expectedVariant && fullGpu,
      load_seconds: secondsSince(started),
      full_gpu: fullGpu,
      status,
      error: expectedModel && expectedVariant && fullGpu ? '' : 'Loaded model, variant, or GPU placement does not match'
    };
  } catch (error) {
    return { ...node, load_ok: false, load_seconds: secondsSince(started), error: errorMessage(error) };
  }
}

async function runOne(node, task) {
  const started = performance.now();
  try {
    const response = await post(node, '/v1/chat/completions', {
      model: node.model,
      stream: false,
      temperature: 0,
      max_tokens: maxTokens,
      enable_thinking: false,
      reasoning_effort: 'none',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Create one concise four-language dictionary entry. Return JSON only. ' +
            'Schema: {"source_language":"zh|ja|pt-BR|en","source_term":"string","localizations":{' +
            '"zh":{"term":"string","reading":"pinyin","definition":"string","example":"string"},' +
            '"ja":{"term":"string","reading":"kana","definition":"string","example":"string"},' +
            '"pt-BR":{"term":"string","pronunciation":"IPA","definition":"string","example":"string"},' +
            '"en":{"term":"string","pronunciation":"IPA","definition":"string","example":"string"}}}. ' +
            'Use Simplified Chinese and natural Brazilian Portuguese. Keep source_term exactly unchanged.'
        },
        { role: 'user', content: `Source language: ${task.language}\nSource term: ${task.term}` }
      ]
    }, 180_000);
    const raw = String(response.choices?.[0]?.message?.content || '');
    const payload = parseJson(raw);
    const checks = validate(payload, task);
    const usage = response.usage || {};
    return {
      ...task,
      node: node.name,
      model: node.model,
      variant: node.gguf_variant,
      ok: checks.every(Boolean),
      checks,
      total_ms: Math.round(performance.now() - started),
      completion_tokens: Number(usage.completion_tokens || 0) || null,
      payload,
      error: ''
    };
  } catch (error) {
    return {
      ...task,
      node: node.name,
      model: node.model,
      variant: node.gguf_variant,
      ok: false,
      checks: [],
      total_ms: Math.round(performance.now() - started),
      completion_tokens: null,
      payload: null,
      error: errorMessage(error)
    };
  }
}

function validate(payload, task) {
  if (!payload || typeof payload !== 'object') return [false];
  const localizations = payload.localizations || {};
  return [
    payload.source_term === task.term,
    payload.source_language === task.language,
    ...['zh', 'ja', 'pt-BR', 'en'].flatMap((language) => {
      const item = localizations[language] || {};
      const pronunciationField = language === 'zh' || language === 'ja' ? 'reading' : 'pronunciation';
      return ['term', pronunciationField, 'definition', 'example'].map(
        (field) => typeof item[field] === 'string' && item[field].trim().length > 0
      );
    })
  ];
}

function summarize(rows, wallMs) {
  const perNode = new Map();
  for (const row of rows) {
    const list = perNode.get(row.node) || [];
    list.push(row);
    perNode.set(row.node, list);
  }
  const nodeRows = nodes.map((node) => summarizeRows(node, perNode.get(node.name) || []));
  const accepted = rows.filter((row) => row.ok).length;
  return {
    cluster: {
      wall_seconds: Number((wallMs / 1000).toFixed(2)),
      completed: rows.length,
      accepted,
      accepted_rate: ratio(accepted, rows.length),
      completed_per_minute: Number((rows.length / (wallMs / 60000)).toFixed(2)),
      accepted_per_minute: Number((accepted / (wallMs / 60000)).toFixed(2)),
      total_completion_tokens: rows.reduce((sum, row) => sum + Number(row.completion_tokens || 0), 0)
    },
    nodes: nodeRows
  };
}

function summarizeRows(node, rows) {
  const accepted = rows.filter((row) => row.ok).length;
  const elapsedMs = rows.reduce((sum, row) => sum + row.total_ms, 0);
  return {
    node: node.name,
    model: node.model.includes('Qwen') ? 'Qwen35B' : 'Gemma31B',
    variant: node.gguf_variant,
    completed: rows.length,
    accepted,
    accepted_rate: ratio(accepted, rows.length),
    avg_ms: rows.length ? Math.round(elapsedMs / rows.length) : null,
    accepted_per_minute: elapsedMs ? Number((accepted / (elapsedMs / 60000)).toFixed(2)) : 0,
    errors: rows.filter((row) => row.error).length
  };
}

async function get(node, route, timeoutMs) {
  const response = await fetch(`${node.endpoint}${route}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${route} HTTP ${response.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

async function post(node, route, body, timeoutMs) {
  const response = await fetch(`${node.endpoint}${route}`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${route} HTTP ${response.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

function authHeaders(extra = {}) {
  return { authorization: `Bearer ${token}`, ...extra };
}

function parseJson(raw) {
  try {
    return JSON.parse(String(raw).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    const next = argv[index + 1];
    result[name] = next && !next.startsWith('--') ? argv[++index] : true;
  }
  return result;
}

function ratio(value, total) {
  return total ? Number((value / total).toFixed(4)) : 0;
}

function secondsSince(started) {
  return Number(((performance.now() - started) / 1000).toFixed(2));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function writeReport() {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
