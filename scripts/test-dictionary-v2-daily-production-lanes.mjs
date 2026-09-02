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
const freedict = { ...secondary, source_lang: 'pt-BR', daily_sense_selection: { alternatives: [{ id: 2, source: 'freedict-por-eng', score: 9500 }] } };
assert.ok(dailyCandidateReasons(freedict, 'new_headword').includes('freedict_pt_primary_requires_evidence_review'));
assert.ok(dailyCandidateReasons(freedict, 'additional_sense').includes('freedict_pt_primary_requires_evidence_review'));
assert.ok(!dailyCandidateReasons({ ...freedict, source_lang: 'en' }, 'new_headword').includes('freedict_pt_primary_requires_evidence_review'));
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
