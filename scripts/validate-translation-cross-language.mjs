#!/usr/bin/env node
// Layer 2: Semantic cross-language validation.
// Samples senses across frequency tiers and checks whether all four
// translations express the same meaning using the local model pool.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const dbPath = requiredPath(args.db, 'db');
const outPath = path.resolve(args.out || 'logs/quality-audit-layer2.json');
const sampleSize = parseInt(args.sample || '2000', 10);
const endpoints = (args.endpoints || 'http://127.0.0.1:11442,http://127.0.0.1:11444').split(',');
const model = args.model || 'unsloth/gemma-4-31B-it-qat-GGUF';
const maxSeqLength = parseInt(args['max-seq-length'] || '4096', 10);

const db = new Database(dbPath, { readonly: true });
db.pragma('query_only = ON');

// === Build stratified sample ===
console.log('Building stratified sample...');
const sample = [];

// Tier 1: top 500 by frequency per language
for (const lang of ['zh', 'en', 'ja', 'pt-BR']) {
  const top = db.prepare(`
    SELECT s.id AS sense_id, e.headword, e.primary_lang, s.gloss_key,
      (SELECT GROUP_CONCAT(l.lang || ':' || l.term, '|') FROM product_localizations l 
       WHERE l.product_sense_id = s.id AND l.needs_review = 0 AND l.term IS NOT NULL AND TRIM(l.term) != ''
      ) AS translations
    FROM product_senses s
    JOIN product_entries e ON e.id = s.product_entry_id
    WHERE s.status = 'accepted' AND e.primary_lang = ?
      AND e.frequency_rank IS NOT NULL
    ORDER BY e.frequency_rank
    LIMIT 125
  `).all(lang);
  sample.push(...top);
}

// Tier 2: basic vocabulary recovery
const basic = db.prepare(`
  SELECT s.id AS sense_id, e.headword, e.primary_lang, s.gloss_key,
    (SELECT GROUP_CONCAT(l.lang || ':' || l.term, '|') FROM product_localizations l 
     WHERE l.product_sense_id = s.id AND l.needs_review = 0 AND l.term IS NOT NULL AND TRIM(l.term) != ''
    ) AS translations
  FROM product_senses s
  JOIN product_entries e ON e.id = s.product_entry_id
  WHERE s.status = 'accepted' AND e.group_method LIKE 'basic%'
  LIMIT 500
`).all();
sample.push(...basic);

// Tier 3: random fill
const current = sample.length;
const remaining = Math.max(0, sampleSize - current);
if (remaining > 0) {
  const random = db.prepare(`
    SELECT s.id AS sense_id, e.headword, e.primary_lang, s.gloss_key,
      (SELECT GROUP_CONCAT(l.lang || ':' || l.term, '|') FROM product_localizations l 
       WHERE l.product_sense_id = s.id AND l.needs_review = 0 AND l.term IS NOT NULL AND TRIM(l.term) != ''
      ) AS translations
    FROM product_senses s
    JOIN product_entries e ON e.id = s.product_entry_id
    WHERE s.status = 'accepted' AND s.id NOT IN (SELECT id FROM (
      SELECT s2.id AS id FROM product_senses s2
      JOIN product_entries e2 ON e2.id = s2.product_entry_id
      WHERE s2.status = 'accepted' AND e2.frequency_rank IS NOT NULL
      ORDER BY e2.frequency_rank LIMIT 500
    )) AND s.id NOT IN (SELECT s3.id FROM product_senses s3
      JOIN product_entries e3 ON e3.id = s3.product_entry_id
      WHERE e3.group_method LIKE 'basic%'
    )
    ORDER BY RANDOM() LIMIT ?
  `).all(remaining);
  sample.push(...random);
}

// Deduplicate by sense_id
const seen = new Set();
const deduped = sample.filter((r) => {
  if (seen.has(r.sense_id)) return false;
  seen.add(r.sense_id);
  return r.translations && r.translations.split('|').length >= 4;
});

