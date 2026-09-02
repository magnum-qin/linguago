#!/usr/bin/env node

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-additional-sense-'));
const sourceDbPath = path.join(directory, 'source.db');
const productDbPath = path.join(directory, 'product.db');
const reportPath = path.join(directory, 'report.json');

createSourceDb(sourceDbPath);
createProductDb(productDbPath);
fs.writeFileSync(reportPath, JSON.stringify({ selected: [{
  source_entry_id: 1,
  source_lang: 'zh',
  word: '中',
  normalized_key: '中',
  frequency_rank: 10
}] }));

const ordinary = runSelector(false, 'ordinary');
assert.equal(ordinary.selected.length, 0);
assert.equal(ordinary.rejected[0].reason, 'primary_native_sense_already_linked_use_entry_form_alias');

const additional = runSelector(true, 'additional');
assert.equal(additional.selected.length, 1);
assert.equal(additional.selected[0].first_sense_id, 102);
assert.equal(
  additional.selected[0].daily_sense_selection.policy,
  'native_dictionary_additional_unlinked_sense'
);
assert.equal(additional.selected[0].daily_sense_selection.alternatives[0].id, 102);
assert.equal(additional.selected[0].daily_sense_selection.alternatives[1].id, 101);
assert.equal(additional.selected[0].daily_sense_selection.alternatives[1].linked_product_sense.id, 201);
testAttemptHistorySelectsNextAdditionalSense();
testCandidateBuilder();
testRemoteRunnerParameterPassThrough();
testCompleteAdditionalSenseAlignment();
testScaleCohortAllowsExistingQueryable();
testControlledConsensusAcceptsLockedAdditionalSense();
testControlledConsensusAcceptsLimitedManualEvidence();
testRemoteAttemptIndexPassThrough();
testEntryIdIsNotTreatedAsSourceSenseId();
testOuterAttemptCountLimit();
console.log('additional sense selection tests passed');

function testRemoteRunnerParameterPassThrough() {
  const manager = fs.readFileSync('scripts/manage-remote-dictionary-runner.ps1', 'utf8');
  const pipeline = fs.readFileSync('scripts/run-dictionary-v2-remote-pipeline.mjs', 'utf8');
  const promoter = fs.readFileSync('scripts/promote-dictionary-v2-product-source-gap-drafts.mjs', 'utf8');
  assert.match(manager, /AllowLinkedPrimaryForAdditionalSense = \$AllowLinkedPrimaryForAdditionalSense/u);
  assert.match(manager, /SourceSenseAlignmentMaxLangs = \$SourceSenseAlignmentMaxLangs/u);
  assert.match(manager, /--source-sense-alignment-max-langs/u);
  assert.match(pipeline, /args\['source-sense-alignment-max-langs'\] \|\| '3'/u);
  assert.match(promoter, /row\?\.candidate_lane === 'additional_unlinked_source_sense'/u);
  assert.doesNotMatch(
    promoter.match(/function reportContainsAdditionalSenseLane[\s\S]*?\n\}/u)?.[0] || '',
    /daily_sense_selection\?\.policy/u
  );
}

