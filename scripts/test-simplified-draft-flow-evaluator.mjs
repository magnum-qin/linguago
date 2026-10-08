#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-simplified-flow-'));
const runDir = path.join(root, 'fixture-run');
fs.mkdirSync(runDir, { recursive: true });

const generated = Array.from({ length: 10 }, (_, index) => ({
  source_entry_id: index + 1,
  valid: index < 9,
  output: { source_sense_id: index + 101 }
}));
const reverse = generated.slice(0, 9);
const accepted = generated.slice(0, 8).map((item) => ({
  source_entry_id: item.source_entry_id,
  source_sense_id: item.output.source_sense_id
}));

write('05-qwen-generation.json', { generated });
write('06-reverse-evidence-supported.json', { generated: reverse });
write('07-final-gemma.json', { reviews: [...accepted, { source_entry_id: 9, source_sense_id: 109 }] });
write('07-final-gemma-accepted.json', { reviews: accepted });
write('manifest.json', {
  stages: {
    qwen_generation: { duration_seconds: 10 },
    reverse_evidence: { duration_seconds: 1 },
    final_gemma: { duration_seconds: 4 }
  }
});

const result = spawnSync(process.execPath, [
  path.resolve('scripts/evaluate-dictionary-v2-simplified-draft-flow.mjs'),
  '--runs', runDir,
  '--min-structure-rate', '0.9',
  '--min-release-retention', '0.8'
], { encoding: 'utf8' });

assert.equal(result.status, 0, result.stderr);
const report = JSON.parse(result.stdout);
assert.equal(report.totals.generated, 10);
assert.equal(report.totals.structurally_valid, 9);
assert.equal(report.totals.final_accepted, 8);
assert.equal(report.totals.final_rejected_or_manual, 1);
assert.equal(report.verdict.draft_only_bulk_generation, 'pass');
assert.equal(report.verdict.direct_publish_without_release_gates, 'fail');
assert.equal(report.policy.candidate_content_included, false);

fs.rmSync(root, { recursive: true, force: true });
console.log('simplified draft flow evaluator test passed');

function write(name, value) {
  fs.writeFileSync(path.join(runDir, name), `${JSON.stringify(value)}\n`, 'utf8');
}
