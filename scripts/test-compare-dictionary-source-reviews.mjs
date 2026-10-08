import assert from 'node:assert/strict';
import { compareReviews } from './compare-dictionary-source-reviews.mjs';

const row = { source_entry_id: 1, source_sense_id: 2, word: 'test', source_lang: 'en', gloss_key: 'trial', valid: true, approved: true, decision: 'accept' };
const report = { reviews: [row] };
assert.equal(compareReviews(report, report).changed, 0);
assert.equal(compareReviews(report, { reviews: [{ ...row, approved: false, decision: 'reject' }] }).after.accepted, 0);
assert.equal(compareReviews(report, { reviews: [{ ...row, valid: false }] }).after.accepted, 0);
assert.throws(() => compareReviews(report, { reviews: [row, row] }), /Duplicate/);
assert.throws(() => compareReviews(report, { reviews: [{ ...row, source_sense_id: 3 }] }), /Cohort/);
assert.throws(() => compareReviews(report, { reviews: [{ ...row, gloss_key: 'changed' }] }), /Locked sense/);
console.log('Source review comparison tests passed');
