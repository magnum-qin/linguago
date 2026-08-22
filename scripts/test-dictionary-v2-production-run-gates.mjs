#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-production-gates-'));
try {
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ run_id: 'test', summary: { input: 500, jmdict_generation_ready: 42, generated_valid: 42, reverse_supported: 42, final_accepted: 42, final_rejected: 0, automatic_database_writes: 0 } }));
  fs.writeFileSync(path.join(dir, '05-qwen-generation.json'), JSON.stringify({ stats: { generated: 42, infrastructure_rejected: 0 }, generated: Array.from({ length: 42 }, () => ({ valid: true, errors: [] })) }));
  const result = spawnSync(process.execPath, [path.resolve('scripts/check-dictionary-v2-production-run-gates.mjs'), '--run-dir', dir], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const gate = JSON.parse(fs.readFileSync(path.join(dir, 'production-gate.json'), 'utf8'));
  assert.equal(gate.ok, true);
  assert.equal(gate.metrics.generation_valid, 1);

  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ run_id: 'test-fail', summary: { input: 500, jmdict_generation_ready: 42, generated_valid: 20, reverse_supported: 20, final_accepted: 10, final_rejected: 10, automatic_database_writes: 0 } }));
  const rejected = spawnSync(process.execPath, [path.resolve('scripts/check-dictionary-v2-production-run-gates.mjs'), '--run-dir', dir], { encoding: 'utf8' });
  assert.notEqual(rejected.status, 0);
  const rejectedGate = JSON.parse(fs.readFileSync(path.join(dir, 'production-gate.json'), 'utf8'));
  assert.equal(rejectedGate.ok, false);
  assert.ok(rejectedGate.failures.length >= 2);
  console.log('Production run gate regression passed.');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
