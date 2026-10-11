#!/usr/bin/env node
// Local diagnostic proxy: answers the same questions as online D1 queries
// but reads from the main product DB (SQLite, zero quota) instead of D1.
// Use this for all diagnostics; only hit live D1 for final production checks.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const dbPath = requiredPath(args.db || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db', 'db');

const db = new Database(dbPath, { readonly: true });
db.pragma('query_only = ON');

const command = args._[0] || 'stats';

switch (command) {
  case 'stats': {
    const counts = {};
    for (const [name, table, statusCol] of [
      ['entries', 'product_entries', 'status'],
      ['senses', 'product_senses', 'status'],
      ['localizations', 'product_localizations', null],
      ['examples', 'product_examples', null],
    ]) {
      if (statusCol) {
        counts[name] = db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE ${statusCol} = 'accepted'`).get().c;
        counts[`${name}_total`] = db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c;
      } else {
        counts[name] = db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c;
      }
    }
    const publishable = db.prepare(`
      SELECT COUNT(DISTINCT s.id) c FROM product_senses s
      WHERE s.status = 'accepted'
        AND s.id IN (
          SELECT l.product_sense_id FROM product_localizations l
          WHERE l.needs_review = 0 AND l.term IS NOT NULL AND TRIM(l.term) != ''
          GROUP BY l.product_sense_id HAVING COUNT(DISTINCT l.lang) = 4
        )
    `).get().c;
    counts.publishable_senses = publishable;
    const flagged = db.prepare(`
      SELECT COUNT(*) c FROM product_senses s
      WHERE s.status = 'accepted'
        AND EXISTS (SELECT 1 FROM product_localizations l WHERE l.product_sense_id = s.id AND l.needs_review = 1)
    `).get().c;
    counts.flagged_senses = flagged;
    console.log(JSON.stringify(counts, null, 2));
    break;
  }
  case 'lookup': {
    const word = args.word;
    if (!word) throw new Error('--word required');
    const lang = args.lang || null;
    const entry = lang
      ? db.prepare("SELECT id, headword, primary_lang, status, frequency_rank FROM product_entries WHERE headword = ? AND primary_lang = ? AND status = 'accepted' LIMIT 1").get(word, lang)
      : db.prepare("SELECT id, headword, primary_lang, status, frequency_rank FROM product_entries WHERE headword = ? AND status = 'accepted' ORDER BY frequency_rank LIMIT 1").get(word);
    if (!entry) { console.log(JSON.stringify({ found: false, word })); break; }
    const senses = db.prepare(`
      SELECT s.id, s.sense_order, s.gloss_key, s.status,
        (SELECT GROUP_CONCAT(l.lang || ':' || SUBSTR(l.term, 1, 20), ' | ') FROM product_localizations l WHERE l.product_sense_id = s.id AND l.needs_review = 0) AS translations
      FROM product_senses s WHERE s.product_entry_id = ? AND s.status = 'accepted' ORDER BY s.sense_order
    `).all(entry.id);
    console.log(JSON.stringify({ found: true, ...entry, senses }, null, 2));
    break;
  }
  case 'quality': {
    // Fast structural quality check (same as release quality gate)
    const mismatches = db.prepare(`
      SELECT COUNT(*) c FROM product_senses s
      JOIN product_entries e ON e.id = s.product_entry_id
      JOIN product_localizations l ON l.product_sense_id = s.id AND l.lang = e.primary_lang
      WHERE s.status = 'accepted' AND l.needs_review = 0 AND TRIM(l.term) != TRIM(e.headword)
    `).get().c;
    const dupes = db.prepare(`
      SELECT COUNT(*) c FROM (
        SELECT e.id, LOWER(TRIM(s.gloss_key)) FROM product_senses s
        JOIN product_entries e ON e.id = s.product_entry_id
        WHERE s.status = 'accepted'
        GROUP BY e.id, LOWER(TRIM(s.gloss_key)) HAVING COUNT(*) > 1
      )
    `).get().c;
    console.log(JSON.stringify({ term_mismatches: mismatches, duplicate_senses: dupes }));
    break;
  }
  default:
    console.error('Usage: node diagnose-dictionary-local.mjs --db <path> [stats|lookup --word <w>|quality]');
    process.exit(1);
}
db.close();

function requiredPath(value, name) {
  const p = path.resolve(value);
  if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
  return p;
}
function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) { result._.push(argv[i]); continue; }
    const next = argv[i + 1];
    result[argv[i].slice(2)] = next && !next.startsWith('--') ? argv[++i] : 'true';
  }
  return result;
}
