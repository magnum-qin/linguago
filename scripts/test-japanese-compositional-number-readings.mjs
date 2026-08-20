#!/usr/bin/env node

import assert from 'node:assert/strict';
import { compositionalJapaneseNumberReadings } from './lib/japanese-reading-contract.mjs';

const readings = (term) => [...(compositionalJapaneseNumberReadings(term) || [])];

assert.deepEqual(readings('三十五'), ['さんじゅうご']);
assert.ok(readings('四十八').includes('よんじゅうはち'));
assert.ok(readings('四十七').includes('よんじゅうなな'));
assert.ok(readings('四十七').includes('よんじゅうしち'));
assert.ok(readings('九十八').includes('きゅうじゅうはち'));
assert.deepEqual(readings('十'), ['じゅう']);
assert.deepEqual(readings('十一'), ['じゅういち']);
assert.equal(compositionalJapaneseNumberReadings('百'), null);
assert.equal(compositionalJapaneseNumberReadings('第三十五'), null);
assert.equal(compositionalJapaneseNumberReadings('財源'), null);

console.log('Japanese compositional number reading test passed');
