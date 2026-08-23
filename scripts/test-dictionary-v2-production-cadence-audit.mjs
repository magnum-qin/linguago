#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-cadence-audit-'));
try {
  const items = {};
  const generated = [];
  const validations = [];
  const reviews = [];
  const selected = [];
  for (let index = 1; index <= 1200; index += 1) {
    const key = `${index}:${index + 10000}`;
    const row = { source_entry_id: index, source_sense_id: index + 10000 };
    const generatedItem = { ...row, valid: true, errors: [] };
    items[key] = { ...row, status: 'accepted', completed_at: new Date(2026, 0, 1, 0, 0, Math.floor((index - 1) / 50)).toISOString(), generated_item: generatedItem };
    generated.push(generatedItem);
    validations.push({ ...row, decision: 'supported' });
    reviews.push({ ...row, consensus_accepted: true });
    selected.push(row);
  }
  write('05-qwen-generation.checkpoint.json', { config: { chunk_size: 50 }, items });
  write('05-qwen-generation.json', { generated });
  write('06-reverse-evidence.json', { validations });
  write('07-final-gemma.json', { reviews });
  write('08-controlled-replay.json', { selected });

  const script = path.resolve('scripts/audit-dictionary-v2-production-cadence.mjs');
  const ok = spawnSync(process.execPath, [script, '--run-dir', dir], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr || ok.stdout);
  const audit = JSON.parse(fs.readFileSync(path.join(dir, 'production-cadence-audit.json'), 'utf8'));
  assert.equal(audit.ok, true);
  assert.deepEqual(audit.generation_windows.map((window) => window.completed), [500, 500, 200]);
  assert.deepEqual(audit.validation_windows.map((window) => window.completed), [1000, 200]);
  assert.equal(Math.max(...audit.checkpoint_commits.map((commit) => commit.items)), 50);

  items['1201:11201'] = { source_entry_id: 1201, source_sense_id: 11201, status: 'accepted', completed_at: items['1200:11200'].completed_at, generated_item: { source_entry_id: 1201, source_sense_id: 11201, valid: true, errors: [] } };
  generated.push(items['1201:11201'].generated_item);
  write('05-qwen-generation.checkpoint.json', { config: { chunk_size: 50 }, items });
  write('05-qwen-generation.json', { generated });
  const rejected = spawnSync(process.execPath, [script, '--run-dir', dir], { encoding: 'utf8' });
  assert.notEqual(rejected.status, 0);
  console.log('Production cadence audit regression passed.');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

function write(name, value) {
  fs.writeFileSync(path.join(dir, name), `${JSON.stringify(value)}\n`, 'utf8');
}
