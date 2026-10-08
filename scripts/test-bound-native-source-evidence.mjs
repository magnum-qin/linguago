import assert from 'node:assert/strict';
import { hasBoundNativeSourceEvidence } from './lib/bound-native-source-evidence.mjs';

const evidence = [{ source: 'cc-cedict', source_family: null }];
const evidenceFamilyFor = (source, family) => String(family || source || '').toLowerCase();
const evaluate = (overrides = {}) => hasBoundNativeSourceEvidence({
  enabled: true,
  sourceIdentityMatches: true,
  nativeSourceFamily: 'cc-cedict',
  matchingEvidence: evidence,
  evidenceFamilyFor,
  ...overrides
});

assert.equal(evaluate(), true, 'exact identity and matching native family should pass');
assert.equal(evaluate({ enabled: false }), false, 'the opt-in flag must default closed');
assert.equal(evaluate({ sourceIdentityMatches: false }), false, 'stale source identity must not pass');
assert.equal(evaluate({ nativeSourceFamily: 'jmdict' }), false, 'a different native family must not pass');
assert.equal(evaluate({ nativeSourceFamily: '' }), false, 'missing native family must not pass');
assert.equal(evaluate({ matchingEvidence: [] }), false, 'missing matching evidence must not pass');

console.log('Bound native source evidence requires opt-in, exact identity and matching family.');
