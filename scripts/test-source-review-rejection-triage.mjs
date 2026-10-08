import assert from 'node:assert/strict';
import { triageRejections } from './triage-dictionary-source-review-rejections.mjs';
const row = { source_entry_id: 1, first_sense_id: 2, word: 'x', gloss_key: 'old', daily_sense_selection: { alternatives: [
  { id: 2, source: 'lexicon', gloss: 'old' }, { id: 3, source: 'lexicon', gloss: 'new' },
  { id: 4, source: 'lexicon', gloss: 'blocked', blocked_reason: 'risk' },
  { id: 5, source: 'lexicon', gloss: 'published', linked_product_sense: 99 }
] } };
const review = { source_entry_id: 1, source_sense_id: 2, word: 'x', gloss_key: 'old', decision: 'reject', english_anchor: 'invented' };
const run = (r = review) => triageRejections({ selected: [row] }, { reviews: [r] });
assert.deepEqual(run().rows[0].alternatives.map((r) => r.id), [3]);
assert.equal(run().automatic_selection, false);
assert.equal(run({ ...review, approved: true, valid: true, decision: 'accept' }).nonaccepted, 0);
assert.throws(() => run({ ...review, gloss_key: 'changed' }), /Unbound/);
assert.throws(() => triageRejections({ selected: [row] }, { reviews: [review, review] }), /Duplicate/);
console.log('Rejection triage tests passed');