function testRemoteAttemptIndexPassThrough() {
  const manager = fs.readFileSync('scripts/manage-remote-dictionary-runner.ps1', 'utf8');
  const pipeline = fs.readFileSync('scripts/run-dictionary-v2-remote-pipeline.mjs', 'utf8');
  const orchestrator = fs.readFileSync('scripts/run-remote-dictionary-production-until-release.ps1', 'utf8');
  const batchBuilder = fs.readFileSync('scripts/new-remote-dictionary-production-batch.ps1', 'utf8');
  assert.match(manager, /DailyPrimaryAttemptIndex/u);
  assert.match(manager, /--daily-primary-attempt-index/u);
  assert.match(pipeline, /daily-primary-attempt-index/u);
  assert.match(orchestrator, /build-dictionary-v2-additional-sense-attempt-index\.mjs/u);
  assert.match(orchestrator, /-AdditionalSenseAttemptIndex/u);
  assert.match(orchestrator, /if \(-not \[string\]::IsNullOrWhiteSpace\(\$LangQuotas\)\)/u);
  assert.match(
    orchestrator,
    /CandidateMultiplier = if \(\$CandidateMode -eq 'additional-sense'\) \{ \$AdditionalSenseCandidateMultiplier \}/u
  );
  assert.match(batchBuilder, /\$SelectorArgs \+= @\('--attempt-index', \$ResolvedAttemptIndex\)/u);
  assert.match(batchBuilder, /additional-sense-eligible\.json/u);
  assert.match(batchBuilder, /select-dictionary-v2-product-daily-primary-senses\.mjs/u);
  assert.match(batchBuilder, /additional-sense-trusted\.json/u);
  assert.match(batchBuilder, /filter-dictionary-v2-production-batch\.mjs/u);
  assert.match(batchBuilder, /\$PoolLimit = 50000/u);
  assert.doesNotMatch(batchBuilder, /\$SelectorArgs \+= @\('--attempt-index-max-entry-attempts'/u);
  assert.match(orchestrator, /'-AdditionalSenseMaxEntryAttempts'/u);
}

function testEntryIdIsNotTreatedAsSourceSenseId() {
  const db = new Database(productDbPath);
  db.prepare('INSERT INTO product_sense_source_links VALUES (?, ?, ?, ?)').run(3, 201, 1, 1);
  db.close();
  const poolPath = path.join(directory, 'entry-only-pool.json');
  const outPath = path.join(directory, 'entry-only-selected.json');
  fs.writeFileSync(poolPath, JSON.stringify({ selected: [{
    source_entry_id: 1, source_lang: 'zh', word: '中', normalized_key: '中'
  }] }));
  const result = spawnSync(process.execPath, [
    'scripts/select-dictionary-v2-source-gap-fresh-cohort.mjs',
    '--pool', poolPath, '--product-db', productDbPath, '--limit', '1',
    '--one-per-source-entry', 'true', '--exclude-source-entries', 'false', '--out', outPath
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(output.selected.length, 1);
  assert.equal(output.summary.excluded_by_product, 0);
}

function testOuterAttemptCountLimit() {
  const poolPath = path.join(directory, 'attempt-count-pool.json');
  const attemptPath = path.join(directory, 'attempt-count-index.json');
  const outPath = path.join(directory, 'attempt-count-selected.json');
  fs.writeFileSync(poolPath, JSON.stringify({ selected: [{
    source_entry_id: 999, source_lang: 'en', word: 'sample', normalized_key: 'sample'
  }] }));
  fs.writeFileSync(attemptPath, JSON.stringify({ selected: [1, 2, 3].map((sourceSenseId) => ({
    source_entry_id: 999, source_sense_id: sourceSenseId
  })) }));
  const result = spawnSync(process.execPath, [
    'scripts/select-dictionary-v2-source-gap-fresh-cohort.mjs',
    '--pool', poolPath, '--product-db', productDbPath, '--limit', '1',
    '--one-per-source-entry', 'true', '--exclude-source-entries', 'false',
    '--attempt-index', attemptPath, '--attempt-index-max-entry-attempts', '3',
    '--out', outPath
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  const output = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(output.selected.length, 0);
  assert.equal(output.summary.excluded_by_historical_attempt, 1);
  assert.equal(output.summary.attempt_index_max_entry_attempts, 3);
}

function testCompleteAdditionalSenseAlignment() {
  const inputPath = path.join(directory, 'complete-alignment-input.json');
  fs.writeFileSync(inputPath, JSON.stringify({ selected: [{
    source_entry_id: 1,
    first_sense_id: 102,
    candidate_key: '1:102',
    source_lang: 'zh',
    word: '中'
  }] }));
  const run = (maxLangs, prefix) => {
    const outPath = path.join(directory, `${prefix}-aligned.json`);
    const rejectedPath = path.join(directory, `${prefix}-alignment-rejected.json`);
    const result = spawnSync(process.execPath, [
      'scripts/align-dictionary-v2-product-source-gap-candidate-senses.mjs',
      '--report', inputPath,
      '--source-db', sourceDbPath,
      '--product-db', productDbPath,
      '--out', outPath,
      '--rejected-out', rejectedPath,
      '--min-langs', '2',
      '--max-langs', String(maxLangs),
      '--prefer-current-sense', 'true'
    ], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return {
      selected: JSON.parse(fs.readFileSync(outPath, 'utf8')).selected,
      rejected: JSON.parse(fs.readFileSync(rejectedPath, 'utf8')).rejected
    };
  };
  const ordinary = run(3, 'complete-default');
  assert.equal(ordinary.selected.length, 0);
  assert.equal(ordinary.rejected[0].sense_alignment.reason, 'already_complete_aligned_sense');
  const additional = run(4, 'complete-additional');
  assert.equal(additional.selected.length, 1);
  assert.equal(additional.selected[0].first_sense_id, 102);
  assert.equal(additional.selected[0].first_sense_clean_localization_lang_count, 4);
}

function testControlledConsensusAcceptsLockedAdditionalSense() {
  const reviewPath = path.join(directory, 'additional-review.json');
  const outPath = path.join(directory, 'additional-controlled.json');
  const terms = { en: 'hit', 'pt-BR': 'acertar', zh: '中', ja: '当たる' };
  const definitions = { en: 'To strike a target.', 'pt-BR': 'Atingir um alvo.', zh: '击中目标。', ja: '目標に命中する。' };
  fs.writeFileSync(reviewPath, JSON.stringify({ selected: [{
    source_entry_id: 1,
    first_sense_id: 102,
    product_entry_id: 301,
    candidate_key: '1:102',
    source_lang: 'zh',
    word: '中',
    daily_sense_selection: {
      policy: 'native_dictionary_additional_unlinked_sense',
      requires_independent_source_review: true,
      alternatives: [{ id: 102, source: 'cc-cedict', blocked_reason: null, linked_product_sense: null }]
    },
    candidate_evidence_review: {
      decision: 'accept', confidence: 0.98, risk_flags: [],
      preferred_terms: { zh: '中' }, suggested_terms: terms, definition_contract: definitions
    }
  }] }));
  const result = spawnSync(process.execPath, [
    'scripts/build-dictionary-v2-product-source-gap-controlled-consensus-input.mjs',
    '--review', reviewPath,
    '--out', outPath,
    '--confidence-threshold', '0.9',
    '--allow-unhinted-suggestions', 'true'
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(output.selected.length, 1);
  assert.equal(output.selected[0].first_sense_id, 102);
}

function testControlledConsensusAcceptsLimitedManualEvidence() {
  const reviewPath = path.join(directory, 'limited-manual-review.json');
  const generationPath = path.join(directory, 'limited-manual-generation.json');
  const evidencePath = path.join(directory, 'limited-manual-evidence.json');
  const consensusPath = path.join(directory, 'limited-manual-consensus.json');
  const outPath = path.join(directory, 'limited-manual-controlled.json');
  const terms = { en: 'hit', 'pt-BR': 'acertar', zh: '中', ja: '当たる' };
  const definitions = { en: 'To strike a target.', 'pt-BR': 'Atingir um alvo.', zh: '击中目标。', ja: '目標に命中する。' };
  const candidate = {
    source_entry_id: 1,
    first_sense_id: 102,
    product_entry_id: 301,
    candidate_key: '1:102',
    source_lang: 'zh',
    word: '中',
    daily_sense_selection: {
      policy: 'native_dictionary_additional_unlinked_sense',
      requires_independent_source_review: true,
      alternatives: [{ id: 102, source: 'cc-cedict', blocked_reason: null, linked_product_sense: null }]
    },
    candidate_evidence_review: {
      decision: 'accept', confidence: 0.98, risk_flags: [],
      preferred_terms: { zh: '中' }, suggested_terms: terms, definition_contract: definitions
    }
  };
  const generated = {
    valid: true,
    source_entry_id: 1,
    word: '中',
    output: { source_sense_id: 102, source_word: '中', localizations: Object.fromEntries(
      Object.entries(terms).map(([lang, term]) => [lang, { term, definition: definitions[lang] }])
    ) }
  };
  fs.writeFileSync(reviewPath, JSON.stringify({ selected: [candidate] }));
  fs.writeFileSync(generationPath, JSON.stringify({ generated: [generated] }));
  fs.writeFileSync(evidencePath, JSON.stringify({
    policy: {
      require_source_reverse_evidence: true,
      max_manual_target_languages: 1,
      min_supported_target_languages: 3
    },
    validations: [{
      source_entry_id: 1,
      source_sense_id: 102,
      decision: 'supported',
      evidence_qualification: {
        mode: 'supported_with_limited_manual_evidence',
        supported_target_languages: 3,
        manual_target_languages: 1
      },
      languages: {
        en: { decision: 'supported' },
        'pt-BR': { decision: 'manual_review' },
        zh: { decision: 'supported' },
        ja: { decision: 'supported' }
      }
    }]
  }));
  fs.writeFileSync(consensusPath, JSON.stringify({
    policy: { independent_model_families: true, automatic_promotion: false, confidence_threshold: 0.9 },
    reviews: [{
      valid: true, source_entry_id: 1, source_sense_id: 102,
      decision: 'accept', consensus_accepted: true, confidence: 0.98, corrections: []
    }]
  }));
  const run = () => spawnSync(process.execPath, [
    'scripts/build-dictionary-v2-product-source-gap-controlled-consensus-input.mjs',
    '--review', reviewPath, '--generation', generationPath, '--evidence', evidencePath,
    '--consensus', consensusPath, '--out', outPath, '--confidence-threshold', '0.9'
  ], { cwd: process.cwd(), encoding: 'utf8' });
  let result = run();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(fs.readFileSync(outPath, 'utf8')).selected.length, 1);

  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  evidence.validations[0].languages['pt-BR'].decision = 'unsupported';
  fs.writeFileSync(evidencePath, JSON.stringify(evidence));
  result = run();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(fs.readFileSync(outPath, 'utf8')).selected.length, 0);
}

function testScaleCohortAllowsExistingQueryable() {
  const inputPath = path.join(directory, 'scale-input.json');
  const defaultOut = path.join(directory, 'scale-default.json');
  const additionalOut = path.join(directory, 'scale-additional.json');
  fs.writeFileSync(inputPath, JSON.stringify({
    product_db: productDbPath,
    selected: [{
      source_entry_id: 1,
      source_sense_id: 102,
      source_lang: 'zh',
      word: '中',
      frequency_rank: 10,
      daily_tier: 'core',
      daily_priority: 100,
      daily_sense_selection: { selected: { gloss: 'to hit; to win' } },
      reverse_evidence_prefilter: { target_coverage_count: 3, matching_sources: [] }
    }]
  }));
  for (const [outPath, allow] of [[defaultOut, false], [additionalOut, true]]) {
    const result = spawnSync(process.execPath, [
      'scripts/select-dictionary-v2-product-daily-scale-cohort.mjs',
      '--report', inputPath,
      '--product-db', productDbPath,
      '--out', outPath,
      '--limit', '1',
      '--zh-quota', '1',
      '--minimum-target-coverage', '0',
      '--allow-existing-queryable', String(allow),
      '--allow-missing-daily-tier', 'true'
    ], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  assert.equal(JSON.parse(fs.readFileSync(defaultOut, 'utf8')).selected.length, 0);
  assert.equal(JSON.parse(fs.readFileSync(additionalOut, 'utf8')).selected.length, 1);
}

function testCandidateBuilder() {
  const outPath = path.join(directory, 'builder.json');
  const result = spawnSync(process.execPath, [
    'scripts/find-dictionary-v2-product-additional-sense-entries.mjs',
    '--source-db', sourceDbPath,
    '--product-db', productDbPath,
    '--out', outPath
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(report.selected.length, 1);
  assert.equal(report.selected[0].source_entry_id, 1);
  assert.equal(report.selected[0].product_entry_id, 301);
  assert.equal(report.selected[0].candidate_lane, 'additional_unlinked_source_sense');
  assert.equal(report.summary.skipped_unmatched_product_entry, 0);
}

function testAttemptHistorySelectsNextAdditionalSense() {
  const attemptedPath = path.join(directory, 'attempted.json');
  fs.writeFileSync(attemptedPath, JSON.stringify({ selected: [{
    source_entry_id: 1,
    first_sense_id: 102
  }] }));
  const next = runSelector(true, 'attempt-next', attemptedPath);
  assert.equal(next.selected.length, 1);
  assert.equal(next.selected[0].first_sense_id, 103);
  assert.equal(next.summary.excluded_attempted_senses, 1);

  const allAttemptedPath = path.join(directory, 'all-attempted.json');
  fs.writeFileSync(allAttemptedPath, JSON.stringify({ selected: [
    { source_entry_id: 1, first_sense_id: 102 },
    { source_entry_id: 1, source_sense_id: 103 }
  ] }));
  const exhausted = runSelector(true, 'attempt-exhausted', allAttemptedPath);
  assert.equal(exhausted.selected.length, 0);
  assert.equal(exhausted.rejected[0].reason, 'all_eligible_source_senses_attempted');
}

function runSelector(additional, prefix, excludePath = null) {
  const outPath = path.join(directory, `${prefix}-out.json`);
  const rejectedPath = path.join(directory, `${prefix}-rejected.json`);
  const selectorArgs = [
    'scripts/select-dictionary-v2-product-daily-primary-senses.mjs',
    '--report', reportPath,
    '--source-db', sourceDbPath,
    '--product-db', productDbPath,
    '--out', outPath,
    '--rejected-out', rejectedPath,
    '--require-native-source', 'true',
    '--allow-linked-primary-for-additional-sense', String(additional)
  ];
  if (excludePath) selectorArgs.push('--exclude', excludePath);
  const result = spawnSync(process.execPath, selectorArgs, { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return {
    selected: JSON.parse(fs.readFileSync(outPath, 'utf8')).selected,
    summary: JSON.parse(fs.readFileSync(outPath, 'utf8')).summary,
    rejected: JSON.parse(fs.readFileSync(rejectedPath, 'utf8')).rejected
  };
}

function createSourceDb(filePath) {
  const db = new Database(filePath);
  db.exec(`
    CREATE TABLE senses (
      id INTEGER PRIMARY KEY, entry_id INTEGER, sense_order INTEGER,
      part_of_speech TEXT, gloss_key TEXT, source TEXT,
      confidence REAL, needs_review INTEGER
    );
    CREATE TABLE entries (
      id INTEGER PRIMARY KEY, word TEXT, normalized_key TEXT, source_lang TEXT,
      frequency_rank INTEGER, status TEXT
    );
    CREATE TABLE sense_localizations (
      id INTEGER PRIMARY KEY, sense_id INTEGER, lang TEXT, term TEXT,
      reading TEXT, reading_system TEXT, pronunciation TEXT,
      pronunciation_system TEXT, definition TEXT, source TEXT,
      confidence REAL, needs_review INTEGER
    );
    CREATE TABLE examples (
      id INTEGER PRIMARY KEY, sense_id INTEGER, example_order INTEGER,
      source_lang TEXT, source_text TEXT, source_reading TEXT,
      source TEXT, confidence REAL, needs_review INTEGER
    );
    CREATE TABLE example_localizations (
      id INTEGER PRIMARY KEY, example_id INTEGER, lang TEXT, text TEXT,
      reading TEXT, source TEXT, confidence REAL, needs_review INTEGER
    );
  `);
  db.exec("INSERT INTO entries VALUES (1, '中', '中', 'zh', 10, 'accepted')");
  db.prepare('INSERT INTO senses VALUES (?, 1, ?, ?, ?, ?, 1, 0)').run(101, 1, 'noun', 'middle; center', 'cc-cedict');
  db.prepare('INSERT INTO senses VALUES (?, 1, ?, ?, ?, ?, 1, 0)').run(102, 2, 'verb', 'to hit; to win', 'cc-cedict');
  db.prepare('INSERT INTO senses VALUES (?, 1, ?, ?, ?, ?, 1, 0)').run(103, 3, 'verb', 'to be in; to fit', 'cc-cedict');
  const insertLoc = db.prepare('INSERT INTO sense_localizations VALUES (NULL, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, 1, 0)');
  for (const senseId of [101, 102, 103]) {
    insertLoc.run(senseId, 'zh', '中', senseId === 101 ? '中间' : '击中', 'cc-cedict');
    insertLoc.run(senseId, 'en', senseId === 101 ? 'middle' : 'hit', senseId === 101 ? 'The center.' : 'To strike a target.', 'cc-cedict');
  }
  insertLoc.run(102, 'pt-BR', 'acertar', 'Atingir um alvo.', 'cc-cedict');
  insertLoc.run(102, 'ja', '当たる', '目標に命中する。', 'cc-cedict');
  insertLoc.run(103, 'zh', '中', '处在其中。', 'cc-cedict');
  insertLoc.run(103, 'en', 'fit', 'To be suitable or fit.', 'cc-cedict');
  insertLoc.run(103, 'pt-BR', 'servir', 'Ser adequado.', 'cc-cedict');
  insertLoc.run(103, 'ja', '合う', '適合する。', 'cc-cedict');
  db.close();
}

function createProductDb(filePath) {
  const db = new Database(filePath);
  db.exec(`
    CREATE TABLE product_entries (
      id INTEGER PRIMARY KEY, headword TEXT, normalized_key TEXT,
      primary_lang TEXT, status TEXT, group_key TEXT
    );
    CREATE TABLE product_senses (
      id INTEGER PRIMARY KEY, product_entry_id INTEGER, status TEXT, gloss_key TEXT
    );
    CREATE TABLE product_localizations (
      id INTEGER PRIMARY KEY, product_sense_id INTEGER, lang TEXT,
      term TEXT, needs_review INTEGER
    );
    CREATE TABLE product_sense_source_links (
      id INTEGER PRIMARY KEY, product_sense_id INTEGER, source_entry_id INTEGER,
      source_sense_id INTEGER
    );
    INSERT INTO product_entries VALUES (88, 'for', 'for', 'en', 'accepted', 'source-gap:en:for');
    INSERT INTO product_entries VALUES (301, '中', '中', 'zh', 'accepted', 'source-gap:zh:中');
    INSERT INTO product_senses VALUES (88, 88, 'accepted', 'for');
    INSERT INTO product_senses VALUES (201, 301, 'accepted', 'middle; center');
    INSERT INTO product_localizations VALUES (1, 88, 'en', 'for', 0);
    INSERT INTO product_localizations VALUES (2, 201, 'zh', '中', 0);
    INSERT INTO product_sense_source_links VALUES (1, 88, 1, 999);
    INSERT INTO product_sense_source_links VALUES (2, 201, 1, 101);
  `);
  db.close();
}
