#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-production-prefilter-'));
const reportPath = path.join(directory, 'input.json');
const outPath = path.join(directory, 'out.json');
const rejectedPath = path.join(directory, 'rejected.json');
const selected = [
  row(1, 'zh', '银行', 'bank'),
  row(2, 'ja', 'テスト', 'test'),
  row(3, 'pt-BR', 'status', 'status'),
  row(4, 'en', 'Peter', 'given name'),
  row(5, 'en', 'deals', 'n agreement\\nn cards held\\nv sell\\nv distribute\\nv manage'),
  row(6, 'zh', 'latin-only', 'invalid Chinese anchor'),
  row(7, 'zh', '三十五', 'thirty-five'),
  row(8, 'ja', '四十八', 'forty-eight'),
  row(9, 'zh', '三', 'three'),
  row(10, 'en', 'enchanted', 'enchanted'),
  row(11, 'en', 'Minnesota', 'Minnesota'),
  row(12, 'en', 'A', 'letter A'),
  row(13, 'en', 'TV', 'television'),
  row(14, 'en', '6th', 'sixth'),
  row(15, 'pt-BR', 'AM', 'amplitude modulation'),
  row(16, 'en', 'xii', 'twelve'),
  row(17, 'en', 'XIV', 'fourteen'),
  row(18, 'ja', '横浜', 'Yokohama (city)'),
  row(19, 'zh', '江苏', 'see 江蘇省|江苏省[Jiang1 su1 Sheng3]'),
  row(20, 'zh', '新华社', "Xinhua News Agency, official press agency of the People's Republic of China"),
  row(21, 'zh', '城市', 'city'),
  row(22, 'ja', '大学', 'university'),
  row(23, 'zh', '中华人民共和国', "People's Republic of China"),
  row(24, 'ja', '自民党', 'Liberal Democratic Party'),
  row(25, 'zh', '鲁迅', 'Lu Xun (1881-1936), Chinese writer'),
  row(26, 'ja', '九州', 'Kyushu (southernmost of the four main islands of Japan)'),
  row(27, 'ja', '富士山', 'Mount Fuji'),
  row(28, 'ja', '任天堂', 'Nintendo'),
  row(29, 'zh', '第二次世界大战', 'World War II'),
  row(30, 'zh', '戏曲', 'Chinese opera'),
  row(31, 'zh', '世界卫生组织', 'World Health Organization (WHO)'),
  row(32, 'zh', '纽西兰', 'New Zealand (Tw)'),
  row(33, 'zh', '第一夫人', 'First Lady (wife of the head of state)')
];
fs.writeFileSync(reportPath, `${JSON.stringify({ ok: true, selected_count: selected.length, selected })}\n`);

