#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-jmdict-preflight-'));
try {
  const reportPath = path.join(tempDir, 'report.json');
  const jmdictPath = path.join(tempDir, 'JMdict_e.gz');
  const outPath = path.join(tempDir, 'out.json');
  fs.writeFileSync(reportPath, JSON.stringify({ selected: [
    { source_entry_id: 1, first_sense_id: 1, source_lang: 'ja', word: '央' },
    { source_entry_id: 2, first_sense_id: 2, source_lang: 'ja', word: '眺める' }
  ] }), 'utf8');
  fs.writeFileSync(jmdictPath, zlib.gzipSync(`
    <JMdict><entry><k_ele><keb>眺める</keb></k_ele><r_ele><reb>ながめる</reb></r_ele></entry></JMdict>
  `));

  const result = spawnSync(process.execPath, [
    path.resolve('scripts/filter-dictionary-v2-source-gap-jmdict-generation-preflight.mjs'),
    '--report', reportPath,
    '--jmdict', jmdictPath,
    '--out', outPath
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const output = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(output.selected_count, 1);
  assert.equal(output.selected[0].word, '眺める');
  assert.equal(output.jmdict_preflight_summary.rejected_by_reason.ja_single_character_source_gap, 1);
  assert.equal(output.selection_policy.reject_ja_single_character_source_gap, true);
  console.log('JMdict generation preflight regression passed.');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
