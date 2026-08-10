import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const LANGS = ['en', 'pt-BR', 'zh', 'ja'];
const DEFAULT_DB = 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const DEFAULT_ENDPOINTS = [
  'http://100.99.99.99:11441',
  'http://100.99.99.99:11444',
  'http://100.99.99.99:11448',
  'http://100.99.99.99:11447'
];
const DEFAULT_MODEL = 'unsloth/Qwen3.6-35B-A3B-MTP-GGUF';
const SOURCE = 'unsloth:coverage-supplement-20260622';

const COVERAGE_TERMS = [
  {
    headword: '\u4e0b\u5355',
    normalized_key: '\u4e0b\u5355',
    primary_lang: 'zh',
    frequency_rank: 47593,
    group_key: 'coverage:zh:\u4e0b\u5355',
    part_of_speech: 'verb',
    gloss_key: 'place an order; order goods or services',
    prompt_hint: 'Chinese verb meaning to place an order or submit an order online.'
  },
  {
    headword: 'place an order',
    normalized_key: 'place an order',
    primary_lang: 'en',
    frequency_rank: null,
    group_key: 'coverage:en:place an order',
    part_of_speech: 'verb phrase',
    gloss_key: 'submit an order to buy goods or services',
    prompt_hint: 'English verb phrase meaning to submit a purchase request.'
  }
];

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const token = args.token || process.env.UNSLOTH_API_KEY;
const endpoints = String(args.endpoints || DEFAULT_ENDPOINTS.join(','))
  .split(',')
  .map((item) => item.trim().replace(/\/$/, ''))
  .filter(Boolean);
const model = args.model || DEFAULT_MODEL;
const outPath = path.resolve(args.out || 'logs/product-coverage-supplement-20260622.json');
const dryRun = args['dry-run'] === true || args['dry-run'] === 'true';
const timeoutMs = Number(args['timeout-ms'] || 180_000);
const startEndpointIndex = Number(args['endpoint-index'] || 0) % endpoints.length;

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
if (!token && !args['use-fixture']) throw new Error('Missing --token or UNSLOTH_API_KEY');

const generated = [];
for (const term of COVERAGE_TERMS) {
  const started = performance.now();
  const result = args['use-fixture']
    ? { endpoint: 'fixture', output: fixtureFor(term) }
    : await generateTermWithFallback(term);
  const output = result.output;
  const validation = validateOutput(term, output);
  generated.push({
    term: term.headword,
    endpoint: result.endpoint,
    seconds: Number(((performance.now() - started) / 1000).toFixed(2)),
    valid: validation.errors.length === 0,
    errors: validation.errors,
    output
  });
}

const accepted = generated.filter((item) => item.valid).map((item) => item.output);
const stats = {
  db: path.relative(process.cwd(), dbPath),
  endpoints,
  model,
  dry_run: dryRun,
  generated: generated.length,
  accepted: accepted.length,
  rejected: generated.length - accepted.length,
  entries_inserted: 0,
  entries_reused: 0,
  senses_inserted: 0,
  senses_reused: 0,
  localizations_upserted: 0,
  examples_inserted: 0,
  examples_reused: 0,
  example_localizations_upserted: 0
};

if (!dryRun && accepted.length) {
  applySupplements(accepted, stats);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ ok: stats.rejected === 0, stats, generated }, null, 2), 'utf8');
console.log(JSON.stringify({ ok: stats.rejected === 0, out: path.relative(process.cwd(), outPath), stats }, null, 2));

async function generateTermWithFallback(term) {
  const errors = [];
  for (let offset = 0; offset < endpoints.length; offset++) {
    const endpoint = endpoints[(startEndpointIndex + offset) % endpoints.length];
    try {
      return { endpoint, output: await generateTerm(term, endpoint) };
    } catch (error) {
      errors.push(`${endpoint}: ${error?.name || 'Error'}: ${error?.message || String(error)}`);
    }
  }
  throw new Error(`All endpoints failed for ${term.headword}: ${errors.join(' | ')}`);
}

