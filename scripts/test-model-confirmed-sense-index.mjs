import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { dailyCandidateReasons } from './lib/daily-candidate-quality.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-confirmed-index-'));
const poolPath = path.join(root, 'pool.json');
const revisedPath = path.join(root, 'revised.json');
const firstPath = path.join(root, 'first.json');
const secondPath = path.join(root, 'second.json');
const altPath = path.join(root, 'alternates.json');
const altFirstPath = path.join(root, 'alt-first.json');
const altSecondPath = path.join(root, 'alt-second.json');
const confirmedOut = path.join(root, 'confirmed.json');
const attemptOut = path.join(root, 'attempts.json');

const pool = { selected: [
  { source_entry_id: 1, first_sense_id: 11, source_lang: 'zh', word: '死期', frequency_rank: 14_683, gloss_key: 'limited to a fixed period of time' },
  { source_entry_id: 2, first_sense_id: 21, source_lang: 'zh', word: '下回', frequency_rank: 16_224, gloss_key: 'next time' },
  { source_entry_id: 3, first_sense_id: 31, source_lang: 'zh', word: 'comarca-like', frequency_rank: 20_000, gloss_key: 'circular' }
] };
const revised = { selected: [
  { source_entry_id: 1, first_sense_id: 12, source_lang: 'zh', word: '死期', frequency_rank: 14_683, gloss_key: 'time of death' },
  { source_entry_id: 2, first_sense_id: 21, source_lang: 'zh', word: '下回', frequency_rank: 16_224, gloss_key: 'next time' },
  { source_entry_id: 3, first_sense_id: 31, source_lang: 'zh', word: 'comarca-like', frequency_rank: 20_000, gloss_key: 'circular' }
], changes: [{ word: '死期', previous_key: '1:11', next_key: '1:12' }], deferred: [] };
const accept = (entryId, senseId, word, gloss) => ({
  source_entry_id: entryId, source_sense_id: senseId, word, source_lang: 'zh', gloss_key: gloss,
  valid: true, approved: true, decision: 'accept', confidence: 0.95, risk_flags: []
});
const reject = (entryId, senseId, word, gloss) => ({
  source_entry_id: entryId, source_sense_id: senseId, word, source_lang: 'zh', gloss_key: gloss,
  valid: true, approved: false, decision: 'reject', confidence: 0.9, risk_flags: []
});
fs.writeFileSync(poolPath, JSON.stringify(pool));
fs.writeFileSync(revisedPath, JSON.stringify(revised));
fs.writeFileSync(firstPath, JSON.stringify({ reviews: [
  accept(1, 12, '死期', 'time of death'), accept(2, 21, '下回', 'next time'), reject(3, 31, 'comarca-like', 'circular')
] }));
fs.writeFileSync(secondPath, JSON.stringify({ reviews: [
  accept(1, 12, '死期', 'time of death'), accept(2, 21, '下回', 'next time'), reject(3, 31, 'comarca-like', 'circular')
] }));
fs.writeFileSync(altPath, JSON.stringify({ selected: [
  { source_entry_id: 1, first_sense_id: 13, source_lang: 'zh', word: '死期', frequency_rank: 14_683, gloss_key: 'doom (literary)' }
] }));
fs.writeFileSync(altFirstPath, JSON.stringify({ reviews: [accept(1, 13, '死期', 'doom (literary)')] }));
fs.writeFileSync(altSecondPath, JSON.stringify({ reviews: [reject(1, 13, '死期', 'doom (literary)')] }));

execFileSync(process.execPath, ['scripts/build-dictionary-v2-model-confirmed-sense-index.mjs',
  '--pool', poolPath, '--revised', revisedPath, '--first-review', firstPath, '--second-review', secondPath,
  '--alternate-input', altPath, '--alternate-first', altFirstPath, '--alternate-second', altSecondPath,
  '--confirmed-out', confirmedOut, '--attempt-out', attemptOut
], { cwd: path.resolve('.') });
const confirmed = JSON.parse(fs.readFileSync(confirmedOut, 'utf8'));
const attempts = JSON.parse(fs.readFileSync(attemptOut, 'utf8'));
// Dual-consensus senses are pinned: the rebound sense and the stable original.
assert.deepEqual(confirmed.selected.map((r) => `${r.source_entry_id}:${r.source_sense_id}`).sort(), ['1:12', '2:21']);
// Non-consensus reviewed senses are spent: both originals plus the rejected alternate.
assert.deepEqual(attempts.selected.map((r) => `${r.source_entry_id}:${r.source_sense_id}`).sort(), ['1:11', '1:13', '3:31']);
assert.equal(confirmed.automatic_publication, false);

// The helper must not re-litigate a model-confirmed pin against an attempted
// higher-order primary.
const pinnedRow = {
  word: '死期', source_lang: 'zh', frequency_rank: 14_683, first_sense_id: 12,
  gloss_key: 'time of death',
  daily_sense_selection: {
    policy: 'model_confirmed_primary_sense', confirmed_sense: 12,
    alternatives: [
      { id: 11, sense_order: 1, score: 9_800, attempted_source_sense: true },
      { id: 12, sense_order: 2, score: 6_750 }
    ]
  }
};
const pinnedReasons = dailyCandidateReasons(pinnedRow, 'new_headword');
assert.ok(!pinnedReasons.includes('primary_sense_attempted_no_daily_fallback'), JSON.stringify(pinnedReasons));
const unpinnedRow = { ...pinnedRow, daily_sense_selection: { alternatives: pinnedRow.daily_sense_selection.alternatives } };
assert.ok(dailyCandidateReasons(unpinnedRow, 'new_headword').includes('primary_sense_attempted_no_daily_fallback'));
console.log('model-confirmed sense index tests passed');
