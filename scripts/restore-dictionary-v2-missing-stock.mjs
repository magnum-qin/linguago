#!/usr/bin/env node
// Deterministically re-adds stock entries (and all child rows) that exist in a
// recovery backup but are missing from the live product DB. Rows keep their
// original ids when free; id collisions (rows inserted after the loss reused
// ids) are remapped to fresh ids with foreign keys rewritten. Everything runs
// in one transaction; --dry-run reports the plan without writing.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const targetPath = requiredPath(args['target-db'], 'target-db');
const sourcePath = requiredPath(args['source-db'], 'source-db');
const outPath = path.resolve(args.out || 'logs/stock-restore-report.json');
const apply = args.apply === 'true';

const SENSE_CHILDREN = [
  { table: 'product_localizations', fk: 'product_sense_id', hasId: true },
  { table: 'product_sense_source_links', fk: 'product_sense_id', hasId: true },
  { table: 'product_examples', fk: 'product_sense_id', hasId: true },
  { table: 'product_sense_verification', fk: 'product_sense_id', hasId: false },
  { table: 'product_sense_publication_blocks', fk: 'product_sense_id', hasId: true },
  { table: 'product_fusion_reviews', fk: 'product_sense_id', hasId: true, entryFk: 'product_entry_id' },
  { table: 'product_fusion_split_plans', fk: 'product_sense_id', hasId: true, entryFk: 'product_entry_id' }
];

const source = new Database(sourcePath, { readonly: true });
source.pragma('query_only = ON');
const target = new Database(targetPath);
target.pragma('busy_timeout = 30000');
target.pragma('foreign_keys = ON');

// Guard against typo'd paths: better-sqlite3 silently creates empty files, and
// a wrong --target-db would otherwise report a clean-looking zero-copy run.
for (const [db, label] of [[source, 'source'], [target, 'target']]) {
  const hasSchema = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='product_entries'").get();
  if (!hasSchema) throw new Error(`${label} db has no product_entries table (wrong path?): ${label === 'source' ? sourcePath : targetPath}`);
}

const colsOf = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
const entryCols = colsOf(target, 'product_entries');
const senseCols = colsOf(target, 'product_senses');
const childCols = Object.fromEntries(SENSE_CHILDREN.map(({ table }) => [table, colsOf(target, table)]));
const exampleLocCols = colsOf(target, 'product_example_localizations');

const targetEntry = target.prepare('SELECT id, created_at FROM product_entries WHERE id = ?');
const targetSense = target.prepare('SELECT id FROM product_senses WHERE id = ?');
const sourceEntries = source.prepare('SELECT * FROM product_entries ORDER BY id');
const sourceSenses = source.prepare('SELECT * FROM product_senses WHERE product_entry_id = ? ORDER BY id');
const sourceChildren = Object.fromEntries(
  SENSE_CHILDREN.map(({ table, fk }) => [table, source.prepare(`SELECT * FROM ${table} WHERE ${fk} = ?`)])
);
const sourceJobsByLocalization = source.prepare("SELECT * FROM product_llm_completion_jobs WHERE target_type = 'product_sense_localization' AND target_id = ?");
const sourceExampleLocs = source.prepare('SELECT * FROM product_example_localizations WHERE product_example_id = ?');
const sourceEntryCreatedAt = new Map(source.prepare('SELECT id, created_at FROM product_entries').all().map((r) => [r.id, r.created_at]));
// Idempotency fingerprints: a re-run must recognize rows already restored
// under remapped ids instead of copying them a second time.
const restoredEntryFingerprint = new Set(
  target.prepare('SELECT headword, primary_lang, created_at FROM product_entries').all().map((r) => `${r.headword}|${r.primary_lang}|${r.created_at}`)
);
const restoredSenseFingerprint = new Set(
  target.prepare('SELECT e.created_at AS entry_created, s.gloss_key, s.created_at AS sense_created FROM product_senses s JOIN product_entries e ON e.id = s.product_entry_id').all().map((r) => `${r.entry_created}|${r.gloss_key}|${r.sense_created}`)
);

