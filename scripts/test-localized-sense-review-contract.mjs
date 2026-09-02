import assert from 'node:assert/strict';
import {
  needsIndependentReview,
  validateLocalizedSenseReview
} from './lib/localized-sense-review-contract.mjs';

const candidate = { senses: [{ id: 10 }, { id: 11 }] };
const valid = {
  decision: 'isolate',
  confidence: 0.97,
  matched_sense_ids: [11],
  reason_codes: ['localized_term_subset'],
  reason: 'The query form belongs only to sense 11.',
  actions: [{ type: 'query_isolation', sense_ids: [11] }]
};
assert.equal(validateLocalizedSenseReview(valid, candidate).ok, true);
assert.equal(needsIndependentReview({ valid: true, decision: 'keep', confidence: 0.96 }), false);
assert.equal(needsIndependentReview({ valid: true, decision: 'repair', confidence: 0.99 }), true);
assert.equal(
  validateLocalizedSenseReview({ ...valid, decision: 'keep', matched_sense_ids: [10, 11] }, candidate).ok,
  true
);
assert.equal(
  validateLocalizedSenseReview({ ...valid, decision: 'keep', matched_sense_ids: [11] }, candidate).errors.includes('keep_requires_all_senses'),
  true
);
assert.equal(
  validateLocalizedSenseReview({ ...valid, matched_sense_ids: [10, 11] }, candidate).errors.includes('isolate_requires_nonempty_proper_subset'),
  true
);
assert.equal(
  validateLocalizedSenseReview({ ...valid, decision: 'repair', matched_sense_ids: [10, 11] }, candidate).errors.includes('repair_action_missing'),
  true
);
const validRepair = {
  ...valid,
  decision: 'repair',
  matched_sense_ids: [10, 11],
  actions: [{ type: 'repair_localization', sense_ids: [10], target_lang: 'zh', fields: ['term', 'definition'] }]
};
assert.equal(validateLocalizedSenseReview(validRepair, candidate).ok, true);
assert.equal(
  validateLocalizedSenseReview({ ...validRepair, actions: [{ ...validRepair.actions[0], target_lang: 'xx' }] }, candidate).errors.includes('repair_target_lang_invalid'),
  true
);
assert.equal(
  validateLocalizedSenseReview({ ...validRepair, actions: [{ ...validRepair.actions[0], fields: [] }] }, candidate).errors.includes('repair_fields_invalid'),
  true
);
assert.equal(
  validateLocalizedSenseReview({ ...valid, matched_sense_ids: [99] }, candidate).errors.includes('unknown_matched_sense_id'),
  true
);
console.log('localized sense review contract tests passed');
