#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-attempt-index-'));
const runs = path.join(root, 'runs');
fs.mkdirSync(path.join(runs, 'daily'), { recursive: true });
write(path.join(runs, 'daily', '00a-daily-primary-senses.json'), {
  selected: [{ source_entry_id: 1, first_sense_id: 10 }],
});

const recoveryBatch = path.join(root, 'recovery.json');
write(recoveryBatch, {
  selected: [
    { source_entry_id: 2, first_sense_id: 20, candidate_lane: 'additional_sense_recovery' },
    { source_entry_id: 3, first_sense_id: 30, candidate_lane: 'other' },
  ],
});
fs.mkdirSync(path.join(runs, 'recovery'), { recursive: true });
write(path.join(runs, 'recovery', 'manifest.json'), { input: 'recovery.json' });

const result = spawnSync(process.execPath, [
  path.resolve('scripts/build-dictionary-v2-additional-sense-attempt-index.mjs'),
  '--root', root,
  '--runs-root', 'runs',
  '--out', 'attempts.json',
], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr || result.stdout);
const report = JSON.parse(fs.readFileSync(path.join(root, 'attempts.json'), 'utf8'));
assert.deepEqual(report.selected, [
  { source_entry_id: 1, source_sense_id: 10 },
  { source_entry_id: 2, source_sense_id: 20 },
]);
console.log('additional-sense attempt index checks passed');

function write(file, value) {
  fs.writeFileSync(file, JSON.stringify(value), 'utf8');
}
