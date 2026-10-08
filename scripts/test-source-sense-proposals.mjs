import assert from 'node:assert/strict';
import { buildSenseProposals } from './build-source-sense-proposals.mjs';
const row = { source_entry_id: 1, first_sense_id: 2, word: 'test', source_lang: 'en', gloss_key: 'trial',
  candidate_evidence_review: { approved: true }, source_review_consensus: { approved: true } };
const review = { ...row, source_sense_id: 2, valid: true, approved: true, decision: 'accept' };
const result = buildSenseProposals({ selected: [row] }, { reviews: [review] }, { reviews: [review] });
assert.equal(result.selected_count, 1);
assert.equal(result.selected[0].promote_allowed, false);
assert.equal(result.selected[0].candidate_evidence_review, undefined);
assert.equal(result.selected[0].source_review_consensus, undefined);
assert.equal(result.selected[0].sense_review_agreement.translation_agreement, false);
assert.equal(row.candidate_evidence_review.approved, true);
assert.equal(buildSenseProposals({ selected: [row] }, { reviews: [review] }, { reviews: [] }).selected_count, 0);
assert.equal(buildSenseProposals({ selected: [row] }, { reviews: [review] }, { reviews: [{ ...review, valid: false }] }).selected_count, 0);
console.log('Source sense proposal tests passed');
