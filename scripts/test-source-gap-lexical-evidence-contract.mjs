import assert from 'node:assert/strict';
import {
  bidirectionalTokenCoverage,
  canonicalEnglishSpellingVariant,
  looksProperOrNamedEnglishAnchor
} from './lib/source-gap-lexical-contract.mjs';

const exact = bidirectionalTokenCoverage(new Set(['maltese']), new Set(['maltese']));
assert.deepEqual(exact, { overlap: 1, anchor_coverage: 1, source_coverage: 1 });

const partial = bidirectionalTokenCoverage(
  new Set(['maltese']),
  new Set(['maltese', 'dog'])
);
assert.equal(partial.anchor_coverage, 1);
assert.equal(partial.source_coverage, 0.5);
assert.ok(partial.source_coverage < 0.67, 'one-sided partial phrases must not pass');

assert.equal(looksProperOrNamedEnglishAnchor('Saint Kitts and Nevis'), true);
assert.equal(looksProperOrNamedEnglishAnchor('University of Tokyo'), true);
assert.equal(looksProperOrNamedEnglishAnchor('medium-sized dog'), false);
assert.equal(looksProperOrNamedEnglishAnchor('to place an order'), false);
assert.equal(looksProperOrNamedEnglishAnchor(''), false);

assert.equal(/^candidate:(.+)$/u.test('candidate:2069157:2546848'), true);
assert.equal(/^candidate:(.+)$/u.test('cedpane:unbound-hash'), false);

assert.equal(canonicalEnglishSpellingVariant('kilolitre'), 'kiloliter');
assert.equal(canonicalEnglishSpellingVariant('kiloliters'), 'kiloliters');
assert.equal(canonicalEnglishSpellingVariant('cubic metre'), 'cubic meter');
assert.equal(canonicalEnglishSpellingVariant('cubic metres'), 'cubic meters');

console.log(JSON.stringify({ ok: true, assertions: 16 }));
