#!/usr/bin/env node
// Deterministic repair for Layer 1 quality audit findings.
// Fixes: term-headword mismatches (genuine only, not zh script variants),
// duplicate senses, broken source links, HTML artifacts in definitions.

import Database from 'better-sqlite3';
import OpenCC from 'opencc-js';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const dbPath = requiredPath(args.db, 'db');
const outPath = path.resolve(args.out || 'logs/quality-repair-layer1.json');
const apply = args.apply === 'true';

const db = new Database(dbPath);
db.pragma('busy_timeout = 30000');
db.pragma('foreign_keys = ON');
const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });
const stats = { apply, term_mismatch_fixed: 0, duplicates_removed: 0, broken_links_removed: 0, html_stripped: 0, short_def_flagged: 0 };

function run() {
  // === 1. Fix genuine term-headword mismatches ===
  console.log('Fixing term-headword mismatches...');
  const mismatches = db.prepare(`
    SELECT l.id AS loc_id, e.headword, l.term, e.primary_lang
    FROM product_senses s
    JOIN product_entries e ON e.id = s.product_entry_id
    JOIN product_localizations l ON l.product_sense_id = s.id AND l.lang = e.primary_lang
    WHERE s.status = 'accepted' AND l.needs_review = 0
      AND TRIM(l.term) != TRIM(e.headword)
  `).all();
  const fixTerm = db.prepare('UPDATE product_localizations SET term = ? WHERE id = ?');
  for (const r of mismatches) {
    // Skip zh traditional->simplified variants (legitimate)
    if (r.primary_lang === 'zh' && toSimplified(r.headword.trim()) === r.term.trim()) continue;
    fixTerm.run(r.headword.trim(), r.loc_id);
    stats.term_mismatch_fixed++;
  }

  // === 2. Remove duplicate senses (keep lowest sense_order) ===
  console.log('Removing duplicate senses...');
  const dupes = db.prepare(`
    SELECT e.id AS entry_id, LOWER(TRIM(s.gloss_key)) AS gk, 
           MIN(s.id) AS keep_id, COUNT(*) AS cnt
    FROM product_senses s
    JOIN product_entries e ON e.id = s.product_entry_id
    WHERE s.status = 'accepted'
    GROUP BY e.id, LOWER(TRIM(s.gloss_key))
    HAVING cnt > 1
  `).all();
  const delSense = db.prepare("DELETE FROM product_senses WHERE id = ? AND id != ?");
  const findDupes = db.prepare(`
    SELECT s.id FROM product_senses s
    WHERE s.product_entry_id = ? AND LOWER(TRIM(s.gloss_key)) = ? AND s.id != ?
      AND s.status = 'accepted'
  `);
  for (const d of dupes) {
    const dupes2 = findDupes.all(d.entry_id, d.gk, d.keep_id);
    for (const dup of dupes2) {
      delSense.run(dup.id, d.keep_id);
      stats.duplicates_removed++;
    }
  }

  // === 3. Remove broken source links ===
  console.log('Removing broken source links...');
  const brokenLinks = db.prepare(`
    SELECT l.id FROM product_sense_source_links l
    LEFT JOIN product_senses ps ON ps.id = l.product_sense_id
    WHERE ps.id IS NULL OR ps.status != 'accepted'
  `).all();
  const delLink = db.prepare('DELETE FROM product_sense_source_links WHERE id = ?');
  for (const l of brokenLinks) {
    delLink.run(l.id);
    stats.broken_links_removed++;
  }

  // === 4. Strip HTML from definitions ===
  console.log('Stripping HTML from definitions...');
  const htmlDefs = db.prepare(`
    SELECT l.id, l.definition FROM product_localizations l
    WHERE l.definition LIKE '%<%' AND l.definition LIKE '%>%'
      AND (l.definition LIKE '%<br%' OR l.definition LIKE '%<p%' OR l.definition LIKE '%<div%' 
           OR l.definition LIKE '%<span%' OR l.definition LIKE '%<a %' OR l.definition LIKE '%<i>%')
  `).all();
  const fixDef = db.prepare('UPDATE product_localizations SET definition = ? WHERE id = ?');
  for (const r of htmlDefs) {
    const cleaned = r.definition.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (cleaned !== r.definition) {
      fixDef.run(cleaned, r.id);
      stats.html_stripped++;
    }
  }

  // === 5. Flag too-short definitions for review ===
  console.log('Flagging short definitions...');
  const shortDefs = db.prepare(`
    SELECT l.id FROM product_localizations l
    JOIN product_senses s ON s.id = l.product_sense_id
    WHERE s.status = 'accepted' AND l.needs_review = 0
      AND (l.definition IS NULL OR LENGTH(TRIM(l.definition)) < 2)
  `).all();
  const flagDef = db.prepare('UPDATE product_localizations SET needs_review = 1 WHERE id = ?');
  for (const r of shortDefs) {
    flagDef.run(r.id);
    stats.short_def_flagged++;
  }
}

if (apply) {
  const txn = db.transaction(() => run());
  txn();
}
const quickCheck = db.prepare('PRAGMA quick_check').get().quick_check;
const output = { ...stats, quick_check: quickCheck, applied_at: new Date().toISOString() };
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
console.log('\n=== REPAIR RESULTS ===');
console.log(JSON.stringify(output, null, 2));
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
