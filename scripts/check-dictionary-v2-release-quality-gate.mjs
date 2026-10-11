#!/usr/bin/env node
// Fast release quality gate for the production pipeline.
// Runs critical structural checks on the isolated DB before commit.
// Fails (exit 1) if genuine issues exceed the configured tolerance.

import Database from 'better-sqlite3';
import OpenCC from 'opencc-js';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const dbPath = requiredPath(args.db, 'db');
const outPath = path.resolve(args.out || 'release-quality-gate.json');
const maxTermMismatch = parseInt(args['max-term-mismatch'] || '0', 10);
const maxDuplicates = parseInt(args['max-duplicates'] || '0', 10);

const db = new Database(dbPath, { readonly: true });
db.pragma('query_only = ON');
const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });

// === Check 1: Term-headword mismatches (genuine, not zh script variants) ===
const mismatchRows = db.prepare(`
  SELECT e.primary_lang, e.headword, l.term, s.id AS sense_id
  FROM product_senses s
  JOIN product_entries e ON e.id = s.product_entry_id
  JOIN product_localizations l ON l.product_sense_id = s.id AND l.lang = e.primary_lang
  WHERE s.status = 'accepted' AND l.needs_review = 0
    AND TRIM(l.term) != TRIM(e.headword)
  LIMIT 5000
`).all();
let genuineMismatch = 0;
const mismatchSamples = [];
for (const r of mismatchRows) {
  if (r.primary_lang === 'zh' && toSimplified(r.headword.trim()) === r.term.trim()) continue;
  genuineMismatch++;
  if (mismatchSamples.length < 5) {
    mismatchSamples.push(`${r.primary_lang}:"${r.headword}" -> "${r.term}" (#${r.sense_id})`);
  }
}

// === Check 2: Duplicate senses ===
const dupRows = db.prepare(`
  SELECT e.primary_lang, e.headword, LOWER(TRIM(s.gloss_key)) AS gk, COUNT(*) AS cnt
  FROM product_senses s
  JOIN product_entries e ON e.id = s.product_entry_id
  WHERE s.status = 'accepted'
  GROUP BY e.id, LOWER(TRIM(s.gloss_key))
  HAVING cnt > 1
  LIMIT 1000
`).all();
const duplicateCount = dupRows.length;

// === Verdict ===
const failed = genuineMismatch > maxTermMismatch || duplicateCount > maxDuplicates;
const output = {
  ok: !failed,
  scope: 'pre-commit quality gate (fast structural checks only)',
  checked_at: new Date().toISOString(),
  db: path.basename(dbPath),
  findings: {
    genuine_term_headword_mismatches: genuineMismatch,
    zh_script_variant_false_positives: mismatchRows.length - genuineMismatch,
    duplicate_senses: duplicateCount
  },
  tolerance: { max_term_mismatch: maxTermMismatch, max_duplicates: maxDuplicates },
  samples: { mismatches: mismatchSamples, duplicates: dupRows.slice(0, 5).map((d) => `${d.primary_lang}:${d.headword} "${String(d.gk).slice(0, 30)}" x${d.cnt}`) }
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ ok: output.ok, findings: output.findings }));
if (failed) {
  console.error('QUALITY GATE FAILED:');
  if (genuineMismatch > maxTermMismatch) console.error(`  term mismatches: ${genuineMismatch} > ${maxTermMismatch}`);
  if (duplicateCount > maxDuplicates) console.error(`  duplicates: ${duplicateCount} > ${maxDuplicates}`);
  for (const s of mismatchSamples) console.error('  ' + s);
  process.exit(1);
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
