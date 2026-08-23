#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runChildProcessWithLog } from './lib/run-child-process-with-log.mjs';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-child-log-'));
const logPath = path.join(tempDir, 'child.log');
const childScript = [
  "const { spawn } = require('node:child_process');",
  "const grandchild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1500)'], { detached: true, stdio: ['ignore', 'inherit', 'inherit'] });",
  'grandchild.unref();',
  "console.log('parent-complete');"
].join('');

const startedAt = Date.now();
const exitCode = await runChildProcessWithLog({
  command: process.execPath,
  args: ['-e', childScript],
  logPath,
  exitDrainTimeoutMs: 150
});
const elapsedMs = Date.now() - startedAt;

assert.equal(exitCode, 0);
assert.ok(elapsedMs < 1000, `runner waited ${elapsedMs}ms for inherited pipes`);
assert.match(fs.readFileSync(logPath, 'utf8'), /parent-complete/u);

console.log(JSON.stringify({ ok: true, elapsed_ms: elapsedMs }));