async function generateTerm(term, endpoint) {
  const response = await fetch(`${endpoint}/v1/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0,
      max_tokens: 450,
      enable_thinking: false,
      reasoning_effort: 'none',
      messages: [
        {
          role: 'system',
          content: 'You produce dictionary data. Return only strict JSON. No markdown, no comments, no extra keys.'
        },
        {
          role: 'user',
          content: buildPrompt(term)
        }
      ]
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
  const envelope = JSON.parse(text);
  return parseJson(envelope?.choices?.[0]?.message?.content || '');
}

function buildPrompt(term) {
  return [
    'Return only compact JSON, no markdown.',
    `headword=${JSON.stringify(term.headword)} primary_lang=${term.primary_lang} meaning=${term.prompt_hint}`,
    `Use fixed fields: normalized_key=${JSON.stringify(term.normalized_key)}, frequency_rank=${term.frequency_rank}, group_key=${JSON.stringify(term.group_key)}, part_of_speech=${JSON.stringify(term.part_of_speech)}, gloss_key=${JSON.stringify(term.gloss_key)}.`,
    'Shape: {headword,normalized_key,primary_lang,frequency_rank,group_key,part_of_speech,gloss_key,localizations:{en:{term,pronunciation,pronunciation_system,definition},"pt-BR":{term,pronunciation,pronunciation_system,definition},zh:{term,reading,reading_system,definition},ja:{term,reading,reading_system,definition}},example:{source_lang,source_text,localizations:{en:{text},"pt-BR":{text},zh:{text,reading},ja:{text,reading}}}}',
    'Rules: source language term equals headword; zh is Simplified Chinese with pinyin; ja has kana reading; definitions and examples are short.'
  ].join('\n');
}

function applySupplements(items, stats) {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 30000');
  const now = new Date().toISOString();

  const statements = {
    getEntry: db.prepare('SELECT id FROM product_entries WHERE group_key = ?'),
    insertEntry: db.prepare(`
      INSERT INTO product_entries
        (headword, normalized_key, primary_lang, frequency_rank, group_key, group_method, status, source_count, lang_count, created_at)
      VALUES
        (@headword, @normalized_key, @primary_lang, @frequency_rank, @group_key, 'coverage_supplement', 'accepted', 1, 4, @created_at)
    `),
    getSense: db.prepare('SELECT id FROM product_senses WHERE product_entry_id = ? AND gloss_key = ?'),
    insertSense: db.prepare(`
      INSERT INTO product_senses
        (product_entry_id, sense_order, part_of_speech, gloss_key, status, confidence, created_at)
      VALUES
        (@product_entry_id, 1, @part_of_speech, @gloss_key, 'accepted', 0.86, @created_at)
    `),
    upsertLocalization: db.prepare(`
      INSERT INTO product_localizations
        (product_sense_id, lang, term, reading, reading_system, pronunciation, pronunciation_system, definition, source, confidence, needs_review)
      VALUES
        (@product_sense_id, @lang, @term, @reading, @reading_system, @pronunciation, @pronunciation_system, @definition, @source, 0.86, 0)
      ON CONFLICT(product_sense_id, lang) DO UPDATE SET
        term = excluded.term,
        reading = excluded.reading,
        reading_system = excluded.reading_system,
        pronunciation = excluded.pronunciation,
        pronunciation_system = excluded.pronunciation_system,
        definition = excluded.definition,
        source = excluded.source,
        confidence = excluded.confidence,
        needs_review = 0
    `),
    getExample: db.prepare('SELECT id FROM product_examples WHERE product_sense_id = ? AND source = ?'),
    insertExample: db.prepare(`
      INSERT INTO product_examples
        (product_sense_id, source_example_id, example_order, source_lang, source_text, source, confidence, needs_review)
      VALUES
        (@product_sense_id, @source_example_id, 1, @source_lang, @source_text, @source, 0.8, 0)
    `),
    upsertExampleLocalization: db.prepare(`
      INSERT INTO product_example_localizations
        (product_example_id, lang, text, reading, source, confidence, needs_review)
      VALUES
        (@product_example_id, @lang, @text, @reading, @source, 0.8, 0)
      ON CONFLICT(product_example_id, lang) DO UPDATE SET
        text = excluded.text,
        reading = excluded.reading,
        source = excluded.source,
        confidence = excluded.confidence,
        needs_review = 0
    `)
  };

  db.transaction(() => {
    for (const item of items) {
      let entryId = statements.getEntry.get(item.group_key)?.id;
      if (entryId) {
        stats.entries_reused++;
      } else {
        entryId = Number(statements.insertEntry.run({ ...item, created_at: now }).lastInsertRowid);
        stats.entries_inserted++;
      }

      let senseId = statements.getSense.get(entryId, item.gloss_key)?.id;
      if (senseId) {
        stats.senses_reused++;
      } else {
        senseId = Number(
          statements.insertSense.run({
            product_entry_id: entryId,
            part_of_speech: item.part_of_speech,
            gloss_key: item.gloss_key,
            created_at: now
          }).lastInsertRowid
        );
        stats.senses_inserted++;
      }

      for (const lang of LANGS) {
        const loc = item.localizations[lang];
        statements.upsertLocalization.run({
          product_sense_id: senseId,
          lang,
          term: loc.term,
          reading: loc.reading || null,
          reading_system: loc.reading_system || null,
          pronunciation: loc.pronunciation || null,
          pronunciation_system: loc.pronunciation_system || null,
          definition: loc.definition,
          source: SOURCE
        });
        stats.localizations_upserted++;
      }

      const exampleSource = `${SOURCE}:${item.group_key}`;
      let exampleId = statements.getExample.get(senseId, exampleSource)?.id;
      if (exampleId) {
        stats.examples_reused++;
      } else {
        exampleId = Number(
          statements.insertExample.run({
            product_sense_id: senseId,
            source_example_id: -senseId,
            source_lang: item.example.source_lang,
            source_text: item.example.source_text,
            source: exampleSource
          }).lastInsertRowid
        );
        stats.examples_inserted++;
      }

      for (const lang of LANGS) {
        const ex = item.example.localizations[lang];
        statements.upsertExampleLocalization.run({
          product_example_id: exampleId,
          lang,
          text: ex.text,
          reading: ex.reading || null,
          source: SOURCE
        });
        stats.example_localizations_upserted++;
      }
    }
  })();

  db.close();
}

function validateOutput(term, output) {
  const errors = [];
  if (!output || typeof output !== 'object') return { errors: ['not_json_object'] };
  for (const key of ['headword', 'normalized_key', 'primary_lang', 'group_key', 'part_of_speech', 'gloss_key']) {
    if (output[key] !== term[key]) errors.push(`mismatch_${key}`);
  }
  if (output.frequency_rank !== term.frequency_rank) errors.push('mismatch_frequency_rank');
  if (!output.localizations || typeof output.localizations !== 'object') errors.push('missing_localizations');
  for (const lang of LANGS) {
    const loc = output.localizations?.[lang];
    if (!loc) {
      errors.push(`missing_loc_${lang}`);
      continue;
    }
    if (!nonEmpty(loc.term)) errors.push(`missing_term_${lang}`);
    if (!nonEmpty(loc.definition)) errors.push(`missing_definition_${lang}`);
    if (lang === 'zh') {
      if (!nonEmpty(loc.reading)) errors.push('missing_zh_reading');
      if (loc.reading_system !== 'pinyin') errors.push('invalid_zh_reading_system');
      if (hasTraditionalOrMojibake(loc.term) || hasTraditionalOrMojibake(loc.definition)) errors.push('bad_zh_script');
    }
    if (lang === 'ja' && !nonEmpty(loc.reading)) errors.push('missing_ja_reading');
  }
  if (output.primary_lang === 'zh' && output.localizations?.zh?.term !== output.headword)
    errors.push('zh_source_term_mismatch');
  if (output.primary_lang === 'en' && output.localizations?.en?.term !== output.headword)
    errors.push('en_source_term_mismatch');

  const ex = output.example;
  if (!ex || typeof ex !== 'object') errors.push('missing_example');
  else {
    if (ex.source_lang !== term.primary_lang) errors.push('example_source_lang_mismatch');
    if (!nonEmpty(ex.source_text)) errors.push('missing_example_source_text');
    for (const lang of LANGS) {
      const loc = ex.localizations?.[lang];
      if (!loc || !nonEmpty(loc.text)) errors.push(`missing_example_${lang}`);
      if (lang === 'zh' && loc && (hasTraditionalOrMojibake(loc.text) || !nonEmpty(loc.reading))) {
        errors.push('bad_zh_example');
      }
    }
  }
  return { errors };
}

function parseJson(content) {
  const text = String(content || '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error(`Model did not return JSON: ${text.slice(0, 500)}`);
  }
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasTraditionalOrMojibake(value) {
  const text = String(value || '');
  return /[\uFFFD]|[閒體傳統後來個們國動學說話語讀寫買賣網頁車門間長電腦]/u.test(text);
}

function fixtureFor(term) {
  if (term.headword === '\u4e0b\u5355') {
    return {
      ...term,
      localizations: {
        en: {
          term: 'place an order',
          pronunciation: '/ple\u026as \u0259n \u02c8\u0254\u02d0rd\u0259r/',
          pronunciation_system: 'IPA',
          definition: 'To submit a request to buy goods or services.'
        },
        'pt-BR': {
          term: 'fazer um pedido',
          pronunciation: '/fa\u02c8ze\u0281 \u0169 pe\u02c8d\u0292i.du/',
          pronunciation_system: 'IPA',
          definition: 'Enviar ou registrar uma solicita\u00e7\u00e3o de compra de produtos ou servi\u00e7os.'
        },
        zh: {
          term: '\u4e0b\u5355',
          reading: 'xi\u00e0 d\u0101n',
          reading_system: 'pinyin',
          definition: '\u63d0\u4ea4\u8ba2\u5355\uff1b\u8ba2\u8d2d\u5546\u54c1\u6216\u670d\u52a1\u3002'
        },
        ja: {
          term: '\u6ce8\u6587\u3059\u308b',
          reading: '\u3061\u3085\u3046\u3082\u3093\u3059\u308b',
          reading_system: 'kana',
          definition:
            '\u5546\u54c1\u3084\u30b5\u30fc\u30d3\u30b9\u3092\u8cfc\u5165\u3059\u308b\u305f\u3081\u306b\u6ce8\u6587\u3092\u51fa\u3059\u3002'
        }
      },
      example: {
        source_lang: 'zh',
        source_text: '\u6211\u521a\u521a\u5728\u7f51\u4e0a\u4e0b\u5355\u4e86\u3002',
        localizations: {
          en: { text: 'I just placed an order online.' },
          'pt-BR': { text: 'Acabei de fazer um pedido online.' },
          zh: {
            text: '\u6211\u521a\u521a\u5728\u7f51\u4e0a\u4e0b\u5355\u4e86\u3002',
            reading: 'w\u01d2 g\u0101ng g\u0101ng z\u00e0i w\u01ceng sh\u00e0ng xi\u00e0 d\u0101n le.'
          },
          ja: {
            text: '\u3055\u304d\u307b\u3069\u30aa\u30f3\u30e9\u30a4\u30f3\u3067\u6ce8\u6587\u3057\u307e\u3057\u305f\u3002',
            reading:
              '\u3055\u304d\u307b\u3069\u304a\u3093\u3089\u3044\u3093\u3067\u3061\u3085\u3046\u3082\u3093\u3057\u307e\u3057\u305f'
          }
        }
      }
    };
  }
  return {
    ...term,
    localizations: {
      en: {
        term: 'place an order',
        pronunciation: '/ple\u026as \u0259n \u02c8\u0254\u02d0rd\u0259r/',
        pronunciation_system: 'IPA',
        definition: 'To submit a request to buy goods or services.'
      },
      'pt-BR': {
        term: 'fazer um pedido',
        pronunciation: '/fa\u02c8ze\u0281 \u0169 pe\u02c8d\u0292i.du/',
        pronunciation_system: 'IPA',
        definition: 'Enviar ou registrar uma solicita\u00e7\u00e3o de compra de produtos ou servi\u00e7os.'
      },
      zh: {
        term: '\u4e0b\u5355',
        reading: 'xi\u00e0 d\u0101n',
        reading_system: 'pinyin',
        definition: '\u63d0\u4ea4\u8ba2\u5355\uff1b\u8ba2\u8d2d\u5546\u54c1\u6216\u670d\u52a1\u3002'
      },
      ja: {
        term: '\u6ce8\u6587\u3059\u308b',
        reading: '\u3061\u3085\u3046\u3082\u3093\u3059\u308b',
        reading_system: 'kana',
        definition:
          '\u5546\u54c1\u3084\u30b5\u30fc\u30d3\u30b9\u3092\u8cfc\u5165\u3059\u308b\u305f\u3081\u306b\u6ce8\u6587\u3092\u51fa\u3059\u3002'
      }
    },
    example: {
      source_lang: 'en',
      source_text: 'I just placed an order online.',
      localizations: {
        en: { text: 'I just placed an order online.' },
        'pt-BR': { text: 'Acabei de fazer um pedido online.' },
        zh: {
          text: '\u6211\u521a\u521a\u5728\u7f51\u4e0a\u4e0b\u5355\u4e86\u3002',
          reading: 'w\u01d2 g\u0101ng g\u0101ng z\u00e0i w\u01ceng sh\u00e0ng xi\u00e0 d\u0101n le.'
        },
        ja: {
          text: '\u3055\u304d\u307b\u3069\u30aa\u30f3\u30e9\u30a4\u30f3\u3067\u6ce8\u6587\u3057\u307e\u3057\u305f\u3002',
          reading:
            '\u3055\u304d\u307b\u3069\u304a\u3093\u3089\u3044\u3093\u3067\u3061\u3085\u3046\u3082\u3093\u3057\u307e\u3057\u305f'
        }
      }
    }
  };
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) parsed[key] = true;
    else {
      parsed[key] = next;
      index++;
    }
  }
  return parsed;
}
