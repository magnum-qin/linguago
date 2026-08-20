import assert from 'node:assert/strict';
import {
  candidateEnglishTerms,
  matchBlindSourceAnchor,
  normalizeBlindSenses
} from './lib/blind-source-anchor.mjs';

const slater = {
  word: 'slater',
  first_sense_localizations: [
    { lang: 'en', term: 'woodlouse; slater', definition: 'woodlouse; slater' }
  ],
  generation_hints: { en: { terms: ['slater'] } }
};
assert.deepEqual(candidateEnglishTerms(slater), ['woodlouse']);
const senses = normalizeBlindSenses([
  { anchor: 'a worker who lays slate', aliases: ['slate roofer'], commonness: 'common' },
  { anchor: 'woodlouse', aliases: ['pill bug', 'slater'], commonness: 'regional' }
]);
assert.equal(matchBlindSourceAnchor(slater, senses).matched, true);
assert.equal(matchBlindSourceAnchor(slater, senses).sense.anchor, 'woodlouse');

const wrong = {
  word: 'regras',
  first_sense_localizations: [{ lang: 'en', term: 'menstruation' }]
};
const ruleSenses = normalizeBlindSenses([
  { anchor: 'rules or regulations', aliases: ['rules', 'regulations'], commonness: 'common' }
]);
assert.equal(matchBlindSourceAnchor(wrong, ruleSenses).matched, false);

console.log('blind source anchor tests passed');
