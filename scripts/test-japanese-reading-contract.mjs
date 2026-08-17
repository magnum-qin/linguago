import assert from 'node:assert/strict';
import {
  normalizeJapaneseKanaReading,
  selectCanonicalJapaneseReading,
  transparentJapaneseCompoundReadings
} from './lib/japanese-reading-contract.mjs';

assert.equal(normalizeJapaneseKanaReading('ライオン'), 'らいおん');

const armReadings = new Set(['りょううで', 'もろうで']);
assert.equal(selectCanonicalJapaneseReading('りょうわん', armReadings), 'りょううで');
assert.equal(selectCanonicalJapaneseReading('もろうで', armReadings), 'もろうで');

const lookup = (term) => term === '雌' ? new Set(['めす']) : null;
assert.deepEqual(
  [...transparentJapaneseCompoundReadings('雌ライオン', lookup)],
  ['めすらいおん']
);
assert.equal(transparentJapaneseCompoundReadings('雌ライオン賞', lookup), null);
assert.equal(transparentJapaneseCompoundReadings('ライオン', lookup), null);

console.log(JSON.stringify({ ok: true, assertions: 7 }));
