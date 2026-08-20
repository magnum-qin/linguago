#!/usr/bin/env node

import assert from 'node:assert/strict';
import { compositionalJapanesePhraseReadings } from './lib/japanese-reading-contract.mjs';

const dictionary = new Map([
  ['街', new Set(['まち'])],
  ['前', new Set(['まえ'])],
  ['出る', new Set(['でる'])],
  ['極めて', new Set(['きわめて'])],
  ['重要', new Set(['じゅうよう'])],
  ['伴', new Set(['ばん'])]
]);
const lookup = (term) => dictionary.get(term);
const readings = (term) => [...(compositionalJapanesePhraseReadings(term, lookup) || [])];

assert.ok(readings('街に出る').includes('まちにでる'));
assert.ok(readings('前へ出る').includes('まえへでる'));
assert.ok(readings('極めて重要').includes('きわめてじゅうよう'));
assert.equal(compositionalJapanesePhraseReadings('街中', lookup), null);
assert.ok(!readings('それに伴って').includes('それにともなって'));
assert.ok(readings('それに伴って').includes('それにばんって'));

console.log('Japanese compositional phrase reading test passed');
