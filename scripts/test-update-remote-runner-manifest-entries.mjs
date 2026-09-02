import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-manifest-refresh-'));
const scriptDir = path.join(root, 'scripts');
const dataDir = path.join(root, 'data', 'processed');
const configDir = path.join(root, 'config');
fs.mkdirSync(scriptDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(configDir, { recursive: true });

const allowedPaths = [
  'scripts\\publish-remote-dictionary-controlled-run.ps1',
  'scripts\\start-remote-dictionary-release-cohort-production.ps1',
  'scripts\\complete-remote-dictionary-production-run.ps1',
  'scripts\\run-remote-dictionary-production-until-release.ps1',
  'scripts\\test-remote-dictionary-production-gate-continuation.mjs',
  'scripts\\new-remote-dictionary-production-batch.ps1',
  'scripts\\build-dictionary-v2-additional-sense-recovery-pool.mjs',
  'scripts\\build-dictionary-v2-additional-sense-attempt-index.mjs',
  'scripts\\test-dictionary-v2-additional-sense-attempt-index.mjs',
  'scripts\\test-dictionary-v2-additional-sense-recovery-pool.mjs',
  'scripts\\align-dictionary-v2-product-source-gap-candidate-senses.mjs',
  'scripts\\update-remote-runner-manifest-entries.mjs'
];
const untouchedPath = 'scripts\\untouched.ps1';
for (const [index, allowedPath] of allowedPaths.entries()) {
  fs.writeFileSync(path.join(scriptDir, path.basename(allowedPath)), `new-content-${index}`, 'utf8');
}
fs.writeFileSync(path.join(scriptDir, 'untouched.ps1'), 'untouched', 'utf8');
const expected = allowedPaths.map((allowedPath, index) => ({
  path: allowedPath,
  sha256: crypto.createHash('sha256').update(`new-content-${index}`).digest('hex').toUpperCase()
}));
const manifestPath = path.join(configDir, 'remote-runner-files.json');
const updatesPath = path.join(root, 'updates.json');
fs.writeFileSync(manifestPath, JSON.stringify({ files: [
  ...allowedPaths.map((allowedPath) => ({ path: allowedPath, sha256: '0'.repeat(64), bytes: 1 })),
  { path: untouchedPath, sha256: '1'.repeat(64), bytes: 9 }
] }, null, 2));
fs.writeFileSync(updatesPath, JSON.stringify(expected));

const tool = path.resolve('scripts/update-remote-runner-manifest-entries.mjs');
const run = (apply) => spawnSync(process.execPath, [tool, '--root', root, '--manifest', 'config/remote-runner-files.json', '--updates', updatesPath, '--apply', String(apply)], { encoding: 'utf8' });

const before = fs.readFileSync(manifestPath, 'utf8');
const dry = run(false);
assert.equal(dry.status, 0, dry.stderr);
assert.equal(fs.readFileSync(manifestPath, 'utf8'), before, 'dry-run must not modify manifest');

const applied = run(true);
assert.equal(applied.status, 0, applied.stderr);
const after = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
for (const [index, item] of expected.entries()) {
  assert.equal(after.files[index].sha256, item.sha256);
  assert.equal(after.files[index].bytes, Buffer.byteLength(`new-content-${index}`));
}
assert.deepEqual(after.files.at(-1), { path: untouchedPath, sha256: '1'.repeat(64), bytes: 9 });

const disallowed = path.join(root, 'disallowed.json');
fs.writeFileSync(disallowed, JSON.stringify([{ path: untouchedPath, sha256: '1'.repeat(64) }]));
const rejected = spawnSync(process.execPath, [tool, '--root', root, '--manifest', 'config/remote-runner-files.json', '--updates', disallowed, '--apply', 'true'], { encoding: 'utf8' });
assert.notEqual(rejected.status, 0, 'disallowed path must be rejected');

console.log(JSON.stringify({ ok: true, tested: ['dry_run_no_write', 'exact_apply', 'unlisted_entry_unchanged', 'disallowed_path_rejected'] }, null, 2));
