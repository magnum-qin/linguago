import Database from 'better-sqlite3';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const DEFAULT_DB = 'data/processed/linguago_v2_sample.db';
const DEFAULT_ENDPOINT = 'http://100.99.99.99:11436';
const DEFAULT_PROVIDER = 'ollama';
const DEFAULT_MODEL = 'qwen3.6:latest';
const DEFAULT_PROMPT_VERSION = 'dictionary-v2-localization-v1';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const endpoint = String(args.endpoint || process.env.OLLAMA_HOST || DEFAULT_ENDPOINT).replace(/\/$/, '');
const provider = args.provider || DEFAULT_PROVIDER;
const model = args.model || process.env.OLLAMA_MODEL || DEFAULT_MODEL;
const promptVersion = args['prompt-version'] || DEFAULT_PROMPT_VERSION;
const limit = Number(args.limit || 10);
const timeoutMs = Number(args['timeout-ms'] || args.timeout || 180_000);
const prewarmTimeoutMs = Number(args['prewarm-timeout-ms'] || 180_000);
const maxTokens = Number(args['max-tokens'] || 900);
const dryRun = args['dry-run'] === 'true';
const prewarm = args.prewarm !== 'false';
const retryNeedsReview = args['retry-needs-review'] === 'true';
const targetLangs = String(args['target-langs'] || '')
  .split(',')
  .map((lang) => lang.trim())
  .filter(Boolean);
const targetLangClause = targetLangs.length ? `AND lang IN (${targetLangs.map(() => '?').join(', ')})` : '';

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 10000');

