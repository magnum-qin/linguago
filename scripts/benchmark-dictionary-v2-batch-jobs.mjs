import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || 'data/processed/linguago_v2_full.db');
const endpoint = String(args.endpoint || 'http://100.99.99.99:11441').replace(/\/$/, '');
const model = args.model || 'qwen3.6:latest';
const sourceModel = args['source-model'] || 'qwen3.6:latest';
const langs = String(args.langs || 'en,zh,ja,pt-BR')
  .split(',')
  .map((lang) => lang.trim())
  .filter(Boolean);
const perLang = Number(args['per-lang'] || 6);
const batchSize = Number(args['batch-size'] || 3);
const timeoutMs = Number(args['timeout-ms'] || 240_000);
const maxTokens = Number(args['max-tokens'] || 2400);
const outPath = path.resolve(args.out || 'output/dictionary-v2-batch-benchmark.json');

const tasks = loadTasks();
if (!tasks.length) {
  console.error('No accepted llm_completion_jobs found for benchmark sampling.');
  process.exit(2);
}

console.log(`DB: ${path.relative(process.cwd(), dbPath)}`);
console.log(`Endpoint: ${endpoint}`);
console.log(`Model: ${model}`);
console.log(`Tasks: ${tasks.length}; batch_size=${batchSize}`);

const batches = chunk(tasks, batchSize);
const rows = [];
for (const [index, batch] of batches.entries()) {
  const result = await runBatch(batch);
  console.log(
    `[batch] ${index + 1}/${batches.length} size=${batch.length} seconds=${result.seconds} ok=${result.ok_count}/${
      batch.length
    } errors=${result.batch_errors.length ? result.batch_errors.join('; ') : 'none'}`
  );
  rows.push(...result.rows);
}

const summary = summarize(rows);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      ok: true,
      created_at: new Date().toISOString(),
      endpoint,
      db: path.relative(process.cwd(), dbPath),
      model,
      source_model: sourceModel,
      per_lang: perLang,
      batch_size: batchSize,
      task_count: tasks.length,
      request_count: batches.length,
      summary,
      by_lang: summarizeByLang(rows),
      rows
    },
    null,
    2
  )
);

console.table([
  {
    model,
    tasks: tasks.length,
    requests: batches.length,
    ok: `${summary.ok_count}/${summary.task_count}`,
    accepted_rate: summary.accepted_rate,
    avg_task_seconds: summary.avg_task_seconds,
    avg_request_seconds: summary.avg_request_seconds,
    p95_request_seconds: summary.p95_request_seconds,
    avg_score: summary.avg_score
  }
]);
console.log(JSON.stringify({ summary, out: path.relative(process.cwd(), outPath) }, null, 2));

function loadTasks() {
  const db = new Database(dbPath, { readonly: true });
  try {
    const selected = [];
    const stmt = db.prepare(`
      SELECT j.id AS job_id, j.target_id, j.lang, j.input_json, e.word, e.frequency_rank
      FROM llm_completion_jobs j
      JOIN senses s ON s.id = j.target_id
      JOIN entries e ON e.id = s.entry_id
      WHERE j.target_type = 'sense_localization'
        AND j.status = 'accepted'
        AND j.model = ?
        AND j.lang = ?
        AND e.frequency_rank IS NOT NULL
      ORDER BY e.frequency_rank ASC, j.id ASC
      LIMIT ?
    `);
    for (const lang of langs) {
      for (const row of stmt.all(sourceModel, lang, perLang)) {
        selected.push({
          job_id: row.job_id,
          target_id: row.target_id,
          target_lang: row.lang,
          word: row.word,
          frequency_rank: row.frequency_rank,
          input: JSON.parse(row.input_json)
        });
      }
    }
    return selected;
  } finally {
    db.close();
  }
}

