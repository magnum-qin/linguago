#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const reportScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'report-dictionary-v2-remote-production-funnel.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-funnel-'));
const run = path.join(root, 'runs', 'fixture');
const batch = path.join(root, 'batches', 'fixture.json');
const out = path.join(root, 'out.json');
fs.mkdirSync(run, { recursive: true });
fs.mkdirSync(path.dirname(batch), { recursive: true });

write(batch, { selected: [candidate(1), candidate(2), candidate(3), candidate(4)] });
write(path.join(run, 'manifest.json'), { input: 'batches/fixture.json', summary: { input: 4 } });
write(path.join(run, '00a-daily-primary-senses-rejected.json'), {
  rejected: [{ ...candidate(1), reason: 'no_eligible_source_sense' }]
});
write(path.join(run, '00-production-prefilter-rejected.json'), {
  selected: [{ ...candidate(2), production_prefilter: { reason: 'explicit_proper_name' } }]
});
write(path.join(run, '00b-source-sense-alignment-rejected.json'), {
  rejected: [{ ...candidate(3), sense_alignment: { reason: 'ambiguous_best_sense' } }]
});
write(path.join(run, '00b-source-sense-aligned.json'), {
  selected: [{ ...candidate(4, 44) }]
});
write(path.join(run, '00c-reverse-evidence-prefilter-details.json'), {
  validations: [{ ...candidate(4, 44), decision: 'supported', reason: null }]
});
write(path.join(run, '00c-reverse-evidence-prefilter.json'), {
  selected: [{ ...candidate(4, 44) }]
});
write(path.join(run, '03-gemma-source-review.json'), {
  reviews: [{ ...candidate(4, 44), valid: true, approved: true, decision: 'accept' }]
});
write(path.join(run, '04b-source-consensus-reverse-evidence.json'), {
  validations: [{ ...candidate(4, 44), decision: 'supported' }]
});
write(path.join(run, '04d-semantic-preview-gemma.json'), {
  reviews: [{ ...candidate(4, 44), consensus_accepted: true }]
});
write(path.join(run, '04f-generation-ready-candidates.json'), {
  selected: [{ ...candidate(4, 44) }],
  jmdict_preflight_rejected: []
});
write(path.join(run, '05-qwen-generation.json'), {
  generated: [{ ...candidate(4, 44), valid: true }]
});
write(path.join(run, '07-final-gemma.json'), {
  reviews: [{ ...candidate(4, 44), consensus_accepted: true }]
});
write(path.join(run, '08-controlled-replay.json'), {
  selected: [{ ...candidate(4, 44) }],
  rejected: []
});

execFileSync(process.execPath, [
  reportScript,
  '--root', root,
  '--run-dirs', 'runs/fixture',
  '--out', out
]);
const report = JSON.parse(fs.readFileSync(out, 'utf8'));
assert.equal(report.ok, true);
assert.equal(report.summary.input, 4);
assert.equal(report.summary.accepted, 1);
assert.deepEqual(report.summary.stages, {
  accepted: 1,
  daily_primary: 1,
  production_policy: 1,
  source_sense_alignment: 1
});
assert.equal(report.summary.repair_lanes.source_index_repair, 1);
assert.equal(report.summary.repair_lanes.excluded_policy, 1);
assert.equal(report.summary.repair_lanes.source_alignment_repair, 1);

fs.rmSync(path.join(run, '00c-reverse-evidence-prefilter-details.json'));
fs.rmSync(path.join(run, '00c-reverse-evidence-prefilter.json'));
execFileSync(process.execPath, [
  reportScript,
  '--root', root,
  '--run-dirs', 'runs/fixture',
  '--out', out
]);
const legacyReport = JSON.parse(fs.readFileSync(out, 'utf8'));
assert.equal(legacyReport.ok, true);
assert.equal(legacyReport.summary.accepted, 1);
console.log(JSON.stringify({ ok: true, input: report.summary.input }));

function candidate(entry, sense = null) {
  return {
    source_entry_id: entry,
    source_sense_id: sense,
    word: `word-${entry}`,
    source_lang: entry % 2 ? 'zh' : 'ja',
    frequency_rank: entry
  };
}

function write(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
