import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-release-cohort-'));
const dbPath = path.join(root, 'fixture.db');
const baselinePath = path.join(root, 'baseline.json');
const outPath = path.join(root, 'report.json');
const db = new Database(dbPath);
db.exec(`
  CREATE TABLE product_entries (id INTEGER PRIMARY KEY);
  CREATE TABLE product_senses (id INTEGER PRIMARY KEY, product_entry_id INTEGER, status TEXT);
  CREATE TABLE product_sense_publication_blocks (product_sense_id INTEGER);
  CREATE TABLE product_localizations (id INTEGER PRIMARY KEY, product_sense_id INTEGER, needs_review INTEGER);
  CREATE TABLE product_examples (id INTEGER PRIMARY KEY, product_sense_id INTEGER);
  CREATE TABLE product_example_localizations (id INTEGER PRIMARY KEY, product_example_id INTEGER);
  INSERT INTO product_entries VALUES (1), (2), (3);
  INSERT INTO product_senses VALUES (1,1,'accepted'), (2,2,'accepted'), (3,3,'draft');
  INSERT INTO product_sense_publication_blocks VALUES (2);
  INSERT INTO product_localizations VALUES (1,1,0), (2,1,0), (3,2,0), (4,3,0);
  INSERT INTO product_examples VALUES (1,1), (2,2);
  INSERT INTO product_example_localizations VALUES (1,1), (2,1), (3,2);
`);
db.close();
fs.writeFileSync(
  baselinePath,
  JSON.stringify({ release: 'fixture', counts: { entries: 0, senses: 0, sense_localizations: 0, examples: 0, example_localizations: 0 }, release_threshold_new_senses: 1 })
);

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'report-dictionary-v2-release-cohort.mjs');
const run = spawnSync(process.execPath, [script, '--db', dbPath, '--baseline', baselinePath, '--out', outPath], {
  encoding: 'utf8'
});
if (run.status !== 0) throw new Error(run.stderr || run.stdout);
const report = JSON.parse(fs.readFileSync(outPath, 'utf8'));
const expected = { entries: 1, senses: 1, sense_localizations: 2, examples: 1, example_localizations: 2 };
for (const [key, value] of Object.entries(expected)) {
  if (report.current[key] !== value) throw new Error(`${key}: expected ${value}, got ${report.current[key]}`);
}
if (!report.ok || report.status !== 'ready' || !report.release_ready || report.remaining_senses !== 0) {
  throw new Error('release threshold result is wrong');
}
console.log(JSON.stringify({ ok: true, current: report.current }));
