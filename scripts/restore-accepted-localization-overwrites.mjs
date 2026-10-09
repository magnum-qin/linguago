#!/usr/bin/env node
// Restores localizations (and sense glosses) of senses that were already
// accepted on the recovery date but whose term/definition were later replaced
// by unreviewed model output. Rows are updated in place from the recovery
// backup; senses that were drafts back then keep their legitimately
// regenerated content. Strictly bounded: only the exact localization ids and
// sense ids enumerated in the regression report are touched.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = parseArgs(process.argv.slice(2));
const targetPath = requiredPath(args['target-db'], 'target-db');
const backupPath = requiredPath(args['backup-db'], 'backup-db');
const reportPath = requiredPath(args.report, 'report');
const outPath = path.resolve(args.out || 'logs/accepted-overwrite-restore.json');
const apply = args.apply === 'true';

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (!report.description || !report.description.includes('already accepted')) {
  throw new Error('Unexpected regression report');
}
const backup = new Database(backupPath, { readonly: true });
backup.pragma('query_only = ON');
const target = new Database(targetPath);
target.pragma('busy_timeout = 30000');
for (const db of [backup, target]) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='product_localizations'").get()) {
    throw new Error('Missing product schema (wrong path?)');
  }
}

const locIds = [...new Set(report.rows.map((r) => r.loc_id))];
const senseIds = [...new Set(report.rows.map((r) => r.sense_id))];
const backupLoc = backup.prepare('SELECT * FROM product_localizations WHERE id = ?');
const backupSense = backup.prepare('SELECT * FROM product_senses WHERE id = ?');
const targetLoc = target.prepare('SELECT * FROM product_localizations WHERE id = ?');
const targetSense = target.prepare('SELECT * FROM product_senses WHERE id = ?');

// Restore CONTENT only: identity (entry binding, sense order, timestamps) must
// stay as-is, otherwise restored historical orders collide with senses added
// after the loss (UNIQUE entry_id+sense_order). Restrict to columns that
// actually exist in this database's schema.
const LOC_CONTENT = ['lang', 'term', 'reading', 'reading_system', 'pronunciation', 'pronunciation_system', 'definition', 'source', 'confidence', 'needs_review'];
const SENSE_CONTENT = ['part_of_speech', 'domain', 'register_label', 'gloss_key', 'status', 'confidence', 'needs_review'];
const tableCols = (db, table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
const locColumns = LOC_CONTENT.filter((c) => tableCols(target, 'product_localizations').has(c));
const senseColumns = SENSE_CONTENT.filter((c) => tableCols(target, 'product_senses').has(c));
const updateLoc = target.prepare(`UPDATE product_localizations SET ${locColumns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`);
const updateSense = target.prepare(`UPDATE product_senses SET ${senseColumns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`);

const stats = { apply, localizations_considered: locIds.length, localizations_restored: 0, localizations_identical: 0, localizations_missing_in_backup: 0, senses_considered: senseIds.length, sense_glosses_restored: 0, sense_glosses_identical: 0 };
const txn = apply ? target.transaction(() => run()) : null;
function run() {
  for (const id of locIds) {
    const before = backupLoc.get(id);
    if (!before) { stats.localizations_missing_in_backup++; continue; }
    const now = targetLoc.get(id);
    if (!now) { stats.localizations_missing_in_backup++; continue; }
    if (locColumns.every((c) => String(now[c] ?? '') === String(before[c] ?? ''))) { stats.localizations_identical++; continue; }
    updateLoc.run(...locColumns.map((c) => before[c] === undefined ? null : before[c]), id);
    stats.localizations_restored++;
  }
  for (const id of senseIds) {
    const before = backupSense.get(id);
    const now = targetSense.get(id);
    if (!before || !now) continue;
    if (senseColumns.every((c) => String(before[c] ?? '') === String(now[c] ?? ''))) { stats.sense_glosses_identical++; continue; }
    updateSense.run(...senseColumns.map((c) => before[c] === undefined ? null : before[c]), id);
    stats.sense_glosses_restored++;
  }
}
if (apply) txn();
const quickCheck = target.prepare('PRAGMA quick_check').get().quick_check;
const output = {
  ok: quickCheck === 'ok',
  applied_at: new Date().toISOString(),
  target_db: targetPath,
  backup_db: backupPath,
  report_sha256: crypto.createHash('sha256').update(fs.readFileSync(reportPath)).digest('hex'),
  stats,
  quick_check: quickCheck,
  note: 'restores reviewed pre-overwrite content for senses accepted before the unreviewed model rewrite; draft-sense regeneration is intentionally untouched'
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output));
backup.close();
target.close();

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
