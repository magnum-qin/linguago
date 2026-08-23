#!/usr/bin/env node

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-additional-sense-'));
const sourceDbPath = path.join(directory, 'source.db');
const productDbPath = path.join(directory, 'product.db');
const reportPath = path.join(directory, 'report.json');

createSourceDb(sourceDbPath);
createProductDb(productDbPath);
fs.writeFileSync(reportPath, JSON.stringify({ selected: [{
  source_entry_id: 1,
  source_lang: 'zh',
  word: '中',
  normalized_key: '中',
  frequency_rank: 10
}] }));

const ordinary = runSelector(false, 'ordinary');
assert.equal(ordinary.selected.length, 0);
assert.equal(ordinary.rejected[0].reason, 'primary_native_sense_already_linked_use_entry_form_alias');

const additional = runSelector(true, 'additional');
assert.equal(additional.selected.length, 1);
assert.equal(additional.selected[0].first_sense_id, 102);
assert.equal(
  additional.selected[0].daily_sense_selection.policy,
  'native_dictionary_additional_unlinked_sense'
);
assert.equal(additional.selected[0].daily_sense_selection.alternatives[0].id, 102);
assert.equal(additional.selected[0].daily_sense_selection.alternatives[1].id, 101);
assert.equal(additional.selected[0].daily_sense_selection.alternatives[1].linked_product_sense.id, 201);
testCandidateBuilder();
testScaleCohortAllowsExistingQueryable();
testControlledConsensusAcceptsLockedAdditionalSense();
console.log('additional sense selection tests passed');

