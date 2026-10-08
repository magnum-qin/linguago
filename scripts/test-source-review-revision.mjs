import assert from 'node:assert/strict';
import { buildRevision } from './build-dictionary-source-review-revision.mjs';

const row = { source_entry_id: 1, first_sense_id: 10, word: 'sample', source_lang: 'en', gloss_key: 'old',
  candidate_evidence_review: { preferred_terms: { en: 'stale' } }, generation_hint: 'stale',
  daily_sense_selection: { alternatives: [{ id: 11, gloss: 'new', source: 'native' }, { id: 12, gloss: 'other', source: 'native' }] } };
const old = { source_entry_id: 1, source_sense_id: 10, word: 'sample', source_lang: 'en', gloss_key: 'old', valid: true, approved: false, decision: 'reject' };
const alt = { source_entry_id: 1, first_sense_id: 11, word: 'sample', source_lang: 'en', gloss_key: 'new' };
const review = { ...alt, source_sense_id: 11, valid: true, approved: true, decision: 'accept', confidence: 0.95, risk_flags: [] };
const run = (r = old, alts = [alt], a = [review], b = [review], blocked = []) =>
  buildRevision({ selected: [row] }, { reviews: [r] }, { selected: alts }, { reviews: a }, { reviews: b }, blocked);
const result = run();
assert.equal(result.changes.length, 1);
assert.equal(result.selected.length, 1);
assert.equal(result.qualified, false);
assert.equal(result.selected[0].candidate_evidence_review, undefined);
assert.equal(result.selected[0].generation_hint, undefined);
assert.equal(run(old, [alt], [review], [review], [1]).changes.length, 0);
assert.equal(run({ ...old, approved: true, decision: 'accept' }).changes.length, 0);
assert.equal(run(old, [alt], [review], []).changes.length, 0);
assert.equal(run(old, [alt], [review], [{ ...review, confidence: 0.8 }]).changes.length, 0);
assert.throws(() => run(old, [alt], [review], [{ ...review, gloss_key: 'wrong' }]), /Unbound/);
assert.throws(() => run(old, [alt, alt]), /Duplicate/);
const alt2 = { ...alt, first_sense_id: 12, gloss_key: 'other' };
const review2 = { ...review, first_sense_id: 12, source_sense_id: 12, gloss_key: 'other' };
assert.equal(run(old, [alt, alt2], [review, review2], [review, review2]).changes.length, 0);
console.log('Source review revision tests passed');
