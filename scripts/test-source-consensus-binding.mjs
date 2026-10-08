import assert from 'node:assert/strict';
import { bindSourceReviews, isAcceptedSourceReview, assertProposalWriteMode } from './lib/source-consensus-binding.mjs';
const candidate = { source_entry_id: 1, first_sense_id: 2, word: 'test', source_lang: 'en', gloss_key: 'trial' };
const review = { ...candidate, source_sense_id: 2, valid: true, approved: true, decision: 'accept' };
assert.equal(bindSourceReviews([candidate], [review], [review]).second.size, 1);
assert.equal(isAcceptedSourceReview(review), true);
assert.equal(isAcceptedSourceReview({ ...review, valid: false }), false);
assert.equal(isAcceptedSourceReview({ ...review, decision: 'reject' }), false);
for (const field of ['word', 'source_lang', 'gloss_key']) {
  assert.throws(() => bindSourceReviews([candidate], [review], [{ ...review, [field]: 'wrong' }]), /Unbound/);
}
assert.throws(() => bindSourceReviews([candidate], [review, review], []), /Duplicate/);
assert.throws(() => bindSourceReviews([candidate, candidate], [], []), /Duplicate/);
assert.throws(() => bindSourceReviews([candidate], [], [review]), /without primary/);
assert.throws(() => bindSourceReviews([{ ...candidate, first_sense_id: 0 }], [], []), /Invalid/);
console.log('Source consensus binding tests passed');
assert.doesNotThrow(() => assertProposalWriteMode([{ proposal_only: true }], { apply: false, publishable: false }));
assert.throws(() => assertProposalWriteMode([{ proposal_only: true }], { apply: true }), /cannot/);
assert.throws(() => assertProposalWriteMode([{ proposal_only: true }], { publishable: true }), /cannot/);
assert.doesNotThrow(() => assertProposalWriteMode([{}], { apply: true }));
