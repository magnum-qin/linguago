import { spawn } from 'node:child_process';
import fs from 'node:fs';

const node = process.execPath;
const checks = [
  {
    name: 'TypeScript',
    command: node,
    args: ['node_modules/typescript/bin/tsc', '--noEmit']
  },
  {
    name: 'Service Worker cache',
    command: node,
    args: ['scripts/sw-cache-check.mjs']
  },
  ...[
    'public/sw.js',
    'scripts/api-smoke.mjs',
    'scripts/stream-benchmark.mjs',
    'scripts/sw-cache-check.mjs'
  ]
    .filter((file) => fs.existsSync(file))
    .map((file) => ({
      name: `Syntax ${file}`,
      command: node,
      args: ['--check', file]
    }))
];

const results = [];
for (const check of checks) {
  const started = performance.now();
  const result = await run(check.command, check.args);
  results.push({
    name: check.name,
    ok: result.code === 0,
    ms: Math.round(performance.now() - started),
    output: result.output.trim()
  });
}

for (const result of results) {
  const status = result.ok ? 'PASS' : 'FAIL';
  console.log(`${status} ${result.name} (${result.ms}ms)`);
  if (!result.ok && result.output) {
    console.log(result.output);
  }
}

if (results.some((result) => !result.ok)) {
  process.exitCode = 1;
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      shell: false,
      windowsHide: true
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', (error) => {
      resolve({ code: 1, output: error.message });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, output });
    });
  });
}
