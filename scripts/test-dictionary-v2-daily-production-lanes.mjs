#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dailyCandidateReasons } from './lib/daily-candidate-quality.mjs';

const secondary = { word: 'example', source_lang: 'en', frequency_rank: 100, first_sense_id: 2, gloss_key: 'secondary sense', daily_sense_selection: { alternatives: [{ id: 1, score: 8800 }, { id: 2, score: 6700 }] } };
assert.ok(dailyCandidateReasons(secondary, 'new_headword').includes('higher_priority_sense_skipped'));
assert.ok(!dailyCandidateReasons(secondary, 'additional_sense').includes('higher_priority_sense_skipped'));
const linkedHigherPriority = {
  ...secondary,
  daily_sense_selection: {
    alternatives: [
      { id: 1, score: 9_000, linked_product_sense: { id: 123 } },
      { id: 2, score: 6_700 }
    ]
  }
};
assert.ok(!dailyCandidateReasons(linkedHigherPriority, 'new_headword').includes('higher_priority_sense_skipped'));
const attemptedHigherPriority = {
  ...secondary,
  daily_sense_selection: {
    alternatives: [
      { id: 1, score: 9_000, attempted_source_sense: true },
      { id: 2, score: 6_700 }
    ]
  }
};
assert.ok(!dailyCandidateReasons(attemptedHigherPriority, 'new_headword').includes('higher_priority_sense_skipped'));
// A new daily headword must not fall back to a leftover sense when the
// entry's primary sense was already attempted or linked.
const attemptedPrimaryFallback = {
  ...secondary,
  first_sense_id: 1413220,
  gloss_key: 'to sell off (something unneeded)',
  daily_sense_selection: {
    alternatives: [
      { id: 1413217, sense_order: 1, score: 9_800, attempted_source_sense: true },
      { id: 1413220, sense_order: 4, score: 7_650 }
    ]
  }
};
assert.ok(dailyCandidateReasons(attemptedPrimaryFallback, 'new_headword').includes('primary_sense_attempted_no_daily_fallback'));
assert.ok(!dailyCandidateReasons(attemptedPrimaryFallback, 'additional_sense').includes('primary_sense_attempted_no_daily_fallback'));
const linkedPrimaryFallback = {
  ...attemptedPrimaryFallback,
  daily_sense_selection: {
    alternatives: [
      { id: 1413217, sense_order: 1, score: 9_800, linked_product_sense: { id: 77 } },
      { id: 1413220, sense_order: 4, score: 7_650 }
    ]
  }
};
assert.ok(dailyCandidateReasons(linkedPrimaryFallback, 'new_headword').includes('primary_sense_attempted_no_daily_fallback'));
const primarySelectedRow = {
  ...secondary,
  first_sense_id: 1,
  daily_sense_selection: {
    alternatives: [
      { id: 1, sense_order: 1, score: 9_800 },
      { id: 2, sense_order: 2, score: 6_700 }
    ]
  }
};
assert.ok(!dailyCandidateReasons(primarySelectedRow, 'new_headword').includes('primary_sense_attempted_no_daily_fallback'));
// Unattempted primary still keeps the ordinary skipped-priority rejection.
const unattemptedPrimaryFallback = {
  ...attemptedPrimaryFallback,
  daily_sense_selection: {
    alternatives: [
      { id: 1413217, sense_order: 1, score: 9_800 },
      { id: 1413220, sense_order: 4, score: 7_650 }
    ]
  }
};
assert.ok(dailyCandidateReasons(unattemptedPrimaryFallback, 'new_headword').includes('higher_priority_sense_skipped'));
assert.ok(!dailyCandidateReasons(unattemptedPrimaryFallback, 'new_headword').includes('primary_sense_attempted_no_daily_fallback'));
const ministryGloss = { word: '厚生', source_lang: 'ja', frequency_rank: 5_278, first_sense_id: 1, gloss_key: '(former) Ministry of Health and Welfare' };
assert.ok(dailyCandidateReasons(ministryGloss, 'new_headword').includes('administrative_or_historical_daily_scope'));
const warringStatesGloss = { word: '戦国', source_lang: 'ja', frequency_rank: 5_008, first_sense_id: 1, gloss_key: 'Warring States period (Japan, China)' };
assert.ok(dailyCandidateReasons(warringStatesGloss, 'new_headword').includes('historical_daily_scope_deferred'));
const patternGloss = { word: '有没有', source_lang: 'zh', frequency_rank: 843, first_sense_id: 2, gloss_key: 'Is there a ...?' };
assert.ok(dailyCandidateReasons(patternGloss, 'new_headword').includes('pattern_fragment_gloss_deferred'));
const grammarPatternGloss = { word: '有没有', source_lang: 'zh', frequency_rank: 843, first_sense_id: 1, gloss_key: '(before a verb) Did (you, they etc) (verb, infinitive)?' };
assert.ok(dailyCandidateReasons(grammarPatternGloss, 'new_headword').includes('pattern_fragment_gloss_deferred'));
const prepositionGloss = { word: '趁', source_lang: 'zh', frequency_rank: 9_000, first_sense_id: 1, gloss_key: '(before a noun) to take advantage of' };
assert.ok(!dailyCandidateReasons(prepositionGloss, 'new_headword').includes('pattern_fragment_gloss_deferred'));
const placeNameGloss = { word: '永安', source_lang: 'zh', frequency_rank: 17_928, first_sense_id: 1, gloss_key: "Yong'an, the name of numerous other places" };
assert.ok(dailyCandidateReasons(placeNameGloss, 'new_headword').includes('geopolitical_or_historical_group'));
const hanRedirectGloss = { word: '虎门', source_lang: 'zh', frequency_rank: 20_000, first_sense_id: 1, gloss_key: 'Humen Town 虎門鎮|虎门镇[Hu3 men2 Zhen4]' };
assert.ok(dailyCandidateReasons(hanRedirectGloss, 'new_headword').includes('nonlatin_gloss_redirect'));
const reignNameGloss = { word: '嘉定', source_lang: 'zh', frequency_rank: 19_000, first_sense_id: 1, gloss_key: 'final reign name 1208-1224 of South Song emperor Ningzong 寧宗|宁宗[Ning2 zong1]' };
const reignReasons = dailyCandidateReasons(reignNameGloss, 'new_headword');
assert.ok(reignReasons.includes('historical_daily_scope_deferred') || reignReasons.includes('biographical_or_named_organization') || reignReasons.includes('nonlatin_gloss_redirect'));
const brandGloss = { word: '丰田', source_lang: 'zh', frequency_rank: 19_000, first_sense_id: 1, gloss_key: 'Toyota, Japanese car make' };
assert.ok(dailyCandidateReasons(brandGloss, 'new_headword').includes('biographical_or_named_organization'));
const scholarGloss = { word: '德雷尔', source_lang: 'zh', frequency_rank: 21_000, first_sense_id: 1, gloss_key: 'June Teufel Dreyer, China expert at Univ. of Miami and Foreign Policy' };
assert.ok(dailyCandidateReasons(scholarGloss, 'new_headword').includes('biographical_or_named_organization'));
const biblicalGloss = { word: '约伯', source_lang: 'zh', frequency_rank: 22_000, first_sense_id: 1, gloss_key: 'Book of Job in the Old Testament' };
assert.ok(dailyCandidateReasons(biblicalGloss, 'new_headword').includes('named_literary_work_deferred'));
const cadreGloss = { word: '下放', source_lang: 'zh', frequency_rank: 23_000, first_sense_id: 1, gloss_key: 'to demote a party cadre to work on the shop floor or in the countryside' };
assert.ok(dailyCandidateReasons(cadreGloss, 'new_headword').includes('administrative_or_historical_daily_scope'));
const idiomComponentGloss = { word: '星火', source_lang: 'zh', frequency_rank: 24_000, first_sense_id: 1, gloss_key: 'meteor trail (mostly used in expressions like 急如星火)' };
assert.ok(dailyCandidateReasons(idiomComponentGloss, 'new_headword').includes('idiom_component_deferred'));
const pronunciationOnlyGloss = { word: '只当', source_lang: 'zh', frequency_rank: 25_000, first_sense_id: 1, gloss_key: 'Taiwan pr. [zhi3dang1]' };
assert.ok(dailyCandidateReasons(pronunciationOnlyGloss, 'new_headword').includes('pronunciation_note_only_gloss'));
const qingResortGloss = { word: '热河', source_lang: 'zh', frequency_rank: 26_000, first_sense_id: 1, gloss_key: 'refers to the Qing imperial resort at Chengde' };
assert.ok(dailyCandidateReasons(qingResortGloss, 'new_headword').includes('historical_daily_scope_deferred'));
const texasGloss = { word: '奥斯丁', source_lang: 'zh', frequency_rank: 27_000, first_sense_id: 1, gloss_key: 'Austin, Texas' };
assert.ok(dailyCandidateReasons(texasGloss, 'new_headword').includes('geopolitical_or_historical_group'));
const yorkshireGloss = { word: '哈利法克斯', source_lang: 'zh', frequency_rank: 28_000, first_sense_id: 1, gloss_key: 'Halifax, town in West Yorkshire, England' };
assert.ok(dailyCandidateReasons(yorkshireGloss, 'new_headword').includes('geopolitical_or_historical_group'));
const mtGloss = { word: '庐山', source_lang: 'zh', frequency_rank: 29_000, first_sense_id: 1, gloss_key: 'Mt Lushan in Jiujiang, famous as summer holiday spot' };
assert.ok(dailyCandidateReasons(mtGloss, 'new_headword').includes('geopolitical_or_historical_group'));
const altNameGloss = { word: '花都', source_lang: 'zh', frequency_rank: 30_000, first_sense_id: 1, gloss_key: 'alternative name for Paris' };
assert.ok(dailyCandidateReasons(altNameGloss, 'new_headword').includes('geopolitical_or_historical_group'));
const centuryStateGloss = { word: '吐谷浑', source_lang: 'zh', frequency_rank: 31_000, first_sense_id: 1, gloss_key: 'a state in Qinghai in 4th-7th century AD' };
assert.ok(dailyCandidateReasons(centuryStateGloss, 'new_headword').includes('historical_daily_scope_deferred'));
const translationGloss = { word: '猪八戒', source_lang: 'zh', frequency_rank: 32_000, first_sense_id: 1, gloss_key: "Pigsy in Arthur Waley's translation" };
assert.ok(dailyCandidateReasons(translationGloss, 'new_headword').includes('geopolitical_or_historical_group'));
const formerTimesGloss = { word: '书馆', source_lang: 'zh', frequency_rank: 33_000, first_sense_id: 1, gloss_key: '(in former times) private school' };
assert.ok(dailyCandidateReasons(formerTimesGloss, 'new_headword').includes('historical_daily_scope_deferred'));
const plainCityPair = { word: '平安', source_lang: 'zh', frequency_rank: 34_000, first_sense_id: 1, gloss_key: 'safe and sound' };
assert.ok(!dailyCandidateReasons(plainCityPair, 'new_headword').includes('geopolitical_or_historical_group'));
assert.ok(!dailyCandidateReasons({ ...patternGloss, gloss_key: 'not bad; pretty good' }, 'new_headword').includes('pattern_fragment_gloss_deferred'));
const unlinkedHigherPriority = {
  ...linkedHigherPriority,
  daily_sense_selection: {
    alternatives: [
      { id: 1, score: 9_000 },
      { id: 2, score: 6_700 }
    ]
  }
};
assert.ok(dailyCandidateReasons(unlinkedHigherPriority, 'new_headword').includes('higher_priority_sense_skipped'));
const freedict = { ...secondary, source_lang: 'pt-BR', daily_sense_selection: { alternatives: [{ id: 2, source: 'freedict-por-eng', score: 9500 }] } };
assert.ok(dailyCandidateReasons(freedict, 'new_headword').includes('freedict_pt_primary_requires_evidence_review'));
assert.ok(dailyCandidateReasons(freedict, 'additional_sense').includes('freedict_pt_primary_requires_evidence_review'));
assert.ok(!dailyCandidateReasons({ ...freedict, source_lang: 'en' }, 'new_headword').includes('freedict_pt_primary_requires_evidence_review'));
// Per-sense calls carry the sense's own source; the quarantine must also
// fire there so the selector blocks the freedict alternative at binding time
// and falls through to the omw/wikdict sense of the same entry.
const freedictSenseOnly = { word: 'freguesia', source_lang: 'pt-BR', frequency_rank: 900, first_sense_id: 5, source: 'freedict-por-eng', gloss_key: 'parish' };
assert.ok(dailyCandidateReasons(freedictSenseOnly, 'new_headword').includes('freedict_pt_primary_requires_evidence_review'));
const omwSenseOnly = { ...freedictSenseOnly, source: 'omw-30', gloss_key: 'parish' };
assert.ok(!dailyCandidateReasons(omwSenseOnly, 'new_headword').includes('freedict_pt_primary_requires_evidence_review'));
const wikdictSenseOnly = { ...freedictSenseOnly, source: 'wikdict-pt-en', gloss_key: 'parish' };
assert.ok(!dailyCandidateReasons(wikdictSenseOnly, 'new_headword').includes('freedict_pt_primary_requires_evidence_review'));
const multilangArtifactGloss = { word: 'purê', source_lang: 'pt-BR', frequency_rank: 10_780, first_sense_id: 9, gloss_key: 'en: gruel' };
assert.ok(dailyCandidateReasons(multilangArtifactGloss, 'new_headword').includes('multilang_gloss_artifact'));
const multilangPipeArtifactGloss = { word: 'detrás', source_lang: 'pt-BR', frequency_rank: 11_542, first_sense_id: 4, gloss_key: 'en: aback | ja: 裏帆' };
assert.ok(dailyCandidateReasons(multilangPipeArtifactGloss, 'new_headword').includes('multilang_gloss_artifact'));
assert.ok(!dailyCandidateReasons(wikdictSenseOnly, 'new_headword').includes('multilang_gloss_artifact'));
assert.ok(dailyCandidateReasons({ ...secondary, gloss_key: 'abbr. for an organization' }, 'additional_sense').includes('abbreviation_redirect_deferred'));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-daily-lanes-'));
const headwords = path.join(root, 'headwords.json');
const additional = path.join(root, 'additional.json');
const out = path.join(root, 'out.json');
fs.writeFileSync(headwords, JSON.stringify({ selected: [row(1, 11, 'zh'), row(2, 22, 'ja')] }));
fs.writeFileSync(additional, JSON.stringify({ selected: [row(3, 33, 'pt-BR'), row(1, 11, 'zh')] }));
execFileSync(process.execPath, ['scripts/merge-dictionary-v2-daily-production-lanes.mjs', '--headwords', headwords, '--additional-senses', additional, '--out', out, '--headword-limit', '2', '--additional-sense-limit', '2'], { cwd: path.resolve('.') });
const report = JSON.parse(fs.readFileSync(out, 'utf8'));
assert.equal(report.selected_count, 3);
assert.deepEqual(report.summary.selected_by_lane, { new_headword: 2, additional_sense: 1 });
assert.equal(report.selected.filter((item) => item.production_lane === 'additional_sense').length, 1);
console.log(JSON.stringify({ ok: true, selected_count: report.selected_count }));

function row(source_entry_id, source_sense_id, source_lang) {
  return { source_entry_id, source_sense_id, source_lang, word: `w${source_entry_id}` };
}
