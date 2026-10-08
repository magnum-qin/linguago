import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-proposal-guard-'));
try {
  const db = path.join(temp, 'sentinel.db');
  const report = path.join(temp, 'proposals.json');
  const before = Buffer.from('not a database: must never be opened for writing');
  fs.writeFileSync(db, before);
  fs.writeFileSync(report, JSON.stringify({ selected: [{ proposal_only: true }] }));
  for (const option of ['--apply', '--publishable']) {
    const result = spawnSync(process.execPath, [
      'scripts/supplement-dictionary-v2-product-source-gaps-unsloth.mjs',
      '--db', db, '--report', report, '--out', path.join(temp, 'output.json'),
      '--endpoints', 'http://127.0.0.1:1', option, 'true'
    ], { cwd: root, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, UNSLOTH_API_KEY: 'test-only-not-a-secret' } });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unreviewed translation proposals cannot be applied or published/);
    assert.deepEqual(fs.readFileSync(db), before);
    assert.equal(fs.existsSync(path.join(temp, 'output.json')), false);
  }
  console.log('Proposal CLI write guards passed before DB opening and inference');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