const stats = { apply, entries_present: 0, entries_copied: 0, entries_remapped: 0, senses_copied: 0, senses_remapped: 0, children_copied: 0, children_remapped: 0 };
const remaps = { entries: [], senses: [], children: [] };
// Allocate remapped ids above BOTH databases' maxima: kept source ids can
// exceed the target's max, so target-max-based counters would collide with
// rows kept later in the same transaction.
const maxId = (db, table) => db.prepare(`SELECT MAX(id) m FROM ${table}`).get().m || 0;
let nextEntryId = Math.max(maxId(target, 'product_entries'), maxId(source, 'product_entries')) + 1;
let nextSenseId = Math.max(maxId(target, 'product_senses'), maxId(source, 'product_senses')) + 1;
const childNextId = Object.fromEntries(
  SENSE_CHILDREN.filter(({ hasId }) => hasId).map(({ table }) => [table, Math.max(maxId(target, table), maxId(source, table)) + 1])
);
let exampleLocNextId = Math.max(maxId(target, 'product_example_localizations'), maxId(source, 'product_example_localizations')) + 1;
const jobCols = colsOf(target, 'product_llm_completion_jobs');
let jobNextId = Math.max(maxId(target, 'product_llm_completion_jobs'), maxId(source, 'product_llm_completion_jobs')) + 1;

