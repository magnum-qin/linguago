#!/usr/bin/env node

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-recovery-pool-'));
const runs = path.join(root, 'runs');
fs.mkdirSync(runs, { recursive: true });
const dbPath = path.join(root, 'product.db');
const db = new Database(dbPath);
db.exec('CREATE TABLE product_sense_source_links (source_entry_id INTEGER, source_sense_id INTEGER)');
db.prepare('INSERT INTO product_sense_source_links VALUES (?, ?)').run(9, 90);
db.close();

writeRun('old-a', [candidate(1, 10, 'zh')], [], [candidate(1, 10, 'zh')], [{ source_entry_id: 1, source_sense_id: 10, decision: 'unsupported' }], []);
writeRun('old-b', [candidate(2, 20, 'ja')], [], [], [], []);
writeRun('old-c', [candidate(3, 30, 'en')], [candidate(3, 30, 'en')], [candidate(3, 30, 'en')], [{ source_entry_id: 3, source_sense_id: 30, decision: 'supported' }], [{ source_entry_id: 3, source_sense_id: 30, consensus_accepted: true }]);
writeRun('old-linked', [candidate(9, 90, 'pt-BR')], [], [candidate(9, 90, 'pt-BR')], [{ source_entry_id: 9, source_sense_id: 90, decision: 'unsupported' }], []);
const unattempted = path.join(root, 'unattempted.json');
write(unattempted, {
  selected: [
    candidate(6, 60, 'zh'),
    { ...candidate(7, 70, 'pt-BR'), word: 'de' },
  ],
});
const previousRecoveryInput = path.join(root, 'old-recovery.json');
write(previousRecoveryInput, {
  selected: [{ ...candidate(8, 80, 'zh'), candidate_lane: 'additional_sense_recovery' }]
});
const previousRecoveryRun = path.join(runs, 'renamed-recovery-run');
fs.mkdirSync(previousRecoveryRun, { recursive: true });
write(path.join(previousRecoveryRun, 'manifest.json'), { input: 'old-recovery.json' });

const out = path.join(root, 'recovery.json');
const result = spawnSync(process.execPath, [
  path.resolve('scripts/build-dictionary-v2-additional-sense-recovery-pool.mjs'),
  '--root', root, '--runs-root', 'runs', '--product-db', 'product.db', '--out', 'recovery.json',
  '--unattempted-report', 'unattempted.json', '--limit', '10',
], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr || result.stdout);
const report = JSON.parse(fs.readFileSync(out, 'utf8'));
assert.deepEqual(report.selected.map((row) => row.candidate_key).sort(), ['1:10', '2:20', '6:60']);
assert.equal(report.selected[0].recovery_provenance.lane, 'unattempted_authoritative_source_sense');
assert.equal(report.selected.find((row) => row.candidate_key === '1:10').recovery_provenance.lane, 'source_approved_reverse_retry');
assert.equal(report.selected.find((row) => row.candidate_key === '2:20').recovery_provenance.lane, 'source_sense_binding_retry');
assert(!report.selected.some((row) => row.candidate_key === '7:70'), 'very short Latin candidates must be excluded');
assert(!report.selected.some((row) => row.candidate_key === '8:80'), 'previous recovery manifest input must be excluded');
assert.equal(report.policy.exact_source_sense_dedupe, true);
assert.equal(report.policy.reverse_evidence_gate_unchanged, true);
console.log('additional-sense recovery pool checks passed');

function candidate(entry, sense, lang) {
  const source = {
    zh: 'cc-cedict',
    ja: 'jmdict',
    en: 'ecdict',
    'pt-BR': 'freedict-por-eng',
  }[lang];
  return {
    source_entry_id: entry,
    first_sense_id: sense,
    source_lang: lang,
    word: `word-${entry}`,
    frequency_rank: entry,
    daily_sense_selection: { alternatives: [{ id: sense, source }] },
  };
}

function writeRun(name, daily, aligned, approved, validations, finalReviews) {
  const dir = path.join(runs, name);
  fs.mkdirSync(dir, { recursive: true });
  write(path.join(dir, '00a-daily-primary-senses.json'), { selected: daily });
  write(path.join(dir, '00b-source-sense-aligned.json'), { selected: aligned });
  write(path.join(dir, '03-gemma-source-review-approved.json'), { selected: approved });
  write(path.join(dir, '04b-source-consensus-reverse-evidence.json'), { validations });
  write(path.join(dir, '07-final-gemma-accepted.json'), { reviews: finalReviews });
}

function write(file, value) { fs.writeFileSync(file, JSON.stringify(value), 'utf8'); }