async function runBatch(batch) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${endpoint}/api/chat`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        keep_alive: '20m',
        format: batchOutputSchema(),
        messages: [
          {
            role: 'system',
            content: [
              'You complete multiple missing localizations for a multilingual dictionary.',
              'Return JSON only with an items array.',
              'Return exactly one output item per input job_id.',
              'Complete only the requested target language for each item.',
              'Preserve each given sense meaning and do not create new senses.',
              'sense_localization.term must be written in that item target language; never copy the source word when it is written in a different language.',
              'If there is no direct lexical equivalent, use a natural functional equivalent or grammar label in the target language.',
              'For zh, reading must be pinyin. For ja, reading must be kana.',
              'For en and pt-BR, pronunciation must be non-empty.',
              'The definition must be written in the target language.'
            ].join(' ')
          },
          { role: 'user', content: buildBatchPrompt(batch) }
        ],
        options: {
          temperature: 0,
          top_p: 0.8,
          num_ctx: 8192,
          num_predict: maxTokens
        }
      })
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    const envelope = JSON.parse(text);
    const content = envelope?.message?.content || envelope?.response || '';
    const output = parseJson(content);
    return validateBatch(output, batch, secondsSince(started));
  } catch (error) {
    const seconds = secondsSince(started);
    return {
      seconds,
      ok_count: 0,
      batch_errors: [`${error.name || 'Error'}: ${error.message || String(error)}`],
      rows: batch.map((task) => ({
        job_id: task.job_id,
        target_id: task.target_id,
        lang: task.target_lang,
        word: task.word,
        ok: false,
        seconds,
        score: 0,
        max_score: 8,
        errors: [`batch failed: ${error.message || String(error)}`]
      }))
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildBatchPrompt(batch) {
  const inputs = batch.map((task) => ({
    job_id: task.job_id,
    target_lang: task.target_lang,
    input: task.input
  }));
  return `Complete these missing localization jobs.

Input jobs:
${JSON.stringify(inputs, null, 2)}

