import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || 'data/processed/linguago_v2_full.db');
const endpoint = String(args.endpoint || 'http://100.99.99.99:11441').replace(/\/$/, '');
const models = String(
  args.models || 'qwen3.6:latest,qwen3.6:27b,gemma4:26b,gemma4:12b,translategemma:27b,translategemma:12b'
)
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean);
const langs = String(args.langs || 'en,zh,ja,pt-BR')
  .split(',')
  .map((lang) => lang.trim())
  .filter(Boolean);
const perLang = Number(args['per-lang'] || 10);
const sourceModel = args['source-model'] || 'qwen3.6:latest';
const timeoutMs = Number(args['timeout-ms'] || 240_000);
const prewarmTimeoutMs = Number(args['prewarm-timeout-ms'] || 240_000);
const maxTokens = Number(args['max-tokens'] || 900);
const outPath = path.resolve(args.out || 'output/dictionary-v2-real-job-model-benchmark.json');

const tasks = loadTasks();
if (!tasks.length) {
  console.error('No accepted llm_completion_jobs found for benchmark sampling.');
  process.exit(2);
}

console.log(`DB: ${path.relative(process.cwd(), dbPath)}`);
console.log(`Endpoint: ${endpoint}`);
console.log(`Models: ${models.join(', ')}`);
console.log(`Tasks: ${tasks.length} (${langs.join(', ')} x ${perLang})`);

const prewarm = [];
const rows = [];
for (const model of models) {
  const warm = await prewarmModel(model);
  prewarm.push(warm);
  console.log(
    `[prewarm] model=${model} ok=${warm.ok} seconds=${warm.seconds} load_seconds=${warm.load_seconds ?? 'n/a'}${
      warm.error ? ` error=${warm.error}` : ''
    }`
  );
  for (const task of tasks) {
    const result = await runOne({ model, task });
    rows.push(result);
    console.log(
      `[${result.ok ? 'ok' : 'bad'}] model=${model} lang=${task.target_lang} job=${task.job_id} entry=${
        task.input.entry?.word
      } seconds=${result.seconds} score=${result.score}/${result.max_score}${
        result.errors.length ? ` errors=${result.errors.join('; ')}` : ''
      }`
    );
  }
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
      source_model: sourceModel,
      per_lang: perLang,
      task_count: tasks.length,
      models,
      prewarm,
      summary,
      by_lang: summarizeByLang(rows),
      rows
    },
    null,
    2
  )
);

console.table(
  summary.map((row) => ({
    model: row.model,
    ok: `${row.ok_count}/${row.task_count}`,
    accepted_rate: row.accepted_rate,
    avg_seconds: row.avg_seconds,
    p95_seconds: row.p95_seconds,
    avg_score: row.avg_score,
    tokens_s: row.avg_tokens_per_second,
    rank: row.rank
  }))
);
console.log(JSON.stringify({ summary, out: path.relative(process.cwd(), outPath) }, null, 2));

