#!/usr/bin/env node

import './lib/load-local-env.mjs';

const args = parseArgs(process.argv.slice(2));
const endpoint = String(args.endpoint || '').trim().replace(/\/$/u, '');
const token = process.env.UNSLOTH_API_KEY;
const timeoutMs = Number(args['timeout-ms'] || 90_000);

if (!endpoint) throw new Error('Missing --endpoint');
if (!token) throw new Error('UNSLOTH_API_KEY is not loaded');

const before = await request('/v1/status');
const activeModel = String(before?.active_model || '').trim();
if (!activeModel) {
  console.log(JSON.stringify({ ok: true, endpoint, action: 'already_unloaded', before }, null, 2));
  process.exit(0);
}

await request('/v1/unload', {
  method: 'POST',
  body: { model_path: activeModel },
  timeoutMs: 60_000
});

const deadline = Date.now() + timeoutMs;
let after = null;
while (Date.now() < deadline) {
  after = await request('/v1/status', { timeoutMs: 15_000 });
  if (!after?.active_model) {
    console.log(JSON.stringify({ ok: true, endpoint, action: 'unloaded', active_model: activeModel, after }, null, 2));
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

throw new Error(`Model did not unload before timeout: ${activeModel}; last=${JSON.stringify(after)}`);

async function request(pathname, options = {}) {
  const response = await fetch(`${endpoint}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(options.timeoutMs || 30_000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const tokenValue = argv[index];
    if (!tokenValue.startsWith('--')) continue;
    const key = tokenValue.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}
