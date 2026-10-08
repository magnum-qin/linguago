#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { japaneseReverseLookupVariants } from './lib/japanese-reverse-lookup-variants.mjs';

const pipeline = fs.readFileSync('scripts/run-dictionary-v2-remote-pipeline.mjs', 'utf8');
const manager = fs.readFileSync('scripts/manage-remote-dictionary-runner.ps1', 'utf8');
const orchestrator = fs.readFileSync('scripts/run-remote-dictionary-production-until-release.ps1', 'utf8');
const generator = fs.readFileSync('scripts/supplement-dictionary-v2-product-source-gaps-unsloth.mjs', 'utf8');
const controlledReplay = fs.readFileSync('scripts/validate-remote-dictionary-controlled-replay.ps1', 'utf8');

assert.match(pipeline, /\['full', 'draft-production', 'release-validation'\]/u);
assert.match(pipeline, /--apply', String\(executionMode === 'draft-production'\)/u);
const simplifiedReviewStart = pipeline.indexOf("await stage('gemma_source_review'");
const simplifiedReverseStart = pipeline.indexOf("'source_suggested_reverse_evidence'", simplifiedReviewStart);
assert.ok(simplifiedReviewStart >= 0 && simplifiedReverseStart > simplifiedReviewStart);
assert.match(
  pipeline.slice(simplifiedReviewStart, simplifiedReverseStart),
  /'--require-hint-semantic-alignment', 'true'/u,
  'simplified Gemma review must bind preferred terms to validated hints'
);
assert.match(pipeline, /--allow-no-promote-draft-writes', String\(executionMode === 'draft-production'\)/u);
assert.match(generator, /--allow-no-promote-draft-writes requires --apply true and --publishable false/u);
assert.match(generator, /allowNoPromoteDraftWrites \|\|[\s\S]*?!noPromoteSourceEntryIds/u);
assert.match(pipeline, /release_validation_pending: true/u);
assert.match(pipeline, /runReleaseValidationPipeline/u);
assert.match(pipeline, /const generationReadyReport = path\.join\(sourceRunDir, '04f-generation-ready-candidates\.json'\)/u);
assert.match(pipeline, /summary: \{[\s\S]*?input: batchItemCount,[\s\S]*?jmdict_generation_ready: reportItemCount\(generationReadyReport\)/u);
assert.match(manager, /\[ValidateSet\('full', 'draft-production', 'release-validation'\)\]/u);
assert.match(manager, /'--execution-mode', \$ExecutionMode/u);
assert.match(manager, /\$Launch = \[ordered\]@\{[\s\S]*?ExecutionMode = \$ExecutionMode/u);
assert.match(orchestrator, /\[ValidateSet\('full', 'draft-production'\)\]/u);
assert.match(orchestrator, /Write-State 'draft_batch_complete'/u);
assert.match(orchestrator, /\$Selected -lt \$Requested -and \$ExecutionMode -ne 'draft-production'/u);
assert.match(orchestrator, /Write-State 'candidate_shortfall_continuing'/u);
assert.match(orchestrator, /\$ExecutionMode -eq 'draft-production'\) \{ \$Selected \} else \{ \$Requested \}/u);
assert.match(orchestrator, /if \(\$ExecutionMode -eq 'draft-production'\) \{[\s\S]*?\$BatchArgs \+= '-SkipVerify'/u);
assert.match(orchestrator, /\$ExecutionMode -ne 'draft-production' -and \$QualityHold/u);
assert.match(controlledReplay, /\$DraftProductionWritesExist = \[bool\]\$GenerationReport\.stats\.apply[\s\S]*?senses_inserted -gt 0/u);
assert.match(controlledReplay, /\$HistoricalDraftRecovery =[\s\S]*?\$DraftProductionWritesExist/u);
const draftBranchStart = orchestrator.indexOf("if ($ExecutionMode -eq 'draft-production')");
const completionBranchStart = orchestrator.indexOf('    try {', draftBranchStart);
assert.ok(draftBranchStart >= 0 && completionBranchStart > draftBranchStart);
assert.doesNotMatch(orchestrator.slice(draftBranchStart, completionBranchStart), /CompletionScript/u);

assert.deepEqual(japaneseReverseLookupVariants('ふわふわした'), ['ふわふわした', 'ふわふわ', 'ふわふわする']);
assert.deepEqual(japaneseReverseLookupVariants('ふわふわして'), ['ふわふわして', 'ふわふわ', 'ふわふわする']);
assert.deepEqual(japaneseReverseLookupVariants('きれいな'), ['きれいな', 'きれい']);

console.log('dictionary pipeline execution mode test passed');
