import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-mainland-'));
const dbPath = path.join(root, 'fixture.db');
const planPath = path.join(root, 'plan.json');
const aliasesPath = path.join(root, 'aliases.json');
const db = new Database(dbPath);
db.exec(`
  CREATE TABLE product_entries (id INTEGER PRIMARY KEY, headword TEXT, normalized_key TEXT, primary_lang TEXT, frequency_rank INTEGER, status TEXT);
  CREATE TABLE product_senses (id INTEGER PRIMARY KEY, product_entry_id INTEGER, status TEXT);
  CREATE TABLE product_localizations (id INTEGER PRIMARY KEY, product_sense_id INTEGER, lang TEXT, term TEXT, definition TEXT, source TEXT, confidence REAL, needs_review INTEGER);
  INSERT INTO product_entries VALUES (1,'春节','春节','zh',1,'accepted'),(2,'春節','春節','zh',2,'accepted'),(3,'徵','徵','zh',3,'accepted');
  INSERT INTO product_senses VALUES (10,1,'accepted'),(20,2,'accepted'),(30,3,'accepted');
  INSERT INTO product_localizations VALUES (100,10,'zh','春節','中國傳統節日','fixture',0.9,0);
  INSERT INTO product_localizations VALUES
    (101,10,'en','festival','festival','fixture',0.9,0),(102,10,'pt-BR','festival','festival','fixture',0.9,0),(103,10,'ja','祭り','祭り','fixture',0.9,0),
    (200,20,'zh','春节','中国传统节日','fixture',0.9,0),(201,20,'en','festival','festival','fixture',0.9,0),(202,20,'pt-BR','festival','festival','fixture',0.9,0),(203,20,'ja','祭り','祭り','fixture',0.9,0),
    (300,30,'zh','征','征召','fixture',0.9,0),(301,30,'en','levy','levy','fixture',0.9,0),(302,30,'pt-BR','recrutar','recrutar','fixture',0.9,0),(303,30,'ja','徴集','徴集','fixture',0.9,0);
`);
db.close();
fs.writeFileSync(aliasesPath, JSON.stringify({ version: 'fixture', aliases: [] }));

run('scripts/create-dictionary-v2-product-mainland-chinese-plan.mjs', ['--db', dbPath, '--out', planPath]);
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
assert.equal(plan.summary.traditional_aliases, 2);
assert.equal(plan.summary.canonical_headword_repairs, 1);
assert.equal(plan.summary.headwords_manual_review, 0);
assert.equal(plan.summary.localization_repairs, 1);
assert.equal(plan.aliases[0].form, '春節');
assert.equal(plan.aliases[0].headword, '春节');
assert.equal(plan.localization_repairs[0].changes.term.after, '春节');

run('scripts/apply-dictionary-v2-product-mainland-chinese-plan.mjs', [
  '--db', dbPath, '--plan', planPath, '--aliases', aliasesPath, '--apply', 'true'
]);
const verified = new Database(dbPath, { readonly: true });
assert.deepEqual(verified.prepare('SELECT term, definition FROM product_localizations WHERE id=100').get(), {
  term: '春节', definition: '中国传统节日'
});
assert.equal(verified.prepare('SELECT headword FROM product_entries WHERE id=3').pluck().get(), '征');
verified.close();
const aliases = JSON.parse(fs.readFileSync(aliasesPath, 'utf8')).aliases;
assert.equal(aliases.length, 2);
assert.equal(aliases[0].form_type, 'traditional_alias');
console.log(JSON.stringify({ ok: true, fixture: root }, null, 2));

function run(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: process.cwd(), encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${script} failed:\n${result.stdout}\n${result.stderr}`);
}
