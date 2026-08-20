#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-ecdict-bound-'));
const csvPath = path.join(root, 'ecdict.csv');
const reportPath = path.join(root, 'report.json');
const outPath = path.join(root, 'evidence.db');

fs.writeFileSync(
  csvPath,
  'word,translation\nspreader,"n. 撒布机, 散布者"\n',
  'utf8'
);
fs.writeFileSync(
  reportPath,
  `${JSON.stringify({
    validations: [{
      candidate_key: '10:20',
      evidence: { anchor: 'broadcaster; spreader' }
    }]
  })}\n`,
  'utf8'
);

const result = spawnSync(
  process.execPath,
  [
    path.resolve('scripts/export-ecdict-chinese-evidence.mjs'),
    '--csv', csvPath,
    '--validation-report', reportPath,
    '--out', outPath
  ],
  { cwd: process.cwd(), encoding: 'utf8' }
);
assert.equal(result.status, 0, result.stderr || result.stdout);

const db = new Database(outPath, { readonly: true });
const rows = db.prepare(`
  SELECT DISTINCT concept_id
  FROM lexical_evidence
  ORDER BY concept_id
`).all();
const metadata = JSON.parse(
  db.prepare('SELECT metadata_json FROM evidence_sources').get().metadata_json
);
db.close();

assert.deepEqual(rows, [{ concept_id: 'candidate:10:20' }]);
assert.equal(metadata.candidate_bound, true);
assert.equal(metadata.evidence_strength, 'exact_reciprocal_candidate_bound');
console.log('ECDICT candidate-bound evidence test passed');
