#!/usr/bin/env node

import './lib/load-local-env.mjs';
import { discoverUnslothStagePool } from './lib/unsloth-cluster-discovery.mjs';

const args = parseArgs(process.argv.slice(2));
const endpoints = csv(args.endpoints);
const variants = new Map(csv(args.variants).map((item) => {
  const separator = item.indexOf('=');
  return separator > 0 ? [item.slice(0, separator), item.slice(separator + 1)] : [item, ''];
}));
const result = await discoverUnslothStagePool({
  dashboardUrl: args.dashboard || 'http://127.0.0.1:18080/api/status',
  configuredEndpoints: endpoints,
  configuredVariants: variants,
  model: args.model,
  token: process.env.UNSLOTH_API_KEY,
  serviceUser: args['service-user'] || 'g24tka12',
  requireInstalled: args['require-installed'] !== 'false'
});
console.log(JSON.stringify({
  ...result,
  variants: Object.fromEntries(result.variants)
}, null, 2));
if (!result.endpoints.length) process.exitCode = 1;

function csv(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith('--')) continue;
    parsed[key.slice(2)] = values[index + 1] && !values[index + 1].startsWith('--') ? values[++index] : 'true';
  }
  return parsed;
}