function loadTasks() {
  const db = new Database(dbPath, { readonly: true });
  try {
    const selected = [];
    const stmt = db.prepare(`
      SELECT j.id AS job_id, j.target_id, j.lang, j.input_json, j.output_json, e.word, e.frequency_rank
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
      const rows = stmt.all(sourceModel, lang, perLang);
      for (const row of rows) {
        selected.push({
          job_id: row.job_id,
          target_id: row.target_id,
          target_lang: row.lang,
          word: row.word,
          frequency_rank: row.frequency_rank,
          source_output: safeJson(row.output_json),
          input: JSON.parse(row.input_json)
        });
      }
    }
    return selected;
  } finally {
    db.close();
  }
}

async function prewarmModel(model) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), prewarmTimeoutMs);
  try {
    const response = await fetch(`${endpoint}/api/generate`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        keep_alive: '20m',
        prompt: 'Return only OK.',
        options: { temperature: 0, num_predict: 2 }
      })
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    const envelope = JSON.parse(text);
    return {
      ok: true,
      model,
      seconds: secondsSince(started),
      load_seconds: envelope.load_duration ? Number((envelope.load_duration / 1_000_000_000).toFixed(2)) : null
    };
  } catch (error) {
    return {
      ok: false,
      model,
      seconds: secondsSince(started),
      error: `${error.name || 'Error'}: ${error.message || String(error)}`
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runOne({ model, task }) {
  const started = performance.now();
  try {
    const envelope = await callOllama({ model, input: task.input });
    const content = envelope?.message?.content || envelope?.response || '';
    const output = parseJson(content);
    const validation = validateOutput(output, task.input);
    return {
      ok: validation.errors.length === 0,
      model,
      job_id: task.job_id,
      target_id: task.target_id,
      target_lang: task.target_lang,
      word: task.word,
      frequency_rank: task.frequency_rank,
      seconds: secondsSince(started),
      score: validation.score,
      max_score: validation.max_score,
      errors: validation.errors,
      eval_count: envelope?.eval_count ?? null,
      prompt_eval_count: envelope?.prompt_eval_count ?? null,
      tokens_per_second: envelope?.eval_count
        ? Number((envelope.eval_count / Math.max(secondsSince(started), 0.001)).toFixed(2))
        : null,
      output
    };
  } catch (error) {
    return {
      ok: false,
      model,
      job_id: task.job_id,
      target_id: task.target_id,
      target_lang: task.target_lang,
      word: task.word,
      frequency_rank: task.frequency_rank,
      seconds: secondsSince(started),
      score: 0,
      max_score: 8,
      errors: [`${error.name || 'Error'}: ${error.message || String(error)}`],
      eval_count: null,
      prompt_eval_count: null,
      tokens_per_second: null,
      output: null
    };
  }
}

async function callOllama({ model, input }) {
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
        format: outputSchema(input.target_lang),
        messages: [
          {
            role: 'system',
            content: [
              'You complete one missing localization for a multilingual dictionary.',
              'Return JSON only. Complete only the requested target language.',
              'Preserve the given sense meaning and do not create new senses.',
              'For zh, sense_localization.reading must be non-null pinyin and reading_system must be pinyin.',
              'For ja, sense_localization.reading must be non-null kana and reading_system must be kana.',
              'For en, sense_localization.pronunciation must be non-null IPA or readable pronunciation.',
              'For pt-BR, sense_localization.pronunciation must be non-null Brazilian Portuguese IPA or readable pronunciation.',
              'sense_localization.term must be written in the target language; if there is no direct lexical equivalent, use a natural functional equivalent or grammar label in the target language, not the source word.',
              'The definition must be written in the target language, not in English unless the target language is en.',
              'For zh, definition must contain Chinese characters. For ja, definition must contain Japanese kana or kanji.',
              'Never leave a required reading or pronunciation as null when the target language requires it.'
            ].join(' ')
          },
          { role: 'user', content: buildPrompt(input) }
        ],
        options: {
          temperature: 0,
          top_p: 0.8,
          num_ctx: 4096,
          num_predict: maxTokens
        }
      })
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

function buildPrompt(input) {
  const exampleInstruction = input.examples?.length
    ? 'Translate only the provided examples. Use their exact example id values.'
    : 'There are no source examples for this sense. Return an empty example_localizations array.';
  const promptInput = {
    ...input,
    expected_output_schema: outputSchema(input.target_lang)
  };

  return `Complete this missing localization job.

Target language: ${input.target_lang}
${exampleInstruction}

Input:
${JSON.stringify(promptInput, null, 2)}

Return JSON only.`;
}

function outputSchema(lang) {
  const senseRequired = ['lang', 'term', 'definition'];
  const readingSchema = { type: ['string', 'null'] };
  const readingSystemSchema = { type: ['string', 'null'] };
  const pronunciationSchema = { type: ['string', 'null'] };
  const pronunciationSystemSchema = { type: ['string', 'null'] };

  if (lang === 'zh' || lang === 'ja') {
    senseRequired.push('reading', 'reading_system');
    readingSchema.type = 'string';
    readingSchema.minLength = 1;
    readingSystemSchema.type = 'string';
    readingSystemSchema.minLength = 1;
  }
  if (lang === 'en' || lang === 'pt-BR') {
    senseRequired.push('pronunciation', 'pronunciation_system');
    pronunciationSchema.type = 'string';
    pronunciationSchema.minLength = 1;
    pronunciationSystemSchema.type = 'string';
    pronunciationSystemSchema.minLength = 1;
  }

  return {
    type: 'object',
    required: ['sense_localization', 'example_localizations'],
    properties: {
      sense_localization: {
        type: 'object',
        required: senseRequired,
        properties: {
          lang: { const: lang },
          term: { type: 'string', minLength: 1 },
          reading: readingSchema,
          reading_system: readingSystemSchema,
          pronunciation: pronunciationSchema,
          pronunciation_system: pronunciationSystemSchema,
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
            lang: { const: lang },
            text: { type: 'string', minLength: 1 },
            reading: { type: ['string', 'null'] }
          }
        }
      }
    }
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

function summarize(rows) {
  const byModel = new Map();
  for (const row of rows) {
    if (!byModel.has(row.model)) byModel.set(row.model, []);
    byModel.get(row.model).push(row);
  }

  const summary = [...byModel.entries()].map(([model, modelRows]) => {
    const times = modelRows
      .map((row) => row.seconds)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const okCount = modelRows.filter((row) => row.ok).length;
    return {
      model,
      task_count: modelRows.length,
      ok_count: okCount,
      accepted_rate: `${Math.round((okCount / modelRows.length) * 1000) / 10}%`,
      avg_seconds: round(average(times)),
      p95_seconds: times.length ? times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)] : 0,
      avg_score: round(average(modelRows.map((row) => row.score))),
      avg_tokens_per_second: round(average(modelRows.map((row) => row.tokens_per_second).filter(Number.isFinite))),
      failures_by_code: countFailureCodes(modelRows)
    };
  });

  summary
    .sort((a, b) => b.ok_count - a.ok_count || b.avg_score - a.avg_score || a.avg_seconds - b.avg_seconds)
    .forEach((row, index) => {
      row.rank = index + 1;
    });
  return summary.sort((a, b) => a.rank - b.rank);
}

function summarizeByLang(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.model}|${row.target_lang}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, groupRows]) => {
    const [model, lang] = key.split('|');
    const okCount = groupRows.filter((row) => row.ok).length;
    return {
      model,
      lang,
      task_count: groupRows.length,
      ok_count: okCount,
      accepted_rate: `${Math.round((okCount / groupRows.length) * 1000) / 10}%`,
      avg_seconds: round(average(groupRows.map((row) => row.seconds))),
      avg_score: round(average(groupRows.map((row) => row.score))),
      failures_by_code: countFailureCodes(groupRows)
    };
  });
}

function countFailureCodes(rows) {
  const counts = {};
  for (const row of rows) {
    for (const error of row.errors || []) counts[error] = (counts[error] || 0) + 1;
  }
  return counts;
}

function safeJson(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function readingLooksRight(value, lang) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (lang === 'zh') return /[A-Za-züÜāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/u.test(text);
  if (lang === 'ja') return /[\u3040-\u30ff]/u.test(text);
  return true;
}

function termLanguageLooksRight(value, lang) {
  const text = String(value || '');
  if (!text) return false;
  if (lang === 'zh') return containsCjk(text);
  if (lang === 'ja') return containsJapanese(text);
  if (lang === 'pt-BR') return containsLatin(text);
  if (lang === 'en') return containsLatin(text);
  return true;
}

function definitionLanguageLooksRight(value, lang) {
  const text = String(value || '');
  if (lang === 'zh') return containsCjk(text);
  if (lang === 'ja') return containsJapanese(text);
  if (lang === 'pt-BR') return containsLatin(text) && /\b(de|para|que|um|uma|o|a|em|por|se|ao|do|da)\b/i.test(text);
  if (lang === 'en') return containsLatin(text);
  return true;
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

function average(values) {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function round(value) {
  return Number(value.toFixed(2));
}

function secondsSince(started) {
  return Number(((performance.now() - started) / 1000).toFixed(2));
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
