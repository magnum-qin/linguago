import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src = fs.readFileSync(new URL('./build-dictionary-v2-product-source-gap-controlled-consensus-input.mjs', import.meta.url), 'utf8');
const start = src.indexOf('function hasLockedSourceSense(row) {');
const end = src.indexOf('\nfunction ', start + 1);
assert.ok(start > 0 && end > start);
const row = { source_entry_id: 1, first_sense_id: 2, candidate_key: '1:2', gloss_key: 'locked',
  daily_sense_selection: { policy: 'revised_unique_consensus_source_requires_full_rereview',
    requires_independent_source_review: true, alternatives: [{ id: 2, source: 'cc-cedict', gloss: 'locked' }] } };
const check = (r, gate = true) => vm.runInNewContext(`${src.slice(start, end)};hasLockedSourceSense(row)`, { row: r, finalGateEnabled: gate });
assert.equal(check(row), true);
assert.equal(check(row, false), false);
assert.equal(check({ ...row, gloss_key: 'different' }), false);
assert.equal(check({ ...row, candidate_key: '1:3' }), false);
for (const change of [{ blocked_reason: 'blocked' }, { linked_product_sense: 9 }, { source: 'unknown' }, { id: 3 }]) {
  const altered = structuredClone(row);
  Object.assign(altered.daily_sense_selection.alternatives[0], change);
  assert.equal(check(altered), false);
}
console.log('Revised controlled source lock tests passed');
