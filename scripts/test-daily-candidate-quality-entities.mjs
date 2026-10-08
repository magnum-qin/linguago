import assert from 'node:assert/strict';
import { dailyCandidateReasons } from './lib/daily-candidate-quality.mjs';

const reasons = (gloss) => dailyCandidateReasons({
  word: 'example', source_lang: 'en', first_sense_id: 1,
  frequency_rank: 100, gloss_key: gloss, production_lane: 'additional_sense'
});
for (const gloss of ['Person (1952-), prime minister', 'Example (publisher)', 'Tigers (usu. sports team)']) {
  assert.ok(reasons(gloss).includes('biographical_or_named_organization'), gloss);
}
for (const gloss of [
  'Zhang Ziyi (1979-), PRC actress',
  'Tibet Autonomous Region, capital Lhasa',
  'Xianbei, group of northern nomadic peoples'
]) {
  const expected = gloss.includes('(1979-)') ? 'biographical_or_named_organization' : 'geopolitical_or_historical_group';
  assert.ok(reasons(gloss).includes(expected), gloss);
}
assert.ok(reasons('erhua variant of another form').includes('form_redirect_deferred'));
assert.ok(reasons('Rank (name)').includes('explicit_named_entity'));
assert.deepEqual(reasons('name'), []);
for (const gloss of ['gang rape', 'adult video', 'pornographic film']) assert.ok(reasons(gloss).includes('non_neutral_daily_scope'));
assert.deepEqual(reasons('adult'), []);
const regional = (gloss) => dailyCandidateReasons({ word: '贴图', source_lang: 'zh', first_sense_id: 1, frequency_rank: 100, gloss_key: gloss });
assert.ok(regional('sticker (social messaging) (Tw)').includes('mainland_equivalent_review_required'));
assert.ok(regional('sticker (Taiwan usage)').includes('mainland_equivalent_review_required'));
assert.deepEqual(regional('to apply a texture'), []);
assert.ok(reasons('prefectural magistrate (during Tang to Qing times)').includes('historical_daily_scope_deferred'));
const jaRow = (part_of_speech, gloss, word = 'する') => dailyCandidateReasons({
  word, source_lang: 'ja', first_sense_id: 1, frequency_rank: 100,
  gloss_key: gloss, part_of_speech, production_lane: 'new_headword',
  daily_sense_selection: { alternatives: [{ id: 1, score: 5_000, gloss }] }
});
assert.ok(jaRow('&aux-v;', 'indicates the potential form', 'れる').includes('japanese_grammatical_fragment'));
assert.ok(jaRow('&suf;', '-ish', 'らしい').includes('japanese_grammatical_fragment'));
assert.ok(jaRow('&exp;', 'to have ...-ed', 'てる').includes('japanese_grammatical_expression_deferred'));
assert.deepEqual(jaRow('&exp;', 'as a teacher', 'として'), []);
const zhRow = (word, source_word, gloss) => dailyCandidateReasons({
  word, source_word, source_lang: 'zh', first_sense_id: 1, frequency_rank: 100,
  gloss_key: gloss, production_lane: 'new_headword',
  daily_sense_selection: { alternatives: [{ id: 1, score: 5_000, gloss }] }
});
assert.ok(zhRow('怎幺回事', '怎么回事', "what's going on?").includes('noncanonical_native_form'));
assert.ok(zhRow('孙中山', '孙中山', 'same as 孫逸仙|孙逸仙').includes('dictionary_redirect_deferred'));
for (const gloss of ['(PLA) military district', 'poverty alleviation', 'government minister', 'output value']) {
  assert.ok(zhRow('例词', '例词', gloss).includes('administrative_or_historical_daily_scope'), gloss);
}
for (const gloss of ['army', 'body', 'book', 'to help a poor person']) {
  assert.deepEqual(zhRow('例词', '例词', gloss), [], gloss);
}
assert.ok(zhRow('日至', '日至', 'the winter solstice 冬至 and summer solstice 夏至').includes('specialized_calendar_or_official_scope'));
for (const gloss of ['Shijing, the Book of Songs, early collection of Chinese poems and one of the Five Classics of Confucianism', 'novel by Dickens']) {
  assert.ok(reasons(gloss).includes('named_literary_work_deferred'), gloss);
}
for (const gloss of ['meninges', 'meninx', 'dura mater']) {
  assert.ok(reasons(gloss).includes('specialized_anatomy_deferred'), gloss);
}
assert.ok(reasons('Mercury (god)').includes('named_person_or_deity'));
assert.ok(reasons('Moses (Catholic translation)').includes('named_person_or_deity'));
assert.ok(reasons('lieutenant general').includes('military_rank_deferred'));
assert.ok(dailyCandidateReasons({
  word: '陸将', source_lang: 'ja', first_sense_id: 1, frequency_rank: 100,
  gloss_key: 'general', production_lane: 'new_headword',
  daily_sense_selection: { alternatives: [{ id: 1, score: 10, gloss: 'general' }, { id: 2, score: 9, gloss: 'lieutenant general' }] }
}).includes('military_rank_deferred'));
assert.ok(reasons('morphine').includes('specialized_substance_deferred'));
assert.ok(reasons('angel (loanword)').includes('transliterated_named_concept'));
for (const gloss of ['book', 'collection of poems', 'novel', 'brain', 'skin', 'headache', 'hospital', 'medicine', 'blood test']) {
  assert.deepEqual(reasons(gloss), [], gloss);
}
for (const gloss of ['prime minister', 'publisher', 'sports team', 'Mont Blanc (chestnut and cream dessert)', 'rescue team']) {
  assert.deepEqual(reasons(gloss), [], gloss);
}

// B21 regression tests: grammar fragments & proper/historical terms
assert.ok(jaRow(null, 'be', 'れる').includes('japanese_grammatical_fragment'), 'れる without pos');
assert.ok(jaRow(null, 'bid for', 'せる').includes('japanese_grammatical_fragment'), 'せる without pos');
assert.ok(jaRow('&v1;', 'to make do', 'させる').includes('japanese_grammatical_fragment'), 'させる');
assert.ok(zhRow('孙中山', '孙中山', 'Dr Sun Yat-sen (1866-1925), first president of the Republic of China').includes('biographical_or_named_organization'), '孙中山');
assert.ok(zhRow('尚书', '尚书', 'Book of History, one of the Five Classics').includes('named_literary_work_deferred'), '尚书 book');
assert.ok(zhRow('尚书', '尚书', 'government minister').includes('administrative_or_historical_daily_scope'), '尚书 minister');
assert.ok(zhRow('军区', '军区', 'geographical area of command').includes('administrative_or_historical_daily_scope'), '军区 area of command');

console.log('daily candidate entity and redirect tests passed');

