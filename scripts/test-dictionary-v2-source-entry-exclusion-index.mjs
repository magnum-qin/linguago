import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve('.tmp/test-source-entry-exclusion-index');
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(path.join(root, 'history'), { recursive: true });
fs.writeFileSync(path.join(root, 'history/a.json'), JSON.stringify({ selected: [{ source_entry_id: 1 }] }));
fs.writeFileSync(path.join(root, 'history/b.json'), JSON.stringify({ selected: [{ source_entry_id: 2 }, { source_entry_id: 1 }] }));

const result = spawnSync(
  process.execPath,
  [
    path.resolve('scripts/build-dictionary-v2-source-entry-exclusion-index.mjs'),
    '--root', root,
    '--history', 'history/a.json,history/b.json',
    '--runs-root', 'runs',
    '--batch-root', 'batches',
    '--out', 'state/out.json'
  ],
  { encoding: 'utf8' }
);
assert.equal(result.status, 0, result.stderr || result.stdout);
const output = JSON.parse(fs.readFileSync(path.join(root, 'state/out.json'), 'utf8'));
assert.deepEqual(output.selected, [{ source_entry_id: 1 }, { source_entry_id: 2 }]);
assert.equal(output.summary.reports_read, 2);
console.log('Source entry exclusion index tests passed');
