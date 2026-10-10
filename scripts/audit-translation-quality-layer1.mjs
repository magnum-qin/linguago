#!/usr/bin/env node
// Layer 1: Deterministic translation quality audit.
// Checks structural integrity of all publishable senses without model calls.
// Outputs a structured report with issue counts and actionable samples.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const dbPath = requiredPath(args.db, 'db');
const outPath = path.resolve(args.out || 'logs/quality-audit-layer1.json');
const db = new Database(dbPath, { readonly: true });
db.pragma('query_only = ON');

const issues = {};
const samples = {};

function addIssue(category, detail) {
  issues[category] = (issues[category] || 0) + 1;
  if (!samples[category]) samples[category] = [];
  if (samples[category].length < 5) samples[category].push(detail);
}

// === 1. Four-language completeness ===
console.log('Checking four-language completeness...');
const incomplete = db.prepare(`
  SELECT s.id AS sense_id, e.headword, e.primary_lang,
         GROUP_CONCAT(DISTINCT l.lang) AS langs,
         COUNT(DISTINCT l.lang) AS lang_count
  FROM product_senses s
  JOIN product_entries e ON e.id = s.product_entry_id
  LEFT JOIN product_localizations l ON l.product_sense_id = s.id AND l.needs_review = 0
    AND l.term IS NOT NULL AND TRIM(l.term) != ''
  WHERE s.status = 'accepted'
  GROUP BY s.id
  HAVING lang_count < 4
`).all();
for (const r of incomplete) {
  addIssue('incomplete_languages', `${r.primary_lang}:${r.headword} sense#${r.sense_id} has [${r.langs || 'none'}] (${r.lang_count}/4)`);
}

// === 2. Script consistency ===
console.log('Checking script consistency...');
const scriptMismatch = db.prepare(`
  SELECT l.lang, l.term, e.headword, e.primary_lang, s.id AS sense_id
  FROM product_localizations l
  JOIN product_senses s ON s.id = l.product_sense_id
  JOIN product_entries e ON e.id = s.product_entry_id
  WHERE s.status = 'accepted' AND l.needs_review = 0
    AND (
      (l.lang = 'ja' AND l.term NOT GLOB '*[ぁ-ヺ一-鿿]*' AND l.term NOT GLOB '*[ァ-ヺ]*')
      OR (l.lang = 'zh' AND l.term NOT GLOB '*[一-鿿]*')
      OR (l.lang = 'en' AND (l.term GLOB '*[一-鿿]*' OR l.term GLOB '*[ぁ-ヺ]*'))
      OR (l.lang = 'pt-BR' AND (l.term GLOB '*[一-鿿]*' OR l.term GLOB '*[ぁ-ヺ]*'))
    )
  LIMIT 200
`).all();
for (const r of scriptMismatch) {
  addIssue('script_mismatch', `${r.lang} term "${r.term}" for ${r.primary_lang}:${r.headword} sense#${r.sense_id}`);
}

// === 3. Pronunciation coverage (LEFT JOIN for speed) ===
console.log('Checking pronunciation coverage...');
const noPronunciation = db.prepare(`
  SELECT e.primary_lang, e.headword, e.id AS entry_id
  FROM product_entries e
  LEFT JOIN product_senses s ON s.product_entry_id = e.id AND s.status = 'accepted'
  LEFT JOIN product_localizations l ON l.product_sense_id = s.id
    AND l.lang = e.primary_lang
    AND (l.reading IS NOT NULL OR l.pronunciation IS NOT NULL)
  WHERE e.status = 'accepted' AND s.id IS NOT NULL AND l.id IS NULL
  GROUP BY e.id
  LIMIT 500
`).all();
for (const r of noPronunciation) {
  addIssue('missing_pronunciation', `${r.primary_lang}:${r.headword} entry#${r.entry_id}`);
}

