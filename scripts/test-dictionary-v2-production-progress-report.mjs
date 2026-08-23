#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-production-progress-'));
try {
  write('manifest.json', {
    run_id: 'test-production',
    status: 'running',
    stages: {
      production_prefilter: { status: 'complete' },
      gemma_source_review: { status: 'running', started_at: '2026-01-01T00:00:00.000Z' }
    }
  });
  write('00b-source-sense-aligned.json', { candidates: Array.from({ length: 100 }, (_, index) => ({ id: index + 1 })) });
  write('03-gemma-source-review.json', {
    summary: { reviewed: 40, approved: 31, rejected: 8, manual_review: 1 },
    reviews: Array.from({ length: 40 }, (_, index) => ({ id: index + 1 }))
  });

  const script = path.resolve('scripts/report-dictionary-v2-production-progress.mjs');
  const result = spawnSync(process.execPath, [script, '--run-dir', runDir], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.run_id, 'test-production');
  assert.equal(output.active_stage, 'gemma_source_review');
  assert.equal(output.progress.completed, 40);
  assert.equal(output.progress.total, 100);
  assert.equal(output.progress.remaining, 60);
  assert.equal(output.progress.accepted, 31);
  assert.equal(output.progress.rejected, 9);
  assert.equal(output.heartbeat.source, '03-gemma-source-review.json');
  console.log('Production progress report regression passed.');
} finally {
  fs.rmSync(runDir, { recursive: true, force: true });
}

function write(name, value) { fs.writeFileSync(path.join(runDir, name), `${JSON.stringify(value)}\n`, 'utf8'); }
