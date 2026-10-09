#!/usr/bin/env node
// Directly imports basic vocabulary entries into the product DB with
// four-language translations. Designed for essential survival words that
// the production pipeline's historical exclusions have blocked.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const prodPath = requiredPath(args['product-db'], 'product-db');
const srcPath = requiredPath(args['source-db'], 'source-db');
const transPath = requiredPath(args.translations, 'translations');
const lang = args.lang || 'pt-BR';
const outPath = path.resolve(args.out || 'logs/basic-vocab-import.json');
const apply = args.apply === 'true';

const translations = JSON.parse(fs.readFileSync(transPath, 'utf8'));
const src = new Database(srcPath, { readonly: true });
src.pragma('query_only = ON');
const prod = new Database(prodPath);
prod.pragma('busy_timeout = 30000');
prod.pragma('foreign_keys = ON');

const stats = { apply, lang, processed: 0, imported: 0, skipped: 0, no_translation: 0 };
const now = new Date().toISOString();

const insertEntry = prod.prepare("INSERT INTO product_entries (headword, normalized_key, primary_lang, frequency_rank, group_key, group_method, status, source_count, lang_count, created_at) VALUES (?, ?, ?, ?, ?, 'basic_vocab_recovery', 'accepted', 1, 4, ?)");
const insertSense = prod.prepare("INSERT INTO product_senses (product_entry_id, sense_order, gloss_key, status, confidence, created_at) VALUES (?, 1, ?, 'accepted', 0.95, ?)");
const insertLoc = prod.prepare("INSERT INTO product_localizations (product_sense_id, lang, term, definition, source, confidence, needs_review) VALUES (?, ?, ?, ?, 'basic_vocab_recovery', 0.95, 0)");

// Find source entry for linking (optional)
const findSrc = src.prepare("SELECT id FROM entries WHERE word = ? AND source_lang = ? ORDER BY id LIMIT 1");
const findSrcSense = src.prepare("SELECT id FROM senses WHERE entry_id = ? AND needs_review = 0 ORDER BY sense_order LIMIT 1");
const insertLink = prod.prepare("INSERT INTO product_sense_source_links (product_sense_id, source_entry_id, source_sense_id, source_lang, source_word, match_method, confidence) VALUES (?, ?, ?, ?, ?, 'basic_vocab_direct_import', 0.95)");

const txn = apply ? prod.transaction(() => run()) : null;
function run() {
  for (const [word, t] of Object.entries(translations)) {
    stats.processed++;
    const existing = prod.prepare("SELECT id FROM product_entries WHERE headword = ? AND primary_lang = ? AND status = 'accepted'").get(word, lang);
    if (existing) { stats.skipped++; continue; }
    if (!t.en || !t.zh || !t.ja) { stats.no_translation++; continue; }
    const srcEntry = findSrc.get(word, lang);
    const srcSense = srcEntry ? findSrcSense.get(srcEntry.id) : null;
    const info = insertEntry.run(word, word.toLowerCase(), lang, srcEntry?.frequency_rank || 100, 'basic-' + lang + ':' + word, now);
    const entryId = Number(info.lastInsertRowid);
    const senseInfo = insertSense.run(entryId, t.en, now);
    const senseId = Number(senseInfo.lastInsertRowid);
    insertLoc.run(senseId, lang, word, t.en);
    insertLoc.run(senseId, 'en', t.en, t.en);
    insertLoc.run(senseId, 'zh', t.zh, t.en);
    insertLoc.run(senseId, 'ja', t.ja, t.en);
    if (srcEntry && srcSense) {
      insertLink.run(senseId, srcEntry.id, srcSense.id, lang, word);
    }
    stats.imported++;
  }
}
if (apply) txn();

const output = { ...stats, quick_check: prod.prepare('PRAGMA quick_check').get().quick_check, applied_at: now };
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output));
src.close(); prod.close();

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
