#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  discoverUnslothStagePool,
  selectClusterEndpoints
} from './lib/unsloth-cluster-discovery.mjs';

const result = selectClusterEndpoints({
  hosts: [
    {
      name: 'a6000-144', group: 'A6000', agent_reachable: true, state: 'idle',
      gpu: { util_gpu: 0, temp_c: 40 }, processes: []
    },
    {
      name: 'a6000-143', group: 'A6000', agent_reachable: true, state: 'busy',
      gpu: { util_gpu: 98, temp_c: 70 }, processes: [{ user: 'other-user', gpu_mem_mb: 20_000 }]
    },
    {
      name: 'rtx4090-56', group: 'RTX 4090', agent_reachable: true, state: 'busy',
      gpu: { util_gpu: 90, temp_c: 60 }, processes: [{ user: 'g24tka12', gpu_mem_mb: 22_000 }]
    },
    {
      name: 'rtx4090-47', group: 'RTX 4090', agent_reachable: true, state: 'idle',
      gpu: { util_gpu: 0, temp_c: 88 }, processes: []
    }
  ]
}, {
  configuredPorts: new Set(['11447'])
});

assert.deepEqual(result.selected.map((row) => row.port), ['11442', '11447']);
assert.equal(result.selected[0].source, 'dynamic_idle');
assert.equal(result.selected[1].source, 'configured_owned');
assert.equal(result.excluded.find((row) => row.port === '11441')?.reason, 'foreign_gpu_process');
assert.equal(result.excluded.find((row) => row.port === '11448')?.reason, 'gpu_too_hot');

const configuredEndpoints = ['http://127.0.0.1:11447'];
const timeoutFallback = await discoverUnslothStagePool({
  configuredEndpoints,
  configuredVariants: new Map([['11447', 'UD-IQ4_NL']]),
  model: 'test/model',
  dashboardTimeoutMs: 10,
  fetchImpl: () => new Promise(() => {})
});
assert.equal(timeoutFallback.ok, false);
assert.equal(timeoutFallback.degraded, true);
assert.equal(timeoutFallback.reason, 'dashboard_timeout');
assert.deepEqual(timeoutFallback.endpoints, configuredEndpoints);
console.log('Unsloth cluster discovery checks passed.');
