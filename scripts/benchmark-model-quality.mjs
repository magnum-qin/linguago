#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const base = args.base || process.env.API_BASE_URL || 'https://translation-pwa.qhzggzh-linguago.workers.dev';
const provider = args.provider || process.env.BENCHMARK_PROVIDER || 'auto';
const modelSpecs = (args.models || process.env.BENCHMARK_MODELS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const repeat = Number(args.repeat || process.env.BENCHMARK_REPEAT || 1);
const out = args.out || `logs/model-quality-benchmark-${dateStamp()}.json`;
const requestTimeoutMs = Number(args.timeoutMs || process.env.BENCHMARK_TIMEOUT_MS || 45_000);
const cacheBust = Boolean(args.cacheBust || process.env.BENCHMARK_CACHE_BUST);
const sampleFilter = (args.samples || process.env.BENCHMARK_SAMPLES || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const allSamples = [
  {
    id: 'zh_sentence',
    text: '\u8fd9\u4e2a\u666f\u70b9\u5f88\u6f02\u4eae\uff0c\u4f46\u662f\u5468\u672b\u4eba\u592a\u591a\u4e86\u3002',
    source_lang: 'zh',
    target_lang: 'en',
    expected: ['scenic', 'spot', 'beautiful', 'weekend', 'crowded', 'people']
  },
  {
    id: 'ja_sentence',
    text: '\u660e\u65e5\u306e\u4f1a\u8b70\u306f\u5348\u5f8c\u4e09\u6642\u306b\u5909\u66f4\u3055\u308c\u307e\u3057\u305f\u3002',
    source_lang: 'ja',
    target_lang: 'zh',
    expected: ['\u660e\u5929', '\u4f1a\u8bae', '\u4e0b\u5348', '\u4e09', '\u66f4\u6539', '\u6539']
  },
  {
    id: 'pt_sentence',
    text: 'Preciso confirmar a reserva antes de viajar.',
    source_lang: 'pt-BR',
    target_lang: 'ja',
    expected: ['\u4e88\u7d04', '\u78ba\u8a8d', '\u65c5\u884c', '\u524d']
  },
  {
    id: 'en_word',
    text: 'resilient',
    source_lang: 'en',
    target_lang: 'zh',
    expected: ['\u9002\u5e94', '\u6062\u590d', '\u575a\u97e7', '\u5f39\u6027']
  }
];
const samples = sampleFilter.length ? allSamples.filter((sample) => sampleFilter.includes(sample.id)) : allSamples;

if (!modelSpecs.length) {
  console.error('Set --models or BENCHMARK_MODELS. Format: provider:model or just model with --provider.');
  process.exit(2);
}

if (!samples.length) {
  console.error(`No samples matched: ${sampleFilter.join(',')}`);
  process.exit(2);
}

const rows = [];
for (const spec of modelSpecs) {
  const target = parseModelSpec(spec, provider);
  for (let i = 0; i < repeat; i += 1) {
    for (const sample of samples) {
      rows.push(await runOne(target, sample, i + 1));
    }
  }
}

const summary = summarize(rows);
const report = {
  created_at: new Date().toISOString(),
  base,
  repeat,
  request_timeout_ms: requestTimeoutMs,
  cache_bust: cacheBust,
  samples: samples.map(({ id, source_lang, target_lang, text }) => ({ id, source_lang, target_lang, text })),
  summary,
  rows
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.table(
  summary.map((row) => ({
    provider: row.provider,
    model: row.model,
    ok: `${row.ok_count}/${row.total}`,
    avg_final_ms: row.avg_final_ms,
    avg_first_delta_ms: row.avg_first_delta_ms,
    avg_quality: row.avg_quality_score,
    failures: row.failures
  }))
);
console.log(`Wrote: ${out}`);

async function runOne(target, sample, iteration) {
  const started = performance.now();
  let firstDeltaMs = null;
  let finalMs = null;
  let finalData = null;
  const events = [];

  try {
    const response = await fetch(new URL('/api/translate-stream', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(requestTimeoutMs),
      body: JSON.stringify({
        text: cacheBust
          ? `${sample.text}\n\n[benchmark ${Date.now()} ${target.provider} ${target.model} ${sample.id} ${iteration}]`
          : sample.text,
        source_lang: sample.source_lang,
        target_lang: sample.target_lang,
        provider: target.provider,
        model: target.model
      })
    });

    if (!response.ok || !response.body) {
      return errorRow(target, sample, iteration, response.status, await response.text(), started);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        events.push(message.event);
        if (
          firstDeltaMs == null &&
          ['delta', 'partial', 'partial_translation', 'partial_explanation'].includes(message.event)
        ) {
          firstDeltaMs = Math.round(performance.now() - started);
        }
        if (message.event === 'final') {
          finalMs = Math.round(performance.now() - started);
          finalData = message.data;
        }
        if (message.event === 'error') {
          return errorRow(target, sample, iteration, 200, JSON.stringify(message.data), started, events);
        }
      }

      if (done) break;
    }
  } catch (error) {
    return errorRow(
      target,
      sample,
      iteration,
      0,
      error instanceof Error ? error.message : String(error),
      started,
      events
    );
  }

  const quality = scoreQuality(finalData, sample);
  return {
    provider: target.provider,
    model: target.model,
    sample_id: sample.id,
    iteration,
    ok: quality.ok,
    status: 200,
    first_delta_ms: firstDeltaMs,
    final_ms: finalMs,
    type: finalData?.type || null,
    resolved_provider: finalData?.provider || null,
    resolved_model: finalData?.model || null,
    cached: Boolean(finalData?.cached || finalData?.cache_hit),
    quality_score: quality.score,
    quality_notes: quality.notes,
    translation: finalData?.translation || '',
    events
  };
}

function scoreQuality(data, sample) {
  const notes = [];
  let score = 0;
  if (!data) return { ok: false, score: 0, notes: ['no final payload'] };
  if (data.translation) score += 25;
  else notes.push('missing translation');

  const targetText = data.translations?.[sample.target_lang]?.text || data.translation || '';
  if (targetText) score += 15;
  else notes.push('missing target text');

  if (data.type === 'sentence') {
    if (data.explanation || data.explanations?.[sample.target_lang]) score += 15;
    else notes.push('missing explanation');
  } else if (data.type === 'word') {
    if (data.word_details?.[sample.target_lang]?.definition) score += 15;
    else notes.push('missing target definition');
    if (Array.isArray(data.senses) && data.senses.length) score += 10;
    else notes.push('missing senses');
  } else {
    notes.push('unknown type');
  }

  const normalized = `${data.translation || ''} ${targetText}`.toLowerCase();
  const hits = sample.expected.filter((term) => normalized.includes(term.toLowerCase())).length;
  score += Math.min(25, hits * 8);
  if (!hits) notes.push('no expected term overlap');

  const jsonLength = JSON.stringify(data).length;
  if (jsonLength > 120) score += 10;
  else notes.push('short payload');

  return { ok: score >= 65 && Boolean(data.translation), score, notes };
}

function summarize(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.provider}\t${row.model}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  return [...groups.entries()]
    .map(([key, items]) => {
      const [rowProvider, rowModel] = key.split('\t');
      const okItems = items.filter((item) => item.ok);
      const finalTimes = items.map((item) => item.final_ms).filter(Number.isFinite);
      const firstTimes = items.map((item) => item.first_delta_ms).filter(Number.isFinite);
      return {
        provider: rowProvider,
        model: rowModel,
        total: items.length,
        ok_count: okItems.length,
        avg_final_ms: average(finalTimes),
        p95_final_ms: percentile(finalTimes, 0.95),
        avg_first_delta_ms: average(firstTimes),
        avg_quality_score: average(items.map((item) => item.quality_score).filter(Number.isFinite)),
        failures: items
          .filter((item) => !item.ok)
          .map((item) => `${item.sample_id}: ${item.quality_notes.join('; ')}`)
          .slice(0, 5)
      };
    })
    .sort((a, b) => b.avg_quality_score - a.avg_quality_score || a.avg_final_ms - b.avg_final_ms);
}

function errorRow(target, sample, iteration, status, error, started, events = []) {
  return {
    provider: target.provider,
    model: target.model,
    sample_id: sample.id,
    iteration,
    ok: false,
    status,
    first_delta_ms: null,
    final_ms: Math.round(performance.now() - started),
    quality_score: 0,
    quality_notes: [String(error).slice(0, 500)],
    translation: '',
    events
  };
}

function parseModelSpec(spec, defaultProvider) {
  const index = spec.indexOf(':');
  if (index > 0 && ['auto', 'cloudflare', 'dashscope', 'gemini', 'deepseek'].includes(spec.slice(0, index))) {
    return { provider: spec.slice(0, index), model: spec.slice(index + 1) };
  }
  return { provider: defaultProvider, model: spec };
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) result[key] = true;
    else {
      result[key] = next;
      i += 1;
    }
  }
  return result;
}

function average(values) {
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10).replaceAll('-', '');
}
