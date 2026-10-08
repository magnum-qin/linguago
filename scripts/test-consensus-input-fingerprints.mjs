import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-consensus-binding-'));
const generation = path.join(temp, 'generation.json');
const evidence = path.join(temp, 'evidence.json');
const consensus = path.join(temp, 'consensus.json');
const review = path.join(temp, 'review.json');
const out = path.join(temp, 'out.json');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const run = (script, args) => {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, UNSLOTH_API_KEY: 'test-only-not-a-secret' }
  });
  assert.equal(result.error, undefined);
  return result;
};
try {
  write(generation, { generated: [] });
  write(evidence, { validations: [], policy: { require_source_reverse_evidence: true } });
  write(review, { selected: [] });
  const bound = { generation: hash(generation), evidence: hash(evidence) };
  const policy = { independent_model_families: true, automatic_promotion: false };
  for (const input_sha256 of [undefined, { ...bound, generation: 'changed' }, { ...bound, evidence: 'changed' }]) {
    write(consensus, { reviews: [], policy, input_sha256 });
    const before = fs.readFileSync(consensus);
    const builder = run('scripts/build-dictionary-v2-product-source-gap-controlled-consensus-input.mjs', [
      '--review', review, '--generation', generation, '--evidence', evidence,
      '--consensus', consensus, '--out', out
    ]);
    assert.notEqual(builder.status, 0);
    assert.match(builder.stderr, /missing or mismatched .* fingerprint/);
    assert.equal(fs.existsSync(out), false);
    const reviewer = run('scripts/review-dictionary-v2-product-source-gap-consensus-unsloth.mjs', [
      '--generation', generation, '--evidence', evidence, '--out', consensus,
      '--resume', 'true', '--endpoints', 'http://127.0.0.1:1', '--generation-model', 'qwen'
    ]);
    assert.notEqual(reviewer.status, 0);
    assert.match(reviewer.stderr, /Cannot resume: missing or changed .* input fingerprint/);
    assert.deepEqual(fs.readFileSync(consensus), before);
  }
  write(consensus, { reviews: [], policy, input_sha256: bound });
  const passed = run('scripts/build-dictionary-v2-product-source-gap-controlled-consensus-input.mjs', [
    '--review', review, '--generation', generation, '--evidence', evidence,
    '--consensus', consensus, '--out', out
  ]);
  assert.equal(passed.status, 0, passed.stderr);
  assert.equal(JSON.parse(fs.readFileSync(out)).selected_count, 0);
  console.log('Consensus fingerprint CLI tests passed: missing, changed, matching inputs');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
