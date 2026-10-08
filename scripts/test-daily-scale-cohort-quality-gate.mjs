#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-daily-scale-quality-'));
const inputPath = path.join(root, 'input.json');
const outputPath = path.join(root, 'output.json');
const databasePath = path.join(root, 'product.db');
const database = new Database(databasePath);
database.exec(`
  CREATE TABLE product_entries (id INTEGER PRIMARY KEY, group_key TEXT, status TEXT);
  CREATE TABLE product_senses (id INTEGER PRIMARY KEY, product_entry_id INTEGER, status TEXT, gloss_key TEXT);
  CREATE TABLE product_localizations (product_sense_id INTEGER, lang TEXT, term TEXT, needs_review INTEGER);
`);
database.close();

const candidate = (id, word, gloss, alternatives = []) => ({
  source_entry_id: id,
  first_sense_id: id,
  source_lang: 'ja',
  word,
  frequency_rank: id,
  gloss_key: gloss,
  production_lane: 'new_headword',
  daily_sense_selection: {
    alternatives: [{ id, score: 10, gloss }, ...alternatives]
  },
  reverse_evidence_prefilter: {
    target_coverage_count: 3,
    matching_sources: ['jmdict'],
    match_ratio: 1
  }
});

fs.writeFileSync(inputPath, JSON.stringify({ selected: [
  candidate(100, '値札', 'price tag'),
  candidate(101, 'マーキュリー', 'Mercury (god)'),
  candidate(102, '陸将', 'general', [{ id: 103, score: 9, gloss: 'lieutenant general' }])
] }));

execFileSync(process.execPath, [
  'scripts/select-dictionary-v2-product-daily-scale-cohort.mjs',
  '--report', inputPath,
  '--out', outputPath,
  '--product-db', databasePath,
  '--limit', '3',
  '--zh-quota', '0',
  '--ja-quota', '3',
  '--allow-missing-daily-tier', 'true'
], { cwd: path.resolve('.') });

const report = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
assert.deepEqual(report.selected.map((row) => row.word), ['値札']);
assert.equal(report.summary.rejected_by_reason['daily_quality:named_person_or_deity'], 1);
assert.equal(report.summary.rejected_by_reason['daily_quality:military_rank_deferred'], 1);
console.log('daily scale cohort unified quality gate tests passed');