const statements = {
  queuedJobs: db.prepare(`
    SELECT id, target_id, lang, input_json
    FROM llm_completion_jobs
    WHERE target_type = 'sense_localization'
      AND provider = ?
      AND model = ?
      AND prompt_version = ?
      AND status IN (${retryNeedsReview ? "'queued', 'needs_review'" : "'queued'"})
      ${targetLangClause}
    ORDER BY id
    LIMIT ?
  `),
  markRunning: db.prepare(`
    UPDATE llm_completion_jobs
    SET status = 'running', error = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status IN ('queued', 'needs_review')
  `),
  markDone: db.prepare(`
    UPDATE llm_completion_jobs
    SET status = ?, output_json = ?, error = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),
  localizationExists: db.prepare(`
    SELECT id FROM sense_localizations WHERE sense_id = ? AND lang = ?
  `),
  insertLocalization: db.prepare(`
    INSERT INTO sense_localizations
      (sense_id, lang, term, normalized_term, reading, reading_system, pronunciation, pronunciation_system,
       definition, usage_note, source, confidence, needs_review)
    VALUES
      (@sense_id, @lang, @term, @normalized_term, @reading, @reading_system, @pronunciation, @pronunciation_system,
       @definition, @usage_note, @source, @confidence, @needs_review)
  `),
  exampleExists: db.prepare(`
    SELECT id FROM examples WHERE id = ? AND sense_id = ?
  `),
  exampleLocalizationExists: db.prepare(`
    SELECT id FROM example_localizations WHERE example_id = ? AND lang = ?
  `),
  insertExampleLocalization: db.prepare(`
    INSERT INTO example_localizations
      (example_id, lang, text, reading, source, confidence, needs_review)
    VALUES
      (@example_id, @lang, @text, @reading, @source, @confidence, @needs_review)
  `),
  resolveMissingIssue: db.prepare(`
    UPDATE quality_issues
    SET resolved_at = CURRENT_TIMESTAMP
    WHERE entity_type = 'sense'
      AND entity_id = ?
      AND issue_code = ?
      AND resolved_at IS NULL
  `)
};

const jobs = statements.queuedJobs.all(provider, model, promptVersion, ...targetLangs, limit);

console.log(`DB: ${path.relative(process.cwd(), dbPath)}`);
console.log(`Ollama endpoint: ${endpoint}`);
console.log(`Model: ${model}`);
console.log(`Queued jobs selected: ${jobs.length}`);
console.log(`Dry run: ${dryRun}`);
console.log(`Retry needs_review: ${retryNeedsReview}`);
console.log(`Target langs: ${targetLangs.length ? targetLangs.join(',') : 'all'}`);

if (prewarm && jobs.length) {
  const result = await prewarmModel();
  console.log(
    `[prewarm] ok=${result.ok} seconds=${result.seconds} load_seconds=${result.load_seconds ?? 'n/a'}${
      result.error ? ` error=${result.error}` : ''
    }`
  );
}

const stats = {
  selected: jobs.length,
  accepted: 0,
  needs_review: 0,
  failed: 0,
  skipped_claimed: 0,
  dry_run: dryRun
};

for (const job of jobs) {
  const input = JSON.parse(job.input_json);
  const started = performance.now();

  if (!dryRun) {
    const claim = statements.markRunning.run(job.id);
    if (claim.changes === 0) {
      stats.skipped_claimed++;
      console.log(`[skipped] job=${job.id} already claimed by another worker`);
      continue;
    }
  }

  try {
    const envelope = await callOllama(input);
    const seconds = Number(((performance.now() - started) / 1000).toFixed(2));
    const content = envelope?.message?.content || envelope?.response || '';
    const output = parseJson(content);
    const validation = validateOutput(output, input);
    const status = validation.errors.length ? 'needs_review' : 'accepted';

    if (!dryRun && status === 'accepted') {
      applyAcceptedJob({ job, input, output });
    }
    if (!dryRun) {
      statements.markDone.run(status, JSON.stringify(output, null, 2), validation.errors.join('; ') || null, job.id);
    }

    stats[status]++;
    console.log(
      `[${status}] job=${job.id} sense=${job.target_id} lang=${job.lang} entry=${input.entry?.word} seconds=${seconds} score=${validation.score}/${validation.max_score}`
    );
    if (validation.errors.length) console.log(`  errors: ${validation.errors.join('; ')}`);
  } catch (error) {
    stats.failed++;
    const message = `${error.name || 'Error'}: ${error.message || String(error)}`;
    if (!dryRun) statements.markDone.run('failed', null, message, job.id);
    console.log(`[failed] job=${job.id} sense=${job.target_id} lang=${job.lang}: ${message}`);
  }
}

const summary = {
  ok: true,
  db: path.relative(process.cwd(), dbPath),
  endpoint,
  provider,
  model,
  prompt_version: promptVersion,
  stats,
  remaining_queued: db
    .prepare(
      `
      SELECT lang, COUNT(*) AS c
      FROM llm_completion_jobs
      WHERE target_type = 'sense_localization'
        AND provider = ?
        AND model = ?
        AND prompt_version = ?
        AND status = 'queued'
      GROUP BY lang
      ORDER BY lang
    `
    )
    .all(provider, model, promptVersion)
};

db.close();
console.log(JSON.stringify(summary, null, 2));

function applyAcceptedJob({ job, input, output }) {
  const loc = output.sense_localization;
  if (!statements.localizationExists.get(job.target_id, job.lang)) {
    statements.insertLocalization.run({
      sense_id: job.target_id,
      lang: job.lang,
      term: cleanText(loc.term),
      normalized_term: cleanText(loc.term).toLocaleLowerCase(),
      reading: cleanNullable(loc.reading),
      reading_system: cleanNullable(loc.reading_system),
      pronunciation: cleanNullable(loc.pronunciation),
      pronunciation_system: cleanNullable(loc.pronunciation_system),
      definition: cleanText(loc.definition),
      usage_note: cleanNullable(loc.usage_note),
      source: `${provider}:${model}`,
      confidence: 0.78,
      needs_review: 0
    });
  }

  for (const example of output.example_localizations || []) {
    const exampleId = Number(example.example_id);
    if (!Number.isInteger(exampleId)) continue;
    if (!statements.exampleExists.get(exampleId, job.target_id)) continue;
    if (statements.exampleLocalizationExists.get(exampleId, job.lang)) continue;

    statements.insertExampleLocalization.run({
      example_id: exampleId,
      lang: job.lang,
      text: cleanText(example.text),
      reading: cleanNullable(example.reading),
      source: `${provider}:${model}`,
      confidence: 0.72,
      needs_review: 0
    });
  }

  statements.resolveMissingIssue.run(job.target_id, `missing_${job.lang}_localization`);
}

async function prewarmModel() {
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
      seconds: Number(((performance.now() - started) / 1000).toFixed(2)),
      load_seconds: envelope.load_duration ? Number((envelope.load_duration / 1_000_000_000).toFixed(2)) : null
    };
  } catch (error) {
    return {
      ok: false,
      seconds: Number(((performance.now() - started) / 1000).toFixed(2)),
      error: `${error.name || 'Error'}: ${error.message || String(error)}`
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callOllama(input) {
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
              'If requirements.include_example_localizations is false, return an empty example_localizations array and do not translate examples.',
              "For English articles and grammar words, use target-language grammar labels when needed: for example ja 定冠詞/ていかんし for 'the', ja 不定冠詞/ふていかんし for 'a' or 'an', zh 定冠词/ding4 guan4 ci2, pt-BR artigo definido.",
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
  const exampleInstruction =
    input.requirements?.include_example_localizations === false
      ? 'Core-lite mode: do not translate examples. Return an empty example_localizations array.'
      : input.examples?.length
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
  const definitionDescription = {
    en: 'English definition written in English.',
    zh: 'Chinese definition written in Chinese characters. Do not write this definition in English.',
    ja: 'Japanese definition written in Japanese kana or kanji. Do not write this definition in English.',
    'pt-BR': 'Brazilian Portuguese definition written in Portuguese. Do not write this definition in English.'
  }[lang];

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
          definition: { type: 'string', minLength: 1, description: definitionDescription },
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

function cleanText(value) {
  return String(value || '').trim();
}

function cleanNullable(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
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
  if (lang === 'zh') return /[A-Za-züÜāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜńň]/u.test(text);
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