// === 4. Definition quality ===
console.log('Checking definition quality...');
const badDefs = db.prepare(`
  SELECT l.lang, l.term, l.definition, e.headword, s.id AS sense_id
  FROM product_localizations l
  JOIN product_senses s ON s.id = l.product_sense_id
  JOIN product_entries e ON e.id = s.product_entry_id
  WHERE s.status = 'accepted' AND l.needs_review = 0
    AND (
      l.definition IS NULL
      OR TRIM(l.definition) = ''
      OR l.definition LIKE '%�%'
      OR l.definition LIKE '%<%'
      OR LENGTH(l.definition) < 2
      OR LENGTH(l.definition) > 1000
    )
  LIMIT 200
`).all();
for (const r of badDefs) {
  const reason = !r.definition || r.definition.trim() === '' ? 'empty'
    : r.definition.includes('�') ? 'mojibake'
    : r.definition.includes('<') ? 'html'
    : r.definition.length < 2 ? 'too_short'
    : 'too_long';
  addIssue('bad_definition_' + reason, `${r.lang}:"${r.term}" for sense#${r.sense_id}: ${String(r.definition || '').slice(0, 50)}`);
}

// === 5. Duplicate senses ===
console.log('Checking duplicate senses...');
const dupes = db.prepare(`
  SELECT e.headword, e.primary_lang, s.gloss_key, COUNT(*) AS cnt,
         GROUP_CONCAT(s.id) AS sense_ids
  FROM product_senses s
  JOIN product_entries e ON e.id = s.product_entry_id
  WHERE s.status = 'accepted'
  GROUP BY e.id, LOWER(TRIM(s.gloss_key))
  HAVING cnt > 1
  LIMIT 100
`).all();
for (const r of dupes) {
  addIssue('duplicate_senses', `${r.primary_lang}:${r.headword} "${String(r.gloss_key).slice(0, 40)}" x${r.cnt} [${r.sense_ids}]`);
}

// === 6. Source link validity ===
console.log('Checking source link validity...');
const brokenLinks = db.prepare(`
  SELECT l.product_sense_id, l.source_entry_id, l.source_sense_id
  FROM product_sense_source_links l
  LEFT JOIN product_senses ps ON ps.id = l.product_sense_id
  WHERE ps.id IS NULL OR ps.status != 'accepted'
  LIMIT 100
`).all();
for (const r of brokenLinks) {
  addIssue('broken_source_link', `sense#${r.product_sense_id} -> src#${r.source_sense_id}`);
}

// === 7. Term-headword consistency ===
console.log('Checking term-headword consistency...');
const termMismatches = db.prepare(`
  SELECT e.primary_lang, e.headword, l.term, l.lang, s.id AS sense_id
  FROM product_senses s
  JOIN product_entries e ON e.id = s.product_entry_id
  JOIN product_localizations l ON l.product_sense_id = s.id AND l.lang = e.primary_lang
  WHERE s.status = 'accepted' AND l.needs_review = 0
    AND TRIM(l.term) != TRIM(e.headword)
  LIMIT 200
`).all();
for (const r of termMismatches) {
  addIssue('term_headword_mismatch', `${r.primary_lang}: headword="${r.headword}" but ${r.lang} term="${r.term}" (sense#${r.sense_id})`);
}

// === Summary ===
const totalSenses = db.prepare("SELECT COUNT(*) c FROM product_senses WHERE status = 'accepted'").get().c;
const totalEntries = db.prepare("SELECT COUNT(*) c FROM product_entries WHERE status = 'accepted'").get().c;
const totalLocs = db.prepare("SELECT COUNT(*) c FROM product_localizations l JOIN product_senses s ON s.id = l.product_sense_id WHERE s.status = 'accepted' AND l.needs_review = 0").get().c;

const report = {
  generated_at: new Date().toISOString(),
  layer: 'deterministic',
  scope: { total_entries: totalEntries, total_accepted_senses: totalSenses, total_localizations: totalLocs },
  issue_summary: Object.fromEntries(Object.entries(issues).sort((a, b) => b[1] - a[1])),
  total_issues: Object.values(issues).reduce((a, b) => a + b, 0),
  samples
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log('\n=== LAYER 1 RESULTS ===');
console.log(`Entries: ${totalEntries} | Senses: ${totalSenses} | Localizations: ${totalLocs}`);
console.log(`Total issues: ${report.total_issues}`);
for (const [cat, count] of Object.entries(report.issue_summary)) {
  console.log(`  ${cat}: ${count}`);
  const s = samples[cat];
  if (s && s.length > 0) console.log(`    e.g. ${s[0]}`);
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
