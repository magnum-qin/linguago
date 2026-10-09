#!/usr/bin/env node
// Assigns frequency ranks to CC-CEDICT repair words that lack them by
// interpolating from the staging DB's ordering. Existing entries only get
// their NULL rank filled; brand-new entries are created with auto-increment
// IDs and their deferred senses attached with per-entry sequential orders.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = parseArgs(process.argv.slice(2));
const sourceDbPath = requiredPath(args['source-db'], 'source-db');
const stagingPath = requiredPath(args.staging, 'staging');
const reportPath = requiredPath(args.report, 'report');
const outPath = path.resolve(args.out || 'logs/deferred-frequency-assignment.json');
const apply = args.apply === 'true';

const staging = new Database(stagingPath, { readonly: true });
staging.pragma('query_only = ON');
const source = new Database(sourceDbPath);
source.pragma('busy_timeout = 30000');
source.pragma('foreign_keys = ON');

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const deferredWords = [...new Set(report.senses.map((s) => s.word.trim()))];

const stagingEntries = staging.prepare('SELECT id, word FROM source_entries ORDER BY id').all();
const stagingPos = new Map(stagingEntries.map((e, i) => [e.word.trim(), i + 1]));
const ranked = source.prepare("SELECT word, frequency_rank FROM entries WHERE source_lang='zh' AND frequency_rank IS NOT NULL").all();
const rankedByPos = [];
for (const r of ranked) {
  const pos = stagingPos.get(r.word.trim());
  if (pos != null) rankedByPos.push({ pos, rank: r.frequency_rank });
}
rankedByPos.sort((a, b) => a.pos - b.pos);

function interpolateRank(word) {
  const pos = stagingPos.get(word);
  if (pos == null) return null;
  let lo = 0, hi = rankedByPos.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rankedByPos[mid].pos < pos) lo = mid + 1; else hi = mid;
  }
  const n = rankedByPos[lo];
  return n ? n.rank : null;
}

const stats = { apply, deferred_checked: 0, rank_assigned: 0, entry_created: 0, no_staging_match: 0, already_ranked: 0 };
const assignments = [];
const now = new Date().toISOString();

const findEntry = source.prepare("SELECT id, frequency_rank FROM entries WHERE (word = ? OR normalized_key = ?) AND source_lang = 'zh' ORDER BY id LIMIT 1");
const maxOrder = source.prepare('SELECT MAX(sense_order) m FROM senses WHERE entry_id = ?');
const insertEntry = source.prepare("INSERT INTO entries (word, normalized_key, source_lang, frequency_rank, status, created_at, updated_at) VALUES (?, ?, 'zh', ?, 'active', ?, ?)");
const insertSense = source.prepare("INSERT INTO senses (entry_id, sense_order, part_of_speech, domain, register_label, gloss_key, source, confidence, needs_review, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'cc-cedict', 0.95, 0, ?, ?)");

function run() {
  for (const word of deferredWords) {
    stats.deferred_checked++;
    const rank = interpolateRank(word);
    if (rank == null) { stats.no_staging_match++; continue; }
    try {
      const existing = findEntry.get(word, word);
      if (existing) {
        if (existing.frequency_rank != null) { stats.already_ranked++; continue; }
        source.prepare('UPDATE entries SET frequency_rank = ?, updated_at = ? WHERE id = ?').run(rank, now, existing.id);
        stats.rank_assigned++;
        assignments.push({ word, entry_id: existing.id, rank, action: 'rank_filled' });
      } else {
        const info = insertEntry.run(word, word, rank, now, now);
        const entryId = Number(info.lastInsertRowid);
        const senses = report.senses.filter((s) => s.word.trim() === word);
        let order = 1;
        for (const s of senses) {
          insertSense.run(entryId, order++, s.part_of_speech || null, null, null, s.gloss, now, now);
        }
        stats.entry_created++;
        assignments.push({ word, entry_id: entryId, rank, action: 'entry_created', senses_attached: senses.length });
      }
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        console.error('UNIQUE violation on word=' + JSON.stringify(word) + ' rank=' + rank + ': ' + e.message);
      }
      throw e;
    }
  }
}

if (apply) {
  const txn = source.transaction(() => run());
  txn();
} else {
  // Dry-run still scans to report what would happen; no writes occur
  // because apply=false and we only count.
  for (const word of deferredWords) {
    stats.deferred_checked++;
    const rank = interpolateRank(word);
    if (rank == null) { stats.no_staging_match++; continue; }
    const existing = findEntry.get(word, word);
    if (existing && existing.frequency_rank != null) stats.already_ranked++;
    else if (existing) stats.rank_assigned++;
    else stats.entry_created++;
  }
}
const output = {
  ok: source.prepare('PRAGMA quick_check').get().quick_check === 'ok',
  applied_at: now,
  stats,
  quick_check: source.prepare('PRAGMA quick_check').get().quick_check,
  automatic_publication: false
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ ...output, assignments }, null, 2) + '\n');
console.log(JSON.stringify(output));
staging.close();
source.close();

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