Return JSON only:
{
  "items": [
    {
      "job_id": 123,
      "sense_localization": { "lang": "...", "term": "...", "reading": null, "reading_system": null, "pronunciation": "...", "pronunciation_system": "...", "definition": "...", "usage_note": null },
      "example_localizations": []
    }
  ]
}`;
}

function batchOutputSchema() {
  return {
    type: 'object',
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          required: ['job_id', 'sense_localization', 'example_localizations'],
          properties: {
            job_id: { type: 'number' },
            sense_localization: {
              type: 'object',
              required: ['lang', 'term', 'definition'],
              properties: {
                lang: { enum: ['en', 'zh', 'ja', 'pt-BR'] },
                term: { type: 'string', minLength: 1 },
                reading: { type: ['string', 'null'] },
                reading_system: { type: ['string', 'null'] },
                pronunciation: { type: ['string', 'null'] },
                pronunciation_system: { type: ['string', 'null'] },
                definition: { type: 'string', minLength: 1 },
                usage_note: { type: ['string', 'null'] }
              }
            },
            example_localizations: {
              type: 'array',
              items: {
                type: 'object',
                required: ['example_id', 'lang', 'text'],
                properties: {
                  example_id: { type: 'number' },
                  lang: { enum: ['en', 'zh', 'ja', 'pt-BR'] },
                  text: { type: 'string', minLength: 1 },
                  reading: { type: ['string', 'null'] }
                }
              }
            }
          }
        }
      }
    }
  };
}

function validateBatch(output, batch, seconds) {
  const batchErrors = [];
  if (!Array.isArray(output?.items)) batchErrors.push('missing items array');
  const items = Array.isArray(output?.items) ? output.items : [];
  const byJob = new Map(items.map((item) => [Number(item.job_id), item]));
  const rows = batch.map((task) => {
    const item = byJob.get(Number(task.job_id));
    const validation = validateOutput(item, task.input);
    if (!item) validation.errors.unshift('missing output item for job_id');
    return {
      job_id: task.job_id,
      target_id: task.target_id,
      lang: task.target_lang,
      word: task.word,
      ok: validation.errors.length === 0,
      seconds,
      task_seconds_estimate: Number((seconds / batch.length).toFixed(2)),
      score: validation.score,
      max_score: validation.max_score,
      errors: validation.errors
    };
  });
  return {
    seconds,
    ok_count: rows.filter((row) => row.ok).length,
    batch_errors: batchErrors,
    rows
  };
}

function validateOutput(output, input) {
  const errors = [];
  let score = 0;
  const maxScore = 8;
  const loc = output?.sense_localization;
  const lang = input.target_lang;

  if (loc && typeof loc === 'object') score++;
  else errors.push('missing sense_localization object');
  if (loc?.lang === lang) score++;
  else errors.push(`lang must be ${lang}`);
  if (nonEmpty(loc?.term)) score++;
  else errors.push('missing term');
  if (nonEmpty(loc?.definition)) score++;
  else errors.push('missing definition');

  if (lang === 'zh' || lang === 'ja') {
    if (readingLooksRight(loc?.reading, lang)) score++;
    else errors.push(lang === 'zh' ? 'reading must look like pinyin' : 'reading must contain kana');
  } else if (lang === 'en' || lang === 'pt-BR') {
    if (nonEmpty(loc?.pronunciation)) score++;
    else errors.push('missing pronunciation');
  }

  if (!termLanguageLooksRight(loc?.term, lang)) errors.push('term language looks suspicious');
  if (definitionLanguageLooksRight(loc?.definition, lang)) score++;
  else errors.push('definition language looks suspicious');
  if (Array.isArray(output?.example_localizations)) score++;
  else errors.push('missing example_localizations array');

  const knownExampleIds = new Set((input.examples || []).map((example) => Number(example.id)));
  for (const example of output?.example_localizations || []) {
    if (example.lang !== lang) errors.push(`example ${example.example_id} lang must be ${lang}`);
    if (!knownExampleIds.has(Number(example.example_id))) errors.push(`unknown example_id: ${example.example_id}`);
    if (!nonEmpty(example.text)) errors.push(`empty example text: ${example.example_id}`);
  }
  if (!errors.some((error) => error.startsWith('example'))) score++;
  return { score, max_score: maxScore, errors };
}

function summarize(rows) {
  const requestSeconds = [...new Set(rows.map((row) => row.seconds))].sort((a, b) => a - b);
  return {
    task_count: rows.length,
    ok_count: rows.filter((row) => row.ok).length,
    accepted_rate: percent(rows.filter((row) => row.ok).length, rows.length),
    avg_task_seconds: average(rows.map((row) => row.task_seconds_estimate ?? row.seconds)),
    avg_request_seconds: average(requestSeconds),
    p95_request_seconds: percentile(requestSeconds, 0.95),
    avg_score: average(rows.map((row) => row.score)),
    failures_by_code: countErrors(rows)
  };
}

function summarizeByLang(rows) {
  return langs.map((lang) => {
    const langRows = rows.filter((row) => row.lang === lang);
    return {
      lang,
      task_count: langRows.length,
      ok_count: langRows.filter((row) => row.ok).length,
      accepted_rate: percent(langRows.filter((row) => row.ok).length, langRows.length),
      avg_task_seconds: average(langRows.map((row) => row.task_seconds_estimate ?? row.seconds)),
      avg_score: average(langRows.map((row) => row.score)),
      failures_by_code: countErrors(langRows)
    };
  });
}

function countErrors(rows) {
  const counts = {};
  for (const row of rows) {
    for (const error of row.errors || []) counts[error] = (counts[error] || 0) + 1;
  }
  return counts;
}

function parseJson(content) {
  const trimmed = String(content || '').trim();
  if (!trimmed) throw new Error('empty model content');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error('content is not JSON');
  }
}

function chunk(items, size) {
  const output = [];
  for (let i = 0; i < items.length; i += size) output.push(items.slice(i, i + size));
  return output;
}

function secondsSince(started) {
  return Number(((performance.now() - started) / 1000).toFixed(2));
}

function average(values) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (!filtered.length) return 0;
  return Number((filtered.reduce((sum, value) => sum + value, 0) / filtered.length).toFixed(2));
}

function percentile(values, p) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

function percent(numerator, denominator) {
  if (!denominator) return '0%';
  return `${Number(((numerator / denominator) * 100).toFixed(1))}%`;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function containsCjk(value) {
  return /[\u3400-\u9fff]/u.test(String(value || ''));
}

function containsJapanese(value) {
  return /[\u3040-\u30ff\u3400-\u9fff]/u.test(String(value || ''));
}

function containsLatin(value) {
  return /[A-Za-zÀ-ÖØ-öø-ÿ]/u.test(String(value || ''));
}

function containsKana(value) {
  return /[\u3040-\u30ff]/u.test(String(value || ''));
}

function readingLooksRight(value, lang) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (lang === 'zh') return /[A-Za-züÜāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/u.test(text);
  if (lang === 'ja') return containsKana(text);
  return true;
}

function termLanguageLooksRight(value, lang) {
  const text = String(value || '');
  if (lang === 'zh') return containsCjk(text);
  if (lang === 'ja') return containsJapanese(text);
  if (lang === 'pt-BR') return containsLatin(text);
  if (lang === 'en') return containsLatin(text);
  return false;
}

function definitionLanguageLooksRight(value, lang) {
  const text = String(value || '');
  if (lang === 'zh') return containsCjk(text);
  if (lang === 'ja') return containsJapanese(text);
  if (lang === 'pt-BR') return containsLatin(text);
  if (lang === 'en') return containsLatin(text);
  return false;
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const next = argv[i + 1];
    result[arg.slice(2)] = next && !next.startsWith('--') ? next : 'true';
    if (next && !next.startsWith('--')) i++;
  }
  return result;
}