console.log(`Sample: ${deduped.length} senses (target: ${sampleSize})`);

// === Format and validate ===
function formatPrompt(row) {
  const parts = row.translations.split('|');
  const langs = {};
  for (const p of parts) {
    const [lang, ...rest] = p.split(':');
    langs[lang] = rest.join(':');
  }
  return `Do these four translations of "${row.headword}" (${row.primary_lang}) all express the same core meaning? The English gloss is: "${String(row.gloss_key).slice(0, 60)}".
zh: ${langs.zh || 'MISSING'}
en: ${langs.en || 'MISSING'}
ja: ${langs.ja || 'MISSING'}
pt-BR: ${langs['pt-BR'] || 'MISSING'}
Answer with exactly one word: "consistent" or "inconsistent", then if inconsistent, name the deviant language(s).`;
}

async function validateWithModel(rows) {
  const results = [];
  let endpointIdx = 0;
  const batchSize = 5;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const promises = batch.map(async (row) => {
      const endpoint = endpoints[endpointIdx++ % endpoints.length];
      try {
        const response = await fetch(`${endpoint}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: 'You are a multilingual translation quality auditor. Be concise.' },
              { role: 'user', content: formatPrompt(row) }
            ],
            max_tokens: 50,
            temperature: 0.1
          }),
          signal: AbortSignal.timeout(30000)
        });
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || '';
        const isInconsistent = /inconsist/i.test(text);
        return {
          sense_id: row.sense_id,
          headword: row.headword,
          lang: row.primary_lang,
          consistent: !isInconsistent,
          model_response: text.slice(0, 100),
          translations: row.translations
        };
      } catch (e) {
        return { sense_id: row.sense_id, headword: row.headword, lang: row.primary_lang, consistent: null, error: e.message.slice(0, 50) };
      }
    });
    const settled = await Promise.all(promises);
    results.push(...settled);

    if ((i / batchSize) % 20 === 0) {
      const done = results.filter((r) => r.consistent !== null).length;
      console.log(`Progress: ${done}/${rows.length}`);
    }
  }
  return results;
}

const results = await validateWithModel(deduped);

// === Summarize ===
const summary = {
  total_checked: results.filter((r) => r.consistent !== null).length,
  consistent: results.filter((r) => r.consistent === true).length,
  inconsistent: results.filter((r) => r.consistent === false).length,
  errors: results.filter((r) => r.consistent === null).length
};
const inconsistentList = results.filter((r) => r.consistent === false).map((r) => ({
  sense_id: r.sense_id, headword: r.headword, lang: r.lang,
  response: r.model_response, translations: r.translations
}));

const report = {
  generated_at: new Date().toISOString(),
  layer: 'semantic_cross_validation',
  model, sample_size: deduped.length,
  summary,
  inconsistent_count: inconsistentList.length,
  inconsistent_sample: inconsistentList.slice(0, 50)
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ ...report, all_results: results }, null, 2) + '\n');
console.log('\n=== LAYER 2 RESULTS ===');
console.log(`Checked: ${summary.total_checked} | Consistent: ${summary.consistent} | Inconsistent: ${summary.inconsistent} | Errors: ${summary.errors}`);
console.log(`Consistency rate: ${(summary.consistent / Math.max(1, summary.total_checked) * 100).toFixed(1)}%`);
if (inconsistentList.length > 0) {
  console.log('\nTop inconsistent translations:');
  for (const item of inconsistentList.slice(0, 10)) {
    console.log(`  ${item.lang}:${item.headword} -> ${item.response}`);
  }
}
db.close();

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const p = path.resolve(value);
  if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
  return p;
}
function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const next = argv[i + 1];
    result[argv[i].slice(2)] = next && !next.startsWith('--') ? argv[++i] : 'true';
  }
  return result;
}
