#!/usr/bin/env node
// Adds CC-CEDICT senses recovered by the versioned-identity staging rebuild
// to the authoritative source DB. Strictly additive: existing rows are never
// touched, recovered senses attach to existing zh entries (lowest id) that
// carry a frequency rank; unresolved words are deferred, never invented.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = parseArgs(process.argv.slice(2));
const dbPath = requiredPath(args.db, 'db');
const reportPath = requiredPath(args.report, 'report');
const outPath = path.resolve(args.out || 'logs/cedict-repair-apply.json');
const apply = args.apply === 'true';

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (report.purpose !== 'cc-cedict homograph identity repair: add senses lost to INSERT-OR-IGNORE collisions') {
  throw new Error('Unexpected repair report purpose');
}
const db = new Database(dbPath);
db.pragma('busy_timeout = 30000');
db.pragma('foreign_keys = ON');
if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='senses'").get()) {
  throw new Error(`Target has no senses table (wrong path?): ${dbPath}`);
}

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const existingPairs = new Set(
  db.prepare("SELECT e.word AS w, s.gloss_key AS g FROM senses s JOIN entries e ON e.id = s.entry_id WHERE s.source LIKE '%cc-cedict%'").all()
    .map((r) => r.w + '|' + norm(r.g))
);
// entries(word) has no index; normalized_key+source_lang does, and for zh
// canonical entries normalized_key equals the word. Try the indexed path
// first and fall back to the word scan only when it misses.
const entryByNormKey = db.prepare("SELECT id, word FROM entries WHERE normalized_key = ? AND source_lang = 'zh' AND frequency_rank IS NOT NULL ORDER BY id LIMIT 1");
const entryByWord = db.prepare("SELECT id FROM entries WHERE word = ? AND source_lang = 'zh' AND frequency_rank IS NOT NULL ORDER BY id LIMIT 1");
const resolveEntry = (word) => {
  const byKey = entryByNormKey.get(word);
  if (byKey && byKey.word === word) return byKey;
  return entryByWord.get(word);
};
const maxOrder = db.prepare('SELECT MAX(sense_order) m FROM senses WHERE entry_id = ?');
const stats = { apply, considered: 0, attached: 0, already_present: 0, deferred_no_entry: 0, entries_touched: 0 };
const attachedByEntry = new Map();
const nextOrderForEntry = new Map();
let nextSenseId = db.prepare('SELECT MAX(id) m FROM senses').get().m + 1;
const now = new Date().toISOString();
const inserts = [];

for (const sense of report.senses) {
  stats.considered++;
  const word = norm(sense.word);
  const gloss = norm(sense.gloss);
  if (existingPairs.has(word + '|' + gloss)) { stats.already_present++; continue; }
  const entry = resolveEntry(word);
  if (!entry) { stats.deferred_no_entry++; continue; }
  if (!nextOrderForEntry.has(entry.id)) {
    nextOrderForEntry.set(entry.id, (maxOrder.get(entry.id).m || 0) + 1);
  }
  const order = nextOrderForEntry.get(entry.id);
  nextOrderForEntry.set(entry.id, order + 1);
  const id = nextSenseId++;
  inserts.push({ id, entry_id: entry.id, sense_order: order, part_of_speech: sense.part_of_speech || null, domain: sense.domain || null, register_label: sense.register_label || null, gloss_key: gloss });
  attachedByEntry.set(entry.id, (attachedByEntry.get(entry.id) || 0) + 1);
  stats.attached++;
  existingPairs.add(word + '|' + gloss);
}
stats.entries_touched = attachedByEntry.size;

const insertSense = db.prepare('INSERT INTO senses (id, entry_id, sense_order, part_of_speech, domain, register_label, gloss_key, source, confidence, needs_review, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
if (apply) {
  const txn = db.transaction(() => {
    for (const row of inserts) {
      insertSense.run(row.id, row.entry_id, row.sense_order, row.part_of_speech, row.domain, row.register_label, row.gloss_key, 'cc-cedict', 0.95, 0, now, now);
    }
  });
  txn();
}
const quickCheck = db.prepare('PRAGMA quick_check').get().quick_check;
const cedictCount = db.prepare("SELECT COUNT(*) c FROM senses WHERE source LIKE '%cc-cedict%'").get().c;
const output = {
  ok: quickCheck === 'ok',
  applied_at: now,
  target_db: dbPath,
  report_sha256: crypto.createHash('sha256').update(fs.readFileSync(reportPath)).digest('hex'),
  stats,
  quick_check: quickCheck,
  cedict_senses_after: cedictCount,
  deferred_note: 'deferred words lack a zh entry with frequency rank; they need a frequency source before becoming scan candidates',
  automatic_publication: false
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output));
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
