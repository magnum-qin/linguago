const base = process.env.API_BASE_URL || 'https://translation-pwa.qhzggzh-linguago.workers.dev';
const models = (process.env.BENCHMARK_MODELS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const provider = process.env.BENCHMARK_PROVIDER || 'auto';
const targetLang = process.env.BENCHMARK_TARGET || 'en';
const text = process.env.BENCHMARK_TEXT || '这个景点很漂亮';

if (!models.length) {
  console.error('Set BENCHMARK_MODELS to a comma-separated model list.');
  process.exit(2);
}

async function runOne(model) {
  const started = performance.now();
  let firstDeltaMs = null;
  let finalMs = null;
  let finalData = null;
  let parseOk = false;
  let outputLength = 0;

  const response = await fetch(new URL('/api/translate-stream', base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      source_lang: 'auto',
      target_lang: targetLang,
      provider,
      model
    })
  });

  if (!response.ok || !response.body) {
    return {
      provider,
      model,
      target_lang: targetLang,
      ok: false,
      status: response.status,
      error: await response.text()
    };
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
      if (
        firstDeltaMs == null &&
        ['delta', 'partial', 'partial_translation', 'partial_explanation'].includes(message.event)
      ) {
        firstDeltaMs = Math.round(performance.now() - started);
      }
      if (message.event === 'final') {
        finalMs = Math.round(performance.now() - started);
        finalData = message.data;
        outputLength = JSON.stringify(message.data || {}).length;
        parseOk = Boolean(message.data?.translation);
      }
    }

    if (done) break;
  }

  return {
    provider,
    model,
    target_lang: targetLang,
    ok: parseOk,
    first_delta_ms: firstDeltaMs,
    final_ms: finalMs,
    output_length: outputLength,
    parse_ok: parseOk,
    quality_notes: summarizeQuality(finalData)
  };
}

function summarizeQuality(data) {
  if (!data) return 'no final payload';
  const notes = [];
  if (!data.translation) notes.push('missing translation');
  if (data.type === 'sentence' && !data.explanation && !data.explanations?.[targetLang]) {
    notes.push('missing explanation');
  }
  if (data.type === 'word' && !data.word_details?.[targetLang]?.definition) {
    notes.push('missing target definition');
  }
  return notes.length ? notes.join('; ') : 'basic fields present';
}

const results = [];
for (const model of models) {
  results.push(await runOne(model));
}

console.table(results);
console.log(JSON.stringify(results, null, 2));
