#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const args = parseArgs(process.argv.slice(2));
const profilePath = path.resolve(args.profile || 'config/dictionary-v2-production-v106.json');
if (!fs.existsSync(profilePath)) throw new Error(`Profile not found: ${profilePath}`);

const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
const runner = profile?.runner;
if (!runner || typeof runner !== 'object' || Array.isArray(runner)) {
  throw new Error('Profile requires a runner object');
}
for (const required of ['pipeline-mode', 'qwen-endpoints', 'qwen-model', 'gemma-endpoints', 'gemma-model']) {
  if (!String(runner[required] || '').trim()) throw new Error(`Profile runner is missing ${required}`);
}

const batch = requiredPath(args.batch, 'batch');
const runId = String(args['run-id'] || '').trim();
if (!runId) throw new Error('Missing --run-id');

const runnerArgs = [];
for (const [key, value] of Object.entries(runner)) {
  if (value == null || value === '') continue;
  runnerArgs.push(`--${key}`, String(value));
}
runnerArgs.push('--batch', batch, '--run-id', runId);
for (const key of ['run-dir', 'generation-target', 'resume']) {
  if (args[key] != null) runnerArgs.push(`--${key}`, String(args[key]));
}

const invocation = {
  ok: true,
  profile: path.relative(process.cwd(), profilePath),
  profile_version: profile.version || null,
  batch: path.relative(process.cwd(), batch),
  run_id: runId,
  command: [process.execPath, 'scripts/run-dictionary-v2-remote-pipeline.mjs', ...runnerArgs]
};
if (args['print-command'] === 'true') {
  console.log(JSON.stringify(invocation, null, 2));
  process.exit(0);
}

const child = spawn(process.execPath, ['scripts/run-dictionary-v2-remote-pipeline.mjs', ...runnerArgs], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit'
});
child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Production runner stopped by signal ${signal}`);
    process.exitCode = 1;
  } else {
    process.exitCode = Number(code || 0);
  }
});

function requiredPath(value, label) {
  if (!value) throw new Error(`Missing --${label}`);
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) throw new Error(`${label} not found: ${resolved}`);
  return resolved;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return parsed;
}
