import assert from 'node:assert/strict';
import { indexJmdictMetadata, matchJmdictMetadata, boundJmdictMetadata } from './lib/jmdict-review-metadata.mjs';
const entry = { ent_seq: '1', k_ele: [{ keb: 'A' }, { keb: 'B' }], r_ele: [{ reb: 'a', re_restr: 'A' }, { reb: 'b', re_restr: 'B' }], sense: [
  { stagk: 'A', stagr: 'a', pos: '&n;', misc: '&product;', gloss: ['test', { '#text': 'explanation', '@_g_type': 'expl' }] },
  { stagk: 'B', stagr: 'b', gloss: 'other' }
] };
const index = indexJmdictMetadata([entry]);
assert.equal(matchJmdictMetadata(index, { word: 'B', gloss_key: 'test', first_sense_id: 9 }).status, 'unmatched');
const match = matchJmdictMetadata(index, { word: 'A', gloss_key: 'test', first_sense_id: 9 });
assert.equal(match.status, 'exact');
assert.ok(boundJmdictMetadata({ word: 'A', gloss_key: 'test', source_lang: 'ja', first_sense_id: 9, native_review_metadata: match }));
assert.equal(boundJmdictMetadata({ word: 'A', gloss_key: 'changed', source_lang: 'ja', first_sense_id: 9, native_review_metadata: match }), null);
assert.deepEqual(match.matches[0].readings, ['a']);
assert.deepEqual(match.matches[0].register, ['&product;']);
assert.deepEqual(index.get('B')[0].part_of_speech, ['&n;']);
assert.equal(matchJmdictMetadata(indexJmdictMetadata([entry, entry]), { word: 'A', gloss_key: 'test' }).status, 'ambiguous');
console.log('JMdict metadata tests passed');
