import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-exact-repair-test-'));
try {
  const primaryPath = path.join(directory, 'primary.json');
  const secondaryPath = path.join(directory, 'secondary.json');
  const outPath = path.join(directory, 'plan.json');
  const candidate = {
    entry_id: 10,
    headword: 'fixture',
    sense_id: 20,
    evidence_summary: {
      source_family_count: 2,
      replacement_term_candidates: {
        zh: [{ term: '新词', source_families: ['family-a', 'family-b'], support_policy: 'dual_family' }]
      }
    },
    product_localizations: [{ lang: 'zh', term: '旧词', reading: 'jiù cí', reading_system: 'pinyin', pronunciation: null, pronunciation_system: null, definition: '旧释义' }],
    source_evidence: [
      { link_id: 1, link_valid: true, source_needs_review: 0, source_family: 'family-a', source_lang: 'zh', source_word: '新词', localizations: [{ lang: 'zh', term: '新词' }] },
      { link_id: 2, link_valid: true, source_needs_review: 0, source_family: 'family-b', source_lang: 'zh', source_word: '别词', localizations: [{ lang: 'zh', term: '新词' }] }
    ]
  };
  const patch = {
    sense_id: 20,
    lang: 'zh',
    replacement: { term: '新词', reading: 'xīn cí', reading_system: 'pinyin', pronunciation: null, pronunciation_system: null, definition: '新释义' },
    evidence_link_ids: [1, 2]
  };
  writeReports(primaryPath, secondaryPath, candidate, patch);
  run(primaryPath, secondaryPath, outPath);
  let plan = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(plan.summary.approved_localization_repairs, 1);
  assert.deepEqual(plan.repairs[0].replacement_term_source_families, ['family-a', 'family-b']);

  candidate.source_evidence = candidate.source_evidence.slice(0, 1);
  candidate.evidence_summary.source_family_count = 1;
  candidate.evidence_summary.replacement_term_candidates.zh = [{
    term: '新词', source_families: ['family-a'],
    support_policy: 'semantically_aligned_authoritative_source'
  }];
  patch.evidence_link_ids = [1];
  writeReports(primaryPath, secondaryPath, candidate, patch);
  run(primaryPath, secondaryPath, outPath);
  plan = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(plan.summary.approved_localization_repairs, 0);
  assert.equal(plan.rejected[0].reason, 'replacement_term_without_minimum_independent_source_support');

  candidate.source_evidence[0].source_family = 'cc-cedict';
  candidate.evidence_summary.replacement_term_candidates.zh[0].source_families = ['cc-cedict'];
  writeReports(primaryPath, secondaryPath, candidate, patch);
  run(primaryPath, secondaryPath, outPath);
  plan = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(plan.summary.approved_localization_repairs, 1);
  assert.equal(plan.repairs[0].support_policy, 'semantically_aligned_authoritative_source');
  assert.deepEqual(plan.repairs[0].replacement_term_source_families, ['cc-cedict']);
  console.log('localized sense exact repair plan tests passed');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

function writeReports(primaryPath, secondaryPath, candidate, patch) {
  const proposal = {
    candidate_id: 'fixture:20:zh', valid: true, decision: 'repair', confidence: 0.95,
    candidate, patches: [patch], model: 'primary-fixture'
  };
  fs.writeFileSync(primaryPath, JSON.stringify({ proposals: [proposal] }));
  fs.writeFileSync(secondaryPath, JSON.stringify({ proposals: [{ ...proposal, model: 'secondary-fixture' }] }));
}
function run(primaryPath, secondaryPath, outPath) {
  execFileSync(process.execPath, [
    path.resolve('scripts/create-localized-sense-exact-repair-plan.mjs'),
    '--primary', primaryPath, '--secondary', secondaryPath, '--out', outPath
  ], { stdio: 'pipe' });
}
