import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-native-fallback-'));
const sourceDbPath = path.join(root, 'source.db');
const productDbPath = path.join(root, 'product.db');
const reportPath = path.join(root, 'report.json');
const scriptPath = path.resolve('scripts/align-dictionary-v2-product-source-gap-candidate-senses.mjs');

try {
  createSourceDb(sourceDbPath);
  createProductDb(productDbPath);
  fs.writeFileSync(reportPath, `${JSON.stringify({
    selected: [{
      source_entry_id: 1,
      first_sense_id: 101,
      source_lang: 'zh',
      word: '测试',
      normalized_key: '测试',
      native_source_family: 'cc-cedict',
      frequency_rank: 1
    }]
  }, null, 2)}\n`, 'utf8');

  const disabled = runAlignment(false);
  assert.equal(disabled.selected_count, 0);
  assert.equal(disabled.rejected_count, 1);
  assert.equal(disabled.rejected[0].sense_alignment.reason, 'no_eligible_sense');

  const enabled = runAlignment(true);
  assert.equal(enabled.selected_count, 1);
  assert.equal(enabled.rejected_count, 0);
  assert.equal(
    enabled.selected[0].sense_alignment.policy,
    'authoritative_native_current_sense_fallback'
  );
  assert.equal(enabled.selected[0].first_sense_clean_localization_lang_count, 0);
  console.log(JSON.stringify({ ok: true, tested: ['default_off', 'explicit_authoritative_fallback'] }));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function runAlignment(enabled) {
  const outPath = path.join(root, enabled ? 'enabled.json' : 'disabled.json');
  const rejectedOutPath = path.join(root, enabled ? 'enabled-rejected.json' : 'disabled-rejected.json');
  const result = spawnSync(process.execPath, [
    scriptPath,
    '--report', reportPath,
    '--source-db', sourceDbPath,
    '--product-db', productDbPath,
    '--out', outPath,
    '--rejected-out', rejectedOutPath,
    '--prefer-current-sense', 'true',
    '--allow-native-source-fallback', String(enabled)
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const selected = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const rejected = JSON.parse(fs.readFileSync(rejectedOutPath, 'utf8'));
  return { ...selected, rejected_count: rejected.rejected_count, rejected: rejected.rejected };
}

function createSourceDb(filePath) {
  const db = new Database(filePath);
  db.exec(`
    CREATE TABLE senses (
      id INTEGER PRIMARY KEY, entry_id INTEGER, sense_order INTEGER,
      part_of_speech TEXT, gloss_key TEXT, source TEXT,
      confidence REAL, needs_review INTEGER
    );
    CREATE TABLE sense_localizations (
      id INTEGER PRIMARY KEY, sense_id INTEGER, lang TEXT, term TEXT,
      reading TEXT, reading_system TEXT, pronunciation TEXT,
      pronunciation_system TEXT, definition TEXT, source TEXT,
      confidence REAL, needs_review INTEGER
    );
    CREATE TABLE examples (
      id INTEGER PRIMARY KEY, sense_id INTEGER, example_order INTEGER,
      source_lang TEXT, source_text TEXT, source_reading TEXT,
      source TEXT, confidence REAL, needs_review INTEGER
    );
    CREATE TABLE example_localizations (
      id INTEGER PRIMARY KEY, example_id INTEGER, lang TEXT, text TEXT,
      reading TEXT, source TEXT, confidence REAL, needs_review INTEGER
    );
    INSERT INTO senses VALUES
      (101, 1, 1, 'noun', 'test; examine', 'cc-cedict', 0.95, 0);
  `);
  db.close();
}

function createProductDb(filePath) {
  const db = new Database(filePath);
  db.exec(`
    CREATE TABLE product_senses (id INTEGER PRIMARY KEY, status TEXT);
    CREATE TABLE product_sense_source_links (
      product_sense_id INTEGER, source_sense_id INTEGER
    );
  `);
  db.close();
}
