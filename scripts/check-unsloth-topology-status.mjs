#!/usr/bin/env node

import './lib/load-local-env.mjs';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const configPath = path.resolve(args.config || 'config/dictionary-v2-llm-topology.json');
const outPath = path.resolve(args.out || 'logs/unsloth-topology-status.json');
const token = process.env.UNSLOTH_API_KEY;
if (!token) throw new Error('UNSLOTH_API_KEY is not loaded');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const endpointRoles = new Map();
for (const role of ['targeted_review', 'generation', 'review']) {
  for (const endpoint of config[role]?.endpoints || []) {
    const item = endpointRoles.get(endpoint) || { endpoint, roles: [], expected_models: [] };
    item.roles.push(role);
    item.expected_models.push(config[role].model);
    endpointRoles.set(endpoint, item);
  }
}

const rows = await Promise.all([...endpointRoles.values()].map(async (item) => {
  const [status, models] = await Promise.all([
    getJson(item.endpoint, '/v1/status'),
    getJson(item.endpoint, '/api/models/local')
  ]);
  const modelRows = Array.isArray(models.data)
    ? models.data
    : Array.isArray(models.data?.models)
      ? models.data.models
      : [];
  const installed = new Set(modelRows.map((model) => model.id || model.model_id));
  return {
    ...item,
    reachable: status.ok && models.ok,
    status_http: status.status,
    models_http: models.status,
    active_model: status.data?.active_model || status.data?.model || null,
    loaded: Boolean(status.data?.loaded || status.data?.active_model),
    context_length: status.data?.context_length || status.data?.max_seq_length || null,
    cpu_fallback_reason: status.data?.cpu_fallback_reason || null,
    n_cpu_moe: status.data?.n_cpu_moe ?? null,
    expected_models_installed: item.expected_models.map((model) => ({ model, installed: installed.has(model) })),
    errors: [status.error, models.error].filter(Boolean)
  };
}));
const output = {
  ok: rows.every((row) => row.reachable),
  generated_at: new Date().toISOString(),
  config: path.relative(process.cwd(), configPath),
  rows
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: output.ok, out: path.relative(process.cwd(), outPath), rows }, null, 2));

async function getJson(endpoint, pathname) {
  try {
    const response = await fetch(`${endpoint}${pathname}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000)
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return {
      ok: response.ok,
      status: response.status,
      data,
      error: response.ok ? null : `HTTP ${response.status}: ${text.slice(0, 200)}`
    };
  } catch (error) {
    return { ok: false, status: null, data: null, error: String(error?.message || error) };
  }
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    result[key] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return result;
}
