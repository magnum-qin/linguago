#!/usr/bin/env node
// Apply Gemma-accepted examples to the product DB after deterministic
// structural gates. Insert-only: existing senses, examples, and localizations
// are never modified. Dry-run by default; --apply true writes in one
// transaction with a before/after audit.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(
  args.db || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db'
);
const reviewPath = requiredPath(args.review, 'review');
const outPath = path.resolve(args.out || 'logs/example-enrichment-apply.json');
const apply = args.apply === 'true';
const source = String(args.source || 'llm:qwen-generate-gemma-review');
const LANGS = ['en', 'zh', 'ja', 'pt-BR'];

const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
const accepted = (review.reviews || []).filter(
  (row) => row.valid && row.decision === 'accept' && row.source_text && row.translations
);
if (!accepted.length) throw new Error('No accepted examples in review report');

const db = new Database(dbPath, { fileMustExist: true });
const before = snapshot(db);
const rejected = [];
const inserts = [];

const existingExamples = new Set(
  db.prepare('SELECT product_sense_id, source_text FROM product_examples').all()
    .map((row) => `${Number(row.product_sense_id)}:${normalize(row.source_text)}`)
);
const senseRows = db.prepare(`
  SELECT ps.id, ps.gloss_key, pe.headword, pe.primary_lang
  FROM product_senses ps JOIN product_entries pe ON pe.id = ps.product_entry_id
  WHERE ps.id = ? AND ps.status = 'accepted'
`);
// Synthetic source ids stay negative and below the 6/24 manual range so they
// can never collide with real dictionary source example ids.
let nextSyntheticSourceExampleId = db.prepare(
  'SELECT COALESCE(MIN(source_example_id), 0) - 1 AS next FROM product_examples'
).get().next;
if (nextSyntheticSourceExampleId > -970000) nextSyntheticSourceExampleId = -970001;
const nextExampleOrder = db.prepare(
  'SELECT COALESCE(MAX(example_order), 0) + 1 AS next FROM product_examples WHERE product_sense_id = ?'
);

for (const row of accepted) {
  const senseId = Number(row.product_sense_id);
  const sense = senseRows.get(senseId);
  if (!sense) { reject(row, 'sense_not_accepted'); continue; }
  const sourceText = String(row.source_text).trim();
  const translations = row.translations;
  if (LANGS.some((lang) => !String(translations[lang] || '').trim())) { reject(row, 'missing_translation'); continue; }
  if (!containsWord(sourceText, sense.headword, sense.primary_lang)) { reject(row, 'headword_not_in_sentence'); continue; }
  if (/�/u.test(sourceText) || /<[^>]+>/u.test(sourceText) || Object.values(translations).some((t) => /�/u.test(String(t)) || /<[^>]+>/u.test(String(t)))) {
    reject(row, 'mojibake_or_html'); continue;
  }
  const dupeKey = `${senseId}:${normalize(sourceText)}`;
  if (existingExamples.has(dupeKey)) { reject(row, 'duplicate_example'); continue; }
  existingExamples.add(dupeKey);
  if (row.ja_reading && !/^[\u3040-\u30ff\u3005\s]*$/u.test(row.ja_reading)) { reject(row, 'bad_ja_reading'); continue; }
  inserts.push({
    sense_id: senseId,
    headword: sense.headword,
    primary_lang: sense.primary_lang,
    example_order: nextExampleOrder.get(senseId).next,
    source_lang: sense.primary_lang,
    source_text: sourceText,
    translations,
    ja_reading: row.ja_reading || null
  });
}

let insertedExamples = 0;
let insertedLocalizations = 0;
if (apply && inserts.length) {
  const tx = db.transaction(() => {
    const insertExample = db.prepare(`
      INSERT INTO product_examples (product_sense_id, source_example_id, example_order, source_lang, source_text, source, confidence, needs_review)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `);
    const insertLocalization = db.prepare(`
      INSERT INTO product_example_localizations (product_example_id, lang, text, reading, source, confidence, needs_review)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `);
    for (const item of inserts) {
      const confidence = boundedConfidence(review, item.sense_id);
      const exampleId = Number(
        insertExample.run(item.sense_id, nextSyntheticSourceExampleId++, item.example_order, item.source_lang, item.source_text, source, confidence).lastInsertRowid
      );
      insertedExamples += 1;
      for (const lang of LANGS) {
        const text = String(item.translations[lang]).trim();
        const reading = lang === 'ja' ? item.ja_reading : null;
        if (lang === item.primary_lang && normalize(text) === normalize(item.source_text)) {
          insertLocalization.run(exampleId, lang, item.source_text, reading, source, confidence);
        } else {
          insertLocalization.run(exampleId, lang, text, reading, source, confidence);
        }
        insertedLocalizations += 1;
      }
    }
  });
  tx();
}
const after = apply ? snapshot(db) : before;

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  review_report: path.relative(process.cwd(), reviewPath),
  policy: { apply, source, insert_only: true, automatic_publication: false },
  summary: {
    accepted_input: accepted.length,
    gate_rejected: rejected.length,
    rejected_by_reason: countBy(rejected, (row) => row.reason),
    planned_inserts: inserts.length,
    inserted_examples: insertedExamples,
    inserted_example_localizations: insertedLocalizations,
    examples_before: before.examples,
    examples_after: after.examples
  },
  rejected,
  planned: inserts.map((item) => ({ sense_id: item.sense_id, headword: item.headword, source_text: item.source_text }))
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(output.summary));
db.close();

function snapshot(database) {
  return {
    examples: database.prepare('SELECT COUNT(*) n FROM product_examples').get().n,
    example_localizations: database.prepare('SELECT COUNT(*) n FROM product_example_localizations').get().n
  };
}

function containsWord(sentence, headword, lang) {
  const text = normalize(sentence);
  const word = normalize(headword);
  if (!word) return false;
  if (text.includes(word)) return true;
  if (lang === 'en' || lang === 'pt-BR') {
    // Latin-script headwords may be inflected in the sentence; accept a
    // stem-prefix match for words of 5+ chars (e.g. "running" for "run" is
    // NOT accepted — only prefix extensions like "trabalhavam" for
    // "trabalhar" style stems, bounded to a 3-char suffix).
    if (word.length >= 5 && new RegExp(`\\b${escapeRegExp(word.slice(0, -1))}[a-zà-ÿ]{0,3}\\b`, 'u').test(text)) {
      return true;
    }
    if (word.length >= 5 && new RegExp(`\\b${escapeRegExp(word)}[a-zà-ÿ]{0,3}\\b`, 'u').test(text)) {
      return true;
    }
  }
  return false;
}

function boundedConfidence(reviewReport, senseId) {
  const row = (reviewReport.reviews || []).find((r) => Number(r.product_sense_id) === senseId);
  const value = Number(row?.confidence);
  return Number.isFinite(value) ? Math.min(0.99, Math.max(0.5, value)) : 0.9;
}

function reject(row, reason) {
  rejected.push({ product_sense_id: row.product_sense_id, headword: row.headword, reason });
}

function normalize(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function countBy(rows, key) {
  const out = {};
  for (const row of rows) out[key(row)] = (out[key(row)] || 0) + 1;
  return out;
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) throw new Error(`Required file not found: ${resolved}`);
  return resolved;
}
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    out[key] = next && !next.startsWith('--') ? argv[++i] : 'true';
  }
  return out;
}