const insertRow = (table, cols, row) => {
  const placeholders = cols.map(() => '?').join(',');
  target.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`).run(...cols.map((c) => row[c] === undefined ? null : row[c]));
};

// group_key is UNIQUE per pinyin/reading key; restored entries can collide
// with DIFFERENT words the campaign later created under the same key
// (e.g. 处子 vs 出资 both "source-gap:zh:chuzi"). Suffixed keys keep both.
const usedGroupKeys = new Set(target.prepare('SELECT group_key FROM product_entries').pluck().all());
const groupKeyRemaps = [];

const txn = apply ? target.transaction(() => run()) : null;
function run() {
  for (const entry of sourceEntries.iterate()) {
    const existing = targetEntry.get(entry.id);
    if (existing && existing.created_at === entry.created_at) { stats.entries_present++; continue; }
    if (restoredEntryFingerprint.has(`${entry.headword}|${entry.primary_lang}|${entry.created_at}`)) { stats.entries_present++; continue; }
    let entryId = entry.id;
    if (existing) {
      entryId = nextEntryId++;
      stats.entries_remapped++;
      remaps.entries.push({ source_id: entry.id, new_id: entryId, headword: entry.headword, reason: 'id_reused_by_newer_row' });
    }
    insertRow('product_entries', entryCols, (() => {
      const row = { ...entry, id: entryId };
      if (row.group_key && usedGroupKeys.has(row.group_key)) {
        const original = row.group_key;
        row.group_key = `${original}-restored-${entry.id}`;
        groupKeyRemaps.push({ entry_id: entryId, headword: entry.headword, original_group_key: original, new_group_key: row.group_key });
        stats.group_key_suffixed = (stats.group_key_suffixed || 0) + 1;
      }
      if (row.group_key) usedGroupKeys.add(row.group_key);
      return row;
    })());
    stats.entries_copied++;

    for (const sense of sourceSenses.all(entry.id)) copySense(sense, entryId);
  }

  // Second pass: the loss also stripped senses from entries that survived
  // (their ids+created_at matched, so the loop above skipped them). Restore
  // those senses and their children onto the surviving entry ids.
  for (const sense of source.prepare('SELECT * FROM product_senses ORDER BY id').iterate()) {
    if (targetSense.get(sense.id)) continue;
    const surviving = targetEntry.get(sense.product_entry_id);
    const sourceEntryCreated = sourceEntryCreatedAt.get(sense.product_entry_id);
    if (surviving && sourceEntryCreated === surviving.created_at) {
      if (restoredSenseFingerprint.has(`${sourceEntryCreated}|${sense.gloss_key}|${sense.created_at}`)) continue;
      stats.orphan_senses_on_survivors = (stats.orphan_senses_on_survivors || 0) + 1;
      copySense(sense, sense.product_entry_id);
    }
  }
}

function copySense(sense, entryId) {
  const senseExists = targetSense.get(sense.id);
  let senseId = sense.id;
  if (senseExists) {
    senseId = nextSenseId++;
    stats.senses_remapped++;
    remaps.senses.push({ source_id: sense.id, new_id: senseId, gloss: String(sense.gloss_key || '').slice(0, 60) });
  }
  // (entry_id, sense_order) is UNIQUE: on surviving entries the original slot
  // can be taken by a sense added after the loss; append after the last order.
  const orderTaken = target.prepare('SELECT 1 FROM product_senses WHERE product_entry_id = ? AND sense_order = ?').get(entryId, sense.sense_order);
  const nextOrder = orderTaken ? (target.prepare('SELECT MAX(sense_order) m FROM product_senses WHERE product_entry_id = ?').get(entryId).m || 0) + 1 : sense.sense_order;
  if (nextOrder !== sense.sense_order) stats.sense_order_shifted = (stats.sense_order_shifted || 0) + 1;
  insertRow('product_senses', senseCols, { ...sense, id: senseId, product_entry_id: entryId, sense_order: nextOrder });
  stats.senses_copied++;

  for (const { table, fk, hasId, entryFk } of SENSE_CHILDREN) {
    const cols = childCols[table];
    for (const row of sourceChildren[table].all(sense.id)) {
      let out = { ...row, [fk]: senseId };
      if (entryFk && entryFk in out) out[entryFk] = entryId;
      if (hasId && target.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(row.id)) {
        out = { ...out, id: childNextId[table]++ };
        stats.children_remapped++;
        remaps.children.push({ table, source_id: row.id });
      }
      insertRow(table, cols, out);
      stats.children_copied++;
      if (table === 'product_examples') {
        for (const loc of sourceExampleLocs.all(row.id)) {
          let locOut = { ...loc, product_example_id: out.id };
          if (loc.id && target.prepare('SELECT 1 FROM product_example_localizations WHERE id = ?').get(loc.id)) {
            locOut = { ...locOut, id: exampleLocNextId++ };
          }
          insertRow('product_example_localizations', exampleLocCols, locOut);
          stats.children_copied++;
        }
      }
      if (table === 'product_localizations') {
        for (const job of sourceJobsByLocalization.all(row.id)) {
          let jobOut = { ...job, target_id: out.id };
          if (target.prepare('SELECT 1 FROM product_llm_completion_jobs WHERE id = ?').get(job.id)) {
            jobOut = { ...jobOut, id: jobNextId++ };
            stats.children_remapped++;
          }
          insertRow('product_llm_completion_jobs', jobCols, jobOut);
          stats.children_copied++;
        }
      }
    }
  }
}

const plan = { started_at: new Date().toISOString(), source_db: sourcePath, target_db: targetPath };
if (apply) {
  txn();
  const fkViolations = target.prepare('PRAGMA foreign_key_check').all();
  const quickCheck = target.prepare('PRAGMA quick_check').get();
  const counts = {};
  for (const t of ['product_entries', 'product_senses', 'product_localizations', 'product_sense_source_links', 'product_examples', 'product_example_localizations']) {
    counts[t] = target.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  }
  Object.assign(plan, { ok: fkViolations.length === 0 && quickCheck.quick_check === 'ok', stats, counts, foreign_key_violations: fkViolations.length, quick_check: quickCheck.quick_check, remaps_summary: { entries: remaps.entries.length, senses: remaps.senses.length, children: remaps.children.length } });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ ...plan, remaps }, null, 2) + '\n');
  console.log(JSON.stringify(plan));
} else {
  // Dry run: simulate id allocation without inserting.
  const dry = { ...stats };
  const dryTargetIds = new Set(target.prepare('SELECT id FROM product_entries').pluck().all());
  const drySenseIds = new Set(target.prepare('SELECT id FROM product_senses').pluck().all());
  let entriesToCopy = 0, entriesToRemap = 0, sensesToCopy = 0;
  for (const entry of sourceEntries.iterate()) {
    if (dryTargetIds.has(entry.id)) {
      const cur = targetEntry.get(entry.id);
      if (cur && cur.created_at === entry.created_at) { dry.entries_present++; continue; }
      entriesToRemap++;
    }
    entriesToCopy++;
    for (const sense of sourceSenses.all(entry.id)) { sensesToCopy++; if (drySenseIds.has(sense.id)) dry.senses_remapped++; }
  }
  dry.entries_copied = entriesToCopy; dry.entries_remapped = entriesToRemap; dry.senses_copied = sensesToCopy;
  console.log(JSON.stringify({ ok: true, dry_run: true, stats: dry }));
}
source.close();
if (apply) target.close(); else target.close();

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