const result = spawnSync(process.execPath, [
  'scripts/filter-dictionary-v2-production-batch.mjs',
  '--report', reportPath,
  '--out', outPath,
  '--rejected-out', rejectedPath
], { cwd: process.cwd(), encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr || result.stdout);
const output = JSON.parse(fs.readFileSync(outPath, 'utf8'));
const rejected = JSON.parse(fs.readFileSync(rejectedPath, 'utf8'));
assert.deepEqual(output.selected.map((item) => item.source_entry_id), [1, 2, 3, 9, 21, 22, 30, 33]);
assert.deepEqual(rejected.selected.map((item) => item.production_prefilter.reason), [
  'explicit_proper_name',
  'english_inflected_form',
  'source_language_mismatch',
  'compositional_number',
  'compositional_number',
  'english_inflected_form',
  'capitalized_name_like',
  'low_value_letter_abbreviation_or_ordinal',
  'low_value_letter_abbreviation_or_ordinal',
  'low_value_letter_abbreviation_or_ordinal',
  'low_value_letter_abbreviation_or_ordinal',
  'low_value_letter_abbreviation_or_ordinal',
  'low_value_letter_abbreviation_or_ordinal',
  'named_entity_or_dictionary_redirect',
  'named_entity_or_dictionary_redirect',
  'named_entity_or_dictionary_redirect',
  'named_entity_or_dictionary_redirect',
  'named_entity_or_dictionary_redirect',
  'named_entity_or_dictionary_redirect',
  'named_entity_or_dictionary_redirect',
  'named_entity_or_dictionary_redirect',
  'named_entity_or_dictionary_redirect',
  'named_entity_or_dictionary_redirect',
  'named_entity_or_dictionary_redirect',
  'named_entity_or_dictionary_redirect'
]);
assert.equal(output.production_prefilter.summary.input, 33);
assert.equal(output.production_prefilter.summary.selected, 8);
assert.equal(output.production_prefilter.summary.rejected, 25);

const conservativeOutPath = path.join(directory, 'conservative-out.json');
const conservativeRejectedPath = path.join(directory, 'conservative-rejected.json');
const conservative = spawnSync(process.execPath, [
  'scripts/filter-dictionary-v2-production-batch.mjs',
  '--report', reportPath,
  '--out', conservativeOutPath,
  '--rejected-out', conservativeRejectedPath,
  '--exclude-all-capitalized-latin', 'true'
], { cwd: process.cwd(), encoding: 'utf8' });
assert.equal(conservative.status, 0, conservative.stderr || conservative.stdout);
const conservativeOutput = JSON.parse(fs.readFileSync(conservativeOutPath, 'utf8'));
const conservativeRejected = JSON.parse(fs.readFileSync(conservativeRejectedPath, 'utf8'));
assert.equal(conservativeOutput.selected.some((item) => item.word === 'Minnesota'), false);
assert.equal(
  conservativeRejected.selected.find((item) => item.word === 'Minnesota').production_prefilter.reason,
  'capitalized_latin_headword'
);

const authoritativeInputPath = path.join(directory, 'authoritative-input.json');
const authoritativeOutPath = path.join(directory, 'authoritative-out.json');
const authoritativeRejectedPath = path.join(directory, 'authoritative-rejected.json');
fs.writeFileSync(authoritativeInputPath, `${JSON.stringify({ selected: [
  anchoredRow(21, 'zh', '多媒体', 'multimedia', 'cc-cedict'),
  anchoredRow(22, 'ja', '将棋', 'shogi', 'jmdict'),
  anchoredRow(23, 'pt-BR', 'regras', 'menstruation', 'omw-30'),
  anchoredRow(24, 'pt-BR', 'menu', 'menu', 'freedict-por-eng'),
  anchoredRow(25, 'en', 'shack', 'trail behind', 'omw-30'),
  anchoredRow(26, 'en', 'beware', 'be cautious', 'freedict-eng-por')
] })}\n`);
const authoritative = spawnSync(process.execPath, [
  'scripts/filter-dictionary-v2-production-batch.mjs',
  '--report', authoritativeInputPath,
  '--out', authoritativeOutPath,
  '--rejected-out', authoritativeRejectedPath,
  '--require-authoritative-source-sense', 'true'
], { cwd: process.cwd(), encoding: 'utf8' });
assert.equal(authoritative.status, 0, authoritative.stderr || authoritative.stdout);
assert.deepEqual(
  JSON.parse(fs.readFileSync(authoritativeOutPath, 'utf8')).selected.map((item) => item.source_entry_id),
  [21, 22, 24, 26]
);

const ptWikdictInputPath = path.join(directory, 'pt-wikdict-input.json');
const ptWikdictOutPath = path.join(directory, 'pt-wikdict-out.json');
const ptWikdictRejectedPath = path.join(directory, 'pt-wikdict-rejected.json');
fs.writeFileSync(ptWikdictInputPath, `${JSON.stringify({ selected: [
  anchoredRow(31, 'pt-BR', 'freguesia', 'parish', 'wikdict-pt-en'),
  anchoredRow(32, 'pt-BR', 'vigente', 'in force', 'omw-30'),
  anchoredRow(33, 'zh', '城市', 'city', 'cc-cedict')
] })}\n`);
const ptWikdict = spawnSync(process.execPath, [
  'scripts/filter-dictionary-v2-production-batch.mjs',
  '--report', ptWikdictInputPath,
  '--out', ptWikdictOutPath,
  '--rejected-out', ptWikdictRejectedPath,
  '--require-authoritative-source-sense', 'true',
  '--allow-pt-br-omw-source', 'true',
  '--allow-pt-br-wikdict-source', 'true'
], { cwd: process.cwd(), encoding: 'utf8' });
assert.equal(ptWikdict.status, 0, ptWikdict.stderr || ptWikdict.stdout);
assert.deepEqual(
  JSON.parse(fs.readFileSync(ptWikdictOutPath, 'utf8')).selected.map((item) => item.source_entry_id),
  [31, 32, 33]
);
const ptWikdictDisabled = spawnSync(process.execPath, [
  'scripts/filter-dictionary-v2-production-batch.mjs',
  '--report', ptWikdictInputPath,
  '--out', ptWikdictOutPath,
  '--rejected-out', ptWikdictRejectedPath,
  '--require-authoritative-source-sense', 'true',
  '--allow-pt-br-omw-source', 'true'
], { cwd: process.cwd(), encoding: 'utf8' });
assert.equal(ptWikdictDisabled.status, 0, ptWikdictDisabled.stderr || ptWikdictDisabled.stdout);
assert.deepEqual(
  JSON.parse(fs.readFileSync(ptWikdictOutPath, 'utf8')).selected.map((item) => item.source_entry_id),
  [32, 33]
);

const zhKaikkiInputPath = path.join(directory, 'zh-kaikki-input.json');
const zhKaikkiOutPath = path.join(directory, 'zh-kaikki-out.json');
const zhKaikkiRejectedPath = path.join(directory, 'zh-kaikki-rejected.json');
fs.writeFileSync(zhKaikkiInputPath, `${JSON.stringify({ selected: [
  anchoredRow(41, 'zh', '漏掉', 'to leave out', 'kaikki-zh'),
  anchoredRow(42, 'zh', '糊弄', 'to go through the motions', 'cc-cedict')
] })}\n`);
const zhKaikki = spawnSync(process.execPath, [
  'scripts/filter-dictionary-v2-production-batch.mjs',
  '--report', zhKaikkiInputPath,
  '--out', zhKaikkiOutPath,
  '--rejected-out', zhKaikkiRejectedPath,
  '--require-authoritative-source-sense', 'true',
  '--allow-zh-kaikki-source', 'true'
], { cwd: process.cwd(), encoding: 'utf8' });
assert.equal(zhKaikki.status, 0, zhKaikki.stderr || zhKaikki.stdout);
assert.deepEqual(
  JSON.parse(fs.readFileSync(zhKaikkiOutPath, 'utf8')).selected.map((item) => item.source_entry_id),
  [41, 42]
);
const zhKaikkiDisabled = spawnSync(process.execPath, [
  'scripts/filter-dictionary-v2-production-batch.mjs',
  '--report', zhKaikkiInputPath,
  '--out', zhKaikkiOutPath,
  '--rejected-out', zhKaikkiRejectedPath,
  '--require-authoritative-source-sense', 'true'
], { cwd: process.cwd(), encoding: 'utf8' });
assert.equal(zhKaikkiDisabled.status, 0, zhKaikkiDisabled.stderr || zhKaikkiDisabled.stdout);
assert.deepEqual(
  JSON.parse(fs.readFileSync(zhKaikkiOutPath, 'utf8')).selected.map((item) => item.source_entry_id),
  [42]
);
console.log('production batch prefilter tests passed');

function row(id, sourceLang, word, gloss) {
  return {
    source_entry_id: id,
    first_sense_id: id,
    source_lang: sourceLang,
    word,
    gloss_key: gloss
  };
}

function anchoredRow(id, sourceLang, word, gloss, source) {
  return {
    ...row(id, sourceLang, word, gloss),
    daily_sense_selection: { alternatives: [{ id, source }] }
  };
}