function testControlledConsensusAcceptsLockedAdditionalSense() {
  const reviewPath = path.join(directory, 'additional-review.json');
  const outPath = path.join(directory, 'additional-controlled.json');
  const terms = { en: 'hit', 'pt-BR': 'acertar', zh: '中', ja: '当たる' };
  const definitions = { en: 'To strike a target.', 'pt-BR': 'Atingir um alvo.', zh: '击中目标。', ja: '目標に命中する。' };
  fs.writeFileSync(reviewPath, JSON.stringify({ selected: [{
    source_entry_id: 1,
    first_sense_id: 102,
    product_entry_id: 301,
    candidate_key: '1:102',
    source_lang: 'zh',
    word: '中',
    daily_sense_selection: {
      policy: 'native_dictionary_additional_unlinked_sense',
      requires_independent_source_review: true,
      alternatives: [{ id: 102, source: 'cc-cedict', blocked_reason: null, linked_product_sense: null }]
    },
    candidate_evidence_review: {
      decision: 'accept', confidence: 0.98, risk_flags: [],
      preferred_terms: { zh: '中' }, suggested_terms: terms, definition_contract: definitions
    }
  }] }));
  const result = spawnSync(process.execPath, [
    'scripts/build-dictionary-v2-product-source-gap-controlled-consensus-input.mjs',
    '--review', reviewPath,
    '--out', outPath,
    '--confidence-threshold', '0.9',
    '--allow-unhinted-suggestions', 'true'
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(output.selected.length, 1);
  assert.equal(output.selected[0].first_sense_id, 102);
}

function testScaleCohortAllowsExistingQueryable() {
  const inputPath = path.join(directory, 'scale-input.json');
  const defaultOut = path.join(directory, 'scale-default.json');
  const additionalOut = path.join(directory, 'scale-additional.json');
  fs.writeFileSync(inputPath, JSON.stringify({
    product_db: productDbPath,
    selected: [{
      source_entry_id: 1,
      source_sense_id: 102,
      source_lang: 'zh',
      word: '中',
      frequency_rank: 10,
      daily_tier: 'core',
      daily_priority: 100,
      daily_sense_selection: { selected: { gloss: 'to hit; to win' } },
      reverse_evidence_prefilter: { target_coverage_count: 3, matching_sources: [] }
    }]
  }));
  for (const [outPath, allow] of [[defaultOut, false], [additionalOut, true]]) {
    const result = spawnSync(process.execPath, [
      'scripts/select-dictionary-v2-product-daily-scale-cohort.mjs',
      '--report', inputPath,
      '--product-db', productDbPath,
      '--out', outPath,
      '--limit', '1',
      '--zh-quota', '1',
      '--minimum-target-coverage', '0',
      '--allow-existing-queryable', String(allow),
      '--allow-missing-daily-tier', 'true'
    ], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  assert.equal(JSON.parse(fs.readFileSync(defaultOut, 'utf8')).selected.length, 0);
  assert.equal(JSON.parse(fs.readFileSync(additionalOut, 'utf8')).selected.length, 1);
}

function testCandidateBuilder() {
  const outPath = path.join(directory, 'builder.json');
  const result = spawnSync(process.execPath, [
    'scripts/find-dictionary-v2-product-additional-sense-entries.mjs',
    '--source-db', sourceDbPath,
    '--product-db', productDbPath,
    '--out', outPath
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(report.selected.length, 1);
  assert.equal(report.selected[0].source_entry_id, 1);
  assert.equal(report.selected[0].product_entry_id, 301);
  assert.equal(report.selected[0].candidate_lane, 'additional_unlinked_source_sense');
  assert.equal(report.summary.skipped_unmatched_product_entry, 0);
}

function runSelector(additional, prefix) {
  const outPath = path.join(directory, `${prefix}-out.json`);
  const rejectedPath = path.join(directory, `${prefix}-rejected.json`);
  const result = spawnSync(process.execPath, [
    'scripts/select-dictionary-v2-product-daily-primary-senses.mjs',
    '--report', reportPath,
    '--source-db', sourceDbPath,
    '--product-db', productDbPath,
    '--out', outPath,
    '--rejected-out', rejectedPath,
    '--require-native-source', 'true',
    '--allow-linked-primary-for-additional-sense', String(additional)
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return {
    selected: JSON.parse(fs.readFileSync(outPath, 'utf8')).selected,
    rejected: JSON.parse(fs.readFileSync(rejectedPath, 'utf8')).rejected
  };
}

function createSourceDb(filePath) {
  const db = new Database(filePath);
  db.exec(`
    CREATE TABLE senses (
      id INTEGER PRIMARY KEY, entry_id INTEGER, sense_order INTEGER,
      part_of_speech TEXT, gloss_key TEXT, source TEXT,
      confidence REAL, needs_review INTEGER
    );
    CREATE TABLE entries (
      id INTEGER PRIMARY KEY, word TEXT, normalized_key TEXT, source_lang TEXT,
      frequency_rank INTEGER, status TEXT
    );
    CREATE TABLE sense_localizations (
      id INTEGER PRIMARY KEY, sense_id INTEGER, lang TEXT, term TEXT,
      reading TEXT, reading_system TEXT, pronunciation TEXT,
      pronunciation_system TEXT, definition TEXT, source TEXT,
      confidence REAL, needs_review INTEGER
    );
  `);
  db.exec("INSERT INTO entries VALUES (1, '中', '中', 'zh', 10, 'accepted')");
  db.prepare('INSERT INTO senses VALUES (?, 1, ?, ?, ?, ?, 1, 0)').run(101, 1, 'noun', 'middle; center', 'cc-cedict');
  db.prepare('INSERT INTO senses VALUES (?, 1, ?, ?, ?, ?, 1, 0)').run(102, 2, 'verb', 'to hit; to win', 'cc-cedict');
  const insertLoc = db.prepare('INSERT INTO sense_localizations VALUES (NULL, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, 1, 0)');
  for (const senseId of [101, 102]) {
    insertLoc.run(senseId, 'zh', '中', senseId === 101 ? '中间' : '击中', 'cc-cedict');
    insertLoc.run(senseId, 'en', senseId === 101 ? 'middle' : 'hit', senseId === 101 ? 'The center.' : 'To strike a target.', 'cc-cedict');
  }
  db.close();
}

function createProductDb(filePath) {
  const db = new Database(filePath);
  db.exec(`
    CREATE TABLE product_entries (
      id INTEGER PRIMARY KEY, headword TEXT, normalized_key TEXT,
      primary_lang TEXT, status TEXT
    );
    CREATE TABLE product_senses (id INTEGER PRIMARY KEY, product_entry_id INTEGER, status TEXT);
    CREATE TABLE product_localizations (
      id INTEGER PRIMARY KEY, product_sense_id INTEGER, lang TEXT,
      term TEXT, needs_review INTEGER
    );
    CREATE TABLE product_sense_source_links (
      id INTEGER PRIMARY KEY, product_sense_id INTEGER, source_entry_id INTEGER,
      source_sense_id INTEGER
    );
    INSERT INTO product_entries VALUES (88, 'for', 'for', 'en', 'accepted');
    INSERT INTO product_entries VALUES (301, '中', '中', 'zh', 'accepted');
    INSERT INTO product_senses VALUES (88, 88, 'accepted');
    INSERT INTO product_senses VALUES (201, 301, 'accepted');
    INSERT INTO product_localizations VALUES (1, 88, 'en', 'for', 0);
    INSERT INTO product_localizations VALUES (2, 201, 'zh', '中', 0);
    INSERT INTO product_sense_source_links VALUES (1, 88, 1, 999);
    INSERT INTO product_sense_source_links VALUES (2, 201, 1, 101);
  `);
  db.close();
}
