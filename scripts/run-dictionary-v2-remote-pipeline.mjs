#!/usr/bin/env node

import './lib/load-local-env.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { ensureUnslothModel } from './lib/unsloth-elastic-model.mjs';
import { discoverUnslothStagePool } from './lib/unsloth-cluster-discovery.mjs';
import { inspectCompletedPipelineStage } from './lib/dictionary-pipeline-stage-recovery.mjs';
import { runChildProcessWithLog } from './lib/run-child-process-with-log.mjs';

// Remote SSH and scheduled-task launchers may start outside the runner root.
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));

const args = parseArgs(process.argv.slice(2));
const pipelineMode = String(args['pipeline-mode'] || 'legacy').trim().toLowerCase();
if (!['legacy', 'simplified'].includes(pipelineMode)) {
  throw new Error(`Invalid --pipeline-mode: ${pipelineMode}`);
}
const executionMode = String(args['execution-mode'] || 'full').trim().toLowerCase();
if (!['full', 'draft-production', 'release-validation'].includes(executionMode)) {
  throw new Error(`Invalid --execution-mode: ${executionMode}`);
}
const batchPath = requiredPath(args.batch, 'batch');
const runId = String(args['run-id'] || path.basename(batchPath, '.json')).replace(/[^a-zA-Z0-9._-]/gu, '-');
const runDir = path.resolve(args['run-dir'] || path.join('runs', runId));
const sourceRunDir = args['source-run-dir'] ? requiredPath(args['source-run-dir'], 'source-run-dir') : null;
const resume = args.resume !== 'false';
const qwenEndpoints = String(
  args['qwen-endpoints'] || 'http://127.0.0.1:11441,http://127.0.0.1:11442,http://127.0.0.1:11443,http://127.0.0.1:11444,http://127.0.0.1:11445,http://127.0.0.1:11446,http://127.0.0.1:11447,http://127.0.0.1:11448'
);
const gemmaEndpoints = String(
  args['gemma-endpoints'] || 'http://127.0.0.1:11441,http://127.0.0.1:11442,http://127.0.0.1:11443,http://127.0.0.1:11444,http://127.0.0.1:11445,http://127.0.0.1:11446,http://127.0.0.1:11447,http://127.0.0.1:11448'
);
const qwenVariants = String(
  args['qwen-variants'] || '11441=UD-Q4_K_XL,11442=UD-Q4_K_XL,11443=UD-Q4_K_XL,11444=UD-Q4_K_XL,11445=UD-Q4_K_XL,11446=UD-IQ4_NL,11447=UD-IQ4_NL,11448=UD-IQ4_NL'
);
const gemmaVariants = String(
  args['gemma-variants'] || '11441=UD-Q4_K_XL,11442=UD-Q4_K_XL,11443=UD-Q4_K_XL,11444=UD-Q4_K_XL,11445=UD-Q4_K_XL,11446=UD-Q4_K_XL,11447=UD-Q4_K_XL,11448=UD-Q4_K_XL'
);
const qwenModel = String(args['qwen-model'] || 'unsloth/Qwen3.6-35B-A3B-MTP-GGUF');
const gemmaModel = String(args['gemma-model'] || 'unsloth/gemma-4-31B-it-qat-GGUF');
const elasticModelSwap = args['elastic-model-swap'] !== 'false';
const elasticEndpoints = String(
  args['elastic-endpoints'] || 'http://127.0.0.1:11442,http://127.0.0.1:11445'
);
const elasticQwenVariants = String(
  args['elastic-qwen-variants'] || '11442=UD-Q4_K_XL,11445=UD-Q4_K_XL'
);
const elasticMinimumItems = Math.max(1, Number.parseInt(args['elastic-minimum-items'] || '20', 10));
const dynamicEndpointDiscovery = args['dynamic-endpoint-discovery'] !== 'false';
const clusterStatusUrl = String(args['cluster-status-url'] || 'http://127.0.0.1:18080/api/status');
const clusterServiceUser = String(args['cluster-service-user'] || 'g24tka12');
const batchItemCount = reportItemCount(batchPath);
const sourceQwenPool = qwenPoolForWork(batchItemCount);
const gemmaConcurrency = csvValues(gemmaEndpoints).length;
const generationTarget = Math.max(1, Number.parseInt(args['generation-target'] || '20', 10));
// Wiktionary language editions count as independent evidence families; pass
// --evidence-family-policy wiktionary to restore the single-family grouping.
const evidenceFamilyPolicy = String(args['evidence-family-policy'] || 'wiktionary-edition');
const stopAfterSourceScreen = args['stop-after-source-screen'] === 'true';
const productionPrefilter = args['production-prefilter'] !== 'false';
const requireAuthoritativeSourceSense =
  args['require-authoritative-source-sense'] !== undefined
    ? args['require-authoritative-source-sense'] !== 'false'
    : pipelineMode === 'simplified';
const dailyPrimarySenseSelection =
  args['daily-primary-sense-selection'] !== undefined
    ? args['daily-primary-sense-selection'] !== 'false'
    : pipelineMode === 'simplified';
const allowLinkedPrimaryForAdditionalSense =
  args['allow-linked-primary-for-additional-sense'] === 'true';
const sourceReverseMaxManualTargetLangs = Math.max(
  0,
  Number.parseInt(
    args['source-reverse-max-manual-target-langs'] ||
      (allowLinkedPrimaryForAdditionalSense ? '1' : '0'),
    10
  )
);
const sourceReverseMinSupportedTargetLangs = Math.max(
  0,
  Number.parseInt(
    args['source-reverse-min-supported-target-langs'] ||
      (allowLinkedPrimaryForAdditionalSense ? '3' : '0'),
    10
  )
);
const phraseHeadReverseEvidence = args['phrase-head-reverse-evidence'] !== 'false';
const additionalSenseReverseEvidenceArgs = [
  '--max-manual-target-langs', String(sourceReverseMaxManualTargetLangs),
  '--min-supported-target-langs', String(sourceReverseMinSupportedTargetLangs),
  '--phrase-head-reverse-evidence', String(phraseHeadReverseEvidence)
];
const sourceSenseAlignment = args['source-sense-alignment'] === 'true';
const allowNativeSourceFallback = args['allow-native-source-fallback'] === 'true';
const reverseEvidencePrefilter = args['reverse-evidence-prefilter'] === 'true';
const reverseEvidenceMinimumTargetLanguages = Math.max(
  0,
  Number.parseInt(args['reverse-evidence-min-target-langs'] || '2', 10)
);
const reverseEvidencePrefilterLimit = Math.max(
  1,
  Number.parseInt(args['reverse-evidence-prefilter-limit'] || '1000000', 10)
);
const enforceGenerationHintTerms = args['enforce-generation-hint-terms'] !== 'false';
const strongSupplementalSourceKeys = String(args['strong-supplemental-source-keys'] || '').trim();
const reviewedSupplementalSourceKeys = String(args['reviewed-supplemental-source-keys'] || '').trim();
const candidateBoundSourceRoundtripKeys = String(
  args['candidate-bound-source-roundtrip-keys'] || ''
).trim();
const allowModelDownload = args['allow-model-download'] === 'true';
const supplementalSourceDb = args['supplemental-source-db']
  ? requiredPath(args['supplemental-source-db'], 'supplemental-source-db')
  : null;
const reviewedSupplementalArgs = reviewedSupplementalSourceKeys
  ? ['--reviewed-supplemental-source-keys', reviewedSupplementalSourceKeys]
  : [];
const candidateBoundSupplementalArgs = candidateBoundSourceRoundtripKeys
  ? ['--candidate-bound-source-roundtrip-keys', candidateBoundSourceRoundtripKeys]
  : [];
const supplementalValidationArgs = [
  ...reviewedSupplementalArgs,
  ...candidateBoundSupplementalArgs
];
const token = process.env.UNSLOTH_API_KEY;

if (!token) throw new Error('UNSLOTH_API_KEY is not set in the remote process environment');

fs.mkdirSync(runDir, { recursive: true });
const manifestPath = path.join(runDir, 'manifest.json');
const inputFingerprint = sha256File(batchPath);
const manifest = loadManifest();
if (manifest.input_fingerprint && manifest.input_fingerprint !== inputFingerprint) {
  throw new Error('Batch fingerprint changed; use a new --run-id instead of resuming this run');
}
manifest.input = relative(batchPath);
manifest.input_fingerprint = inputFingerprint;
manifest.run_id = runId;
manifest.started_at ||= new Date().toISOString();
manifest.status = 'running';
manifest.models = { qwen: qwenModel, gemma: gemmaModel };
manifest.pipeline_mode = pipelineMode;
manifest.execution_mode = executionMode;
manifest.endpoints = {
  qwen: csvValues(qwenEndpoints),
  gemma: csvValues(gemmaEndpoints),
  elastic: csvValues(elasticEndpoints),
  source_qwen: csvValues(sourceQwenPool.endpoints)
};
manifest.endpoint_variants = {
  qwen: sourceQwenPool.variants,
  gemma: gemmaVariants
};
manifest.elastic_model_swap = elasticModelSwap;
manifest.elastic_minimum_items = elasticMinimumItems;
manifest.dynamic_endpoint_discovery = dynamicEndpointDiscovery;
manifest.cluster_status_url = clusterStatusUrl;
manifest.allow_model_download = allowModelDownload;
manifest.require_authoritative_source_sense = requireAuthoritativeSourceSense;
manifest.reverse_evidence_prefilter = reverseEvidencePrefilter;
manifest.daily_primary_sense_selection = dailyPrimarySenseSelection;
manifest.source_sense_alignment = sourceSenseAlignment;
manifest.allow_native_source_fallback = allowNativeSourceFallback;
manifest.source_reverse_max_manual_target_langs = sourceReverseMaxManualTargetLangs;
manifest.source_reverse_min_supported_target_langs = sourceReverseMinSupportedTargetLangs;
manifest.reverse_evidence_min_target_langs = reverseEvidenceMinimumTargetLanguages;
manifest.reverse_evidence_prefilter_limit = reverseEvidencePrefilterLimit;
manifest.enforce_generation_hint_terms = enforceGenerationHintTerms;
manifest.strong_supplemental_source_keys = strongSupplementalSourceKeys;
manifest.reviewed_supplemental_source_keys = reviewedSupplementalSourceKeys;
manifest.candidate_bound_source_roundtrip_keys = candidateBoundSourceRoundtripKeys;
manifest.input_items = batchItemCount;
manifest.supplemental_source_db = supplementalSourceDb ? relative(supplementalSourceDb) : null;
manifest.stages ||= {};
writeManifest();

const files = {
  qwenReview: sourceOutput('01-qwen-source-review.json'),
  qwenApproved: sourceOutput('01-qwen-source-review-approved.json'),
  qwenRejected: sourceOutput('01-qwen-source-review-rejected.json'),
  locked: sourceOutput('02-qwen-terms-locked.json'),
  gemmaReview: sourceOutput('03-gemma-source-review.json'),
  gemmaApproved: sourceOutput('03-gemma-source-review-approved.json'),
  gemmaRejected: sourceOutput('03-gemma-source-review-rejected.json'),
  consensus: sourceOutput('04-source-consensus.json'),
  consensusReverse: sourceOutput('04b-source-consensus-reverse-evidence.json'),
  consensusSupported: sourceOutput('04b-source-consensus-reverse-supported.json'),
  semanticPreview: output('04c-semantic-preview.json'),
  semanticReview: output('04d-semantic-preview-gemma.json'),
  semanticAccepted: output('04d-semantic-preview-gemma-accepted.json'),
  semanticRepairInput: output('04d2-semantic-correction-retry.json'),
  semanticRepairGeneration: output('04d3-semantic-repair-generation.json'),
  semanticRepairCheckpoint: output('04d3-semantic-repair-generation.pipeline.checkpoint.json'),
  semanticRepairReverse: output('04d4-semantic-repair-reverse.json'),
  semanticRepairReverseSupported: output('04d4-semantic-repair-reverse-supported.json'),
  semanticRepairFinal: output('04d5-semantic-repair-final-gemma.json'),
  semanticRepairAccepted: output('04d5-semantic-repair-final-gemma-accepted.json'),
  semanticSelected: output('04e-semantic-approved-candidates.json'),
  generationReady: output('04f-generation-ready-candidates.json'),
  generation: output('05-qwen-generation.json'),
  generationCheckpoint: output('05-qwen-generation.checkpoint.json'),
  reverse: output('06-reverse-evidence.json'),
  reverseSupported: output('06-reverse-evidence-supported.json'),
  finalGemma: output('07-final-gemma.json'),
  finalAccepted: output('07-final-gemma-accepted.json'),
  repairInput: output('08-structured-correction-retry.json'),
  repairGeneration: output('09-qwen-repair-generation.json'),
  repairCheckpoint: output('09-qwen-repair-generation.checkpoint.json'),
  repairReverse: output('10-repair-reverse-evidence.json'),
  repairReverseSupported: output('10-repair-reverse-evidence-supported.json'),
  repairFinalGemma: output('11-repair-final-gemma.json'),
  repairFinalAccepted: output('11-repair-final-gemma-accepted.json'),
  summary: output('summary.json')
};
files.productionFiltered = output('00-production-prefilter.json');
files.productionRejected = output('00-production-prefilter-rejected.json');
files.dailyPrimary = output('00a-daily-primary-senses.json');
files.dailyPrimaryRejected = output('00a-daily-primary-senses-rejected.json');
files.senseAligned = output('00b-source-sense-aligned.json');
files.senseAlignmentRejected = output('00b-source-sense-alignment-rejected.json');
files.reverseEvidenceFiltered = output('00c-reverse-evidence-prefilter.json');
files.reverseEvidenceFilterDetails = output('00c-reverse-evidence-prefilter-details.json');

try {
  if (executionMode === 'release-validation') {
    await runReleaseValidationPipeline();
  } else if (pipelineMode === 'simplified') {
    await runSimplifiedPipeline();
  } else {
  if (!sourceRunDir) {
  await stage('qwen_source_review', 'scripts/review-dictionary-v2-product-source-gap-candidates-unsloth.mjs', [
    '--report', batchPath,
    '--out', files.qwenReview,
    '--approved-out', files.qwenApproved,
    '--rejected-out', files.qwenRejected,
    '--endpoints', sourceQwenPool.endpoints,
    '--endpoint-gguf-variants', sourceQwenPool.variants,
    '--model', qwenModel,
    '--limit', '1000000',
    '--confidence-threshold', '0.9',
    '--max-attempts', '2',
    '--timeout-ms', '60000',
    '--circuit-breaker-failures', '2',
    '--circuit-breaker-reset-ms', '30000',
    '--resume', String(resume),
    '--max-seq-length', '1024',
    '--max-tokens', '650',
    '--speculative-type', 'mtp',
    '--prompt-mode', 'nano-per-language',
    '--require-hint-semantic-alignment', 'true',
    '--require-definition-contract', 'true',
    '--stream', 'true',
    '--prewarm', 'true',
    '--unload-before-load', String(elasticModelSwap)
  ], [files.qwenReview, files.qwenApproved]);

  await stage('lock_terms', 'scripts/lock-dictionary-v2-source-review-proposal-terms.mjs', [
    '--report', files.qwenApproved,
    '--out', files.locked
  ], [files.locked]);

  await stage('gemma_source_review', 'scripts/review-dictionary-v2-product-source-gap-candidates-unsloth.mjs', [
    '--report', files.locked,
    '--out', files.gemmaReview,
    '--approved-out', files.gemmaApproved,
    '--rejected-out', files.gemmaRejected,
    '--endpoints', gemmaEndpoints,
    '--endpoint-gguf-variants', gemmaVariants,
    '--model', gemmaModel,
    '--limit', '1000000',
    '--confidence-threshold', '0.9',
    '--max-attempts', '2',
    '--timeout-ms', '60000',
    '--circuit-breaker-failures', '2',
    '--circuit-breaker-reset-ms', '30000',
    '--resume', String(resume),
    '--max-seq-length', '3072',
    '--max-tokens', '650',
    '--speculative-type', 'off',
    '--prompt-mode', 'locked-contract',
    '--response-format', 'json-object',
    '--require-hint-semantic-alignment', 'true',
    '--require-definition-contract', 'true',
    '--stream', 'true',
    '--prewarm', 'true',
    '--unload-before-load', String(elasticModelSwap)
  ], [files.gemmaReview, files.gemmaApproved]);

  await stage('source_consensus', 'scripts/intersect-dictionary-v2-source-reviews.mjs', [
    '--primary', files.qwenReview,
    '--reviewer', files.gemmaReview,
    '--selected', files.locked,
    '--out', files.consensus
  ], [files.consensus]);

  await stage('source_consensus_reverse_evidence', 'scripts/validate-dictionary-v2-product-source-gap-reverse-evidence.mjs', [
    '--report', files.consensus,
    '--out', files.consensusReverse,
    '--supported-report', files.consensusSupported,
    '--input-mode', 'reviewed',
    '--require-source-reverse-evidence', 'true',
    '--evidence-family-policy', evidenceFamilyPolicy,
    ...(supplementalSourceDb ? ['--supplemental-source-db', supplementalSourceDb] : []),
    ...supplementalValidationArgs
  ], [files.consensusReverse, files.consensusSupported]);
  } else {
    for (const filePath of [files.qwenReview, files.gemmaReview, files.consensus, files.consensusReverse, files.consensusSupported]) {
      if (!fs.existsSync(filePath)) throw new Error(`Source replay report missing: ${filePath}`);
    }
    manifest.source_run_dir = relative(sourceRunDir);
    manifest.stages.source_replay = {
      status: 'complete',
      completed_at: new Date().toISOString(),
      outputs: [files.qwenReview, files.gemmaReview, files.consensus, files.consensusReverse, files.consensusSupported]
        .map((filePath) => ({ path: relative(filePath), sha256: sha256File(filePath) }))
    };
    writeManifest();
  }

  if (stopAfterSourceScreen) {
    const sourceSummary = buildSourceScreenSummary(files);
    fs.writeFileSync(files.summary, `${JSON.stringify(sourceSummary, null, 2)}\n`, 'utf8');
    manifest.status = 'complete';
    manifest.completed_at = new Date().toISOString();
    manifest.stop_after_source_screen = true;
    manifest.summary = sourceSummary.summary;
    writeManifest();
    console.log(JSON.stringify(sourceSummary, null, 2));
    process.exit(0);
  }

  await stage('build_semantic_preview', 'scripts/build-dictionary-v2-source-gap-semantic-preview.mjs', [
    '--report', files.consensusSupported,
    '--out', files.semanticPreview
  ], [files.semanticPreview]);

  if (reportHasRows(files.consensusSupported)) await stage('semantic_preview_gemma', 'scripts/review-dictionary-v2-product-source-gap-consensus-unsloth.mjs', [
    '--generation', files.semanticPreview,
    '--evidence', files.consensusReverse,
    '--out', files.semanticReview,
    '--accepted-out', files.semanticAccepted,
    '--endpoints', gemmaEndpoints,
    '--endpoint-gguf-variants', gemmaVariants,
    '--model', gemmaModel,
    '--generation-model', qwenModel,
    '--only-supported', 'true',
    '--limit', '1000000',
    '--concurrency', String(gemmaConcurrency),
    '--confidence-threshold', '0.9',
    '--max-attempts', '2',
    '--max-seq-length', '2048',
    '--max-tokens', '420',
    '--prompt-mode', 'full',
    '--resume', String(resume),
    '--stream', 'true',
    '--unload-before-load', String(elasticModelSwap)
  ], [files.semanticReview, files.semanticAccepted]);
  else skipConsensusStage('semantic_preview_gemma', files.semanticReview, files.semanticAccepted);

  await stage('build_semantic_correction_retry', 'scripts/build-dictionary-v2-product-source-gap-structured-correction-retry.mjs', [
    '--report', files.consensusSupported,
    '--consensus', files.semanticReview,
    '--generation', files.semanticPreview,
    '--out', files.semanticRepairInput
  ], [files.semanticRepairInput]);

  const semanticRepairQwenPool = qwenPoolForWork(reportItemCount(files.semanticRepairInput));
  await stage('qwen_semantic_repair_generation', 'scripts/supplement-dictionary-v2-product-source-gaps-unsloth.mjs', [
    '--report', files.semanticRepairInput,
    '--out', files.semanticRepairGeneration,
    '--checkpoint', files.semanticRepairCheckpoint,
    '--endpoints', semanticRepairQwenPool.endpoints,
    '--endpoint-gguf-variants', semanticRepairQwenPool.variants,
    '--model', qwenModel,
    '--limit', '1000000',
    '--concurrency', String(semanticRepairQwenPool.concurrency),
    '--batch-size', '1',
    '--chunk-size', '50',
    '--max-attempts', '2',
    '--circuit-breaker-failures', '2',
    '--max-seq-length', '2048',
    '--max-tokens', '1600',
    '--speculative-type', 'mtp',
    '--prompt-mode', 'compact',
    '--stream-response', 'true',
    '--disable-thinking', 'true',
    '--enforce-reviewed-preferred-terms', 'true',
    '--deterministic-readings', 'true',
    '--deterministic-pronunciations', 'true',
    '--prewarm', 'true',
    '--resume', String(resume),
    '--allow-endpoint-change-on-resume', 'true',
    '--dry-run', 'true',
    '--apply', 'false',
    '--log-generated', 'true'
  ], [files.semanticRepairGeneration]);

  await stage('semantic_repair_reverse_evidence', 'scripts/validate-dictionary-v2-product-source-gap-reverse-evidence.mjs', [
    '--report', files.semanticRepairGeneration,
    '--out', files.semanticRepairReverse,
    '--supported-report', files.semanticRepairReverseSupported,
    '--require-source-reverse-evidence', 'true',
    '--evidence-family-policy', evidenceFamilyPolicy,
    ...(supplementalSourceDb ? ['--supplemental-source-db', supplementalSourceDb] : []),
    ...supplementalValidationArgs
  ], [files.semanticRepairReverse, files.semanticRepairReverseSupported]);

  if (reportHasRows(files.semanticRepairReverseSupported)) await stage('semantic_repair_final_gemma', 'scripts/review-dictionary-v2-product-source-gap-consensus-unsloth.mjs', [
    '--generation', files.semanticRepairGeneration,
    '--evidence', files.semanticRepairReverse,
    '--out', files.semanticRepairFinal,
    '--accepted-out', files.semanticRepairAccepted,
    '--endpoints', gemmaEndpoints,
    '--endpoint-gguf-variants', gemmaVariants,
    '--model', gemmaModel,
    '--generation-model', qwenModel,
    '--only-supported', 'true',
    '--limit', '1000000',
    '--concurrency', String(gemmaConcurrency),
    '--confidence-threshold', '0.9',
    '--max-attempts', '2',
    '--max-seq-length', '2048',
    '--max-tokens', '650',
    '--prompt-mode', 'full',
    '--resume', String(resume),
    '--stream', 'true',
    '--unload-before-load', String(elasticModelSwap)
  ], [files.semanticRepairFinal, files.semanticRepairAccepted]);
  else skipConsensusStage('semantic_repair_final_gemma', files.semanticRepairFinal, files.semanticRepairAccepted);

  await stage('select_semantic_approved_candidates', 'scripts/select-dictionary-v2-source-gap-candidates-by-review.mjs', [
    '--report', files.consensusSupported,
    '--review', files.semanticReview,
    '--accepted-only', 'true',
    '--out', files.semanticSelected
  ], [files.semanticSelected]);

  await stage('jmdict_generation_preflight', 'scripts/filter-dictionary-v2-source-gap-jmdict-generation-preflight.mjs', [
    '--report', files.semanticSelected,
    '--out', files.generationReady
  ], [files.generationReady]);

  const generationWorkItems = Math.min(reportItemCount(files.generationReady), generationTarget);
  const generationQwenPool = qwenPoolForWork(generationWorkItems);
  await stage('qwen_generation', 'scripts/supplement-dictionary-v2-product-source-gaps-unsloth.mjs', [
    '--report', files.generationReady,
    '--out', files.generation,
    '--checkpoint', files.generationCheckpoint,
    '--endpoints', generationQwenPool.endpoints,
    '--endpoint-gguf-variants', generationQwenPool.variants,
    '--model', qwenModel,
    '--limit', String(generationTarget),
    '--concurrency', String(generationQwenPool.concurrency),
    '--batch-size', '1',
    '--chunk-size', '50',
    '--max-attempts', '2',
    '--circuit-breaker-failures', '2',
    '--max-seq-length', '2048',
    '--max-tokens', '1600',
    '--speculative-type', 'mtp',
    '--prompt-mode', 'compact',
    '--stream-response', 'true',
    '--disable-thinking', 'true',
    '--enforce-reviewed-preferred-terms', 'true',
    '--deterministic-readings', 'true',
    '--deterministic-pronunciations', 'true',
    '--prewarm', 'true',
    '--resume', String(resume),
    '--allow-endpoint-change-on-resume', 'true',
    '--dry-run', 'true',
    '--apply', 'false',
    '--log-generated', 'true'
  ], [files.generation]);

  await stage('reverse_evidence', 'scripts/validate-dictionary-v2-product-source-gap-reverse-evidence.mjs', [
    '--report', files.generation,
    '--out', files.reverse,
    '--supported-report', files.reverseSupported,
    '--require-source-reverse-evidence', 'true',
    '--evidence-family-policy', evidenceFamilyPolicy,
    ...(supplementalSourceDb ? ['--supplemental-source-db', supplementalSourceDb] : []),
    ...supplementalValidationArgs
  ], [files.reverse, files.reverseSupported]);

  if (reportHasRows(files.reverseSupported)) await stage('final_gemma', 'scripts/review-dictionary-v2-product-source-gap-consensus-unsloth.mjs', [
    '--generation', files.generation,
    '--evidence', files.reverse,
    '--out', files.finalGemma,
    '--accepted-out', files.finalAccepted,
    '--endpoints', gemmaEndpoints,
    '--endpoint-gguf-variants', gemmaVariants,
    '--model', gemmaModel,
    '--generation-model', qwenModel,
    '--only-supported', 'true',
    '--limit', '1000000',
    '--concurrency', String(gemmaConcurrency),
    '--confidence-threshold', '0.9',
    '--max-attempts', '2',
    '--max-seq-length', '2048',
    '--max-tokens', '650',
    '--prompt-mode', 'full',
    '--resume', String(resume),
    '--stream', 'true',
    '--unload-before-load', String(elasticModelSwap)
  ], [files.finalGemma, files.finalAccepted]);
  else skipConsensusStage('final_gemma', files.finalGemma, files.finalAccepted);

  if (reportHasRows(files.generation)) await stage('build_structured_correction_retry', 'scripts/build-dictionary-v2-product-source-gap-structured-correction-retry.mjs', [
    '--report', files.consensusSupported,
    '--consensus', files.finalGemma,
    '--generation', files.generation,
    '--out', files.repairInput
  ], [files.repairInput]);
  else skipConsensusStage('build_structured_correction_retry', files.repairInput);

  const repairQwenPool = qwenPoolForWork(reportItemCount(files.repairInput));
  await stage('qwen_repair_generation', 'scripts/supplement-dictionary-v2-product-source-gaps-unsloth.mjs', [
    '--report', files.repairInput,
    '--out', files.repairGeneration,
    '--checkpoint', files.repairCheckpoint,
    '--endpoints', repairQwenPool.endpoints,
    '--endpoint-gguf-variants', repairQwenPool.variants,
    '--model', qwenModel,
    '--limit', '1000000',
    '--concurrency', String(repairQwenPool.concurrency),
    '--batch-size', '1',
    '--chunk-size', '50',
    '--max-attempts', '2',
    '--circuit-breaker-failures', '2',
    '--max-seq-length', '2048',
    '--max-tokens', '1600',
    '--speculative-type', 'mtp',
    '--prompt-mode', 'compact',
    '--stream-response', 'true',
    '--disable-thinking', 'true',
    '--enforce-reviewed-preferred-terms', 'true',
    '--deterministic-readings', 'true',
    '--deterministic-pronunciations', 'true',
    '--prewarm', 'true',
    '--resume', String(resume),
    '--dry-run', 'true',
    '--apply', 'false',
    '--log-generated', 'true'
  ], [files.repairGeneration]);

  await stage('repair_reverse_evidence', 'scripts/validate-dictionary-v2-product-source-gap-reverse-evidence.mjs', [
    '--report', files.repairGeneration,
    '--out', files.repairReverse,
    '--supported-report', files.repairReverseSupported,
    '--require-source-reverse-evidence', 'true',
    '--evidence-family-policy', evidenceFamilyPolicy,
    ...(supplementalSourceDb ? ['--supplemental-source-db', supplementalSourceDb] : []),
    ...supplementalValidationArgs
  ], [files.repairReverse, files.repairReverseSupported]);

  if (reportHasRows(files.repairReverseSupported)) await stage('repair_final_gemma', 'scripts/review-dictionary-v2-product-source-gap-consensus-unsloth.mjs', [
    '--generation', files.repairGeneration,
    '--evidence', files.repairReverse,
    '--out', files.repairFinalGemma,
    '--accepted-out', files.repairFinalAccepted,
    '--endpoints', gemmaEndpoints,
    '--endpoint-gguf-variants', gemmaVariants,
    '--model', gemmaModel,
    '--generation-model', qwenModel,
    '--only-supported', 'true',
    '--limit', '1000000',
    '--concurrency', String(gemmaConcurrency),
    '--confidence-threshold', '0.9',
    '--max-attempts', '2',
    '--max-seq-length', '2048',
    '--max-tokens', '420',
    '--prompt-mode', 'full',
    '--resume', String(resume),
    '--stream', 'true',
    '--unload-before-load', String(elasticModelSwap)
  ], [files.repairFinalGemma, files.repairFinalAccepted]);
  else skipConsensusStage('repair_final_gemma', files.repairFinalGemma, files.repairFinalAccepted);

  const summary = buildSummary(files);
  fs.writeFileSync(files.summary, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  manifest.status = 'complete';
  manifest.completed_at = new Date().toISOString();
  manifest.summary = summary.summary;
  writeManifest();
  console.log(JSON.stringify(summary, null, 2));
  }
} catch (error) {
  manifest.status = 'failed';
  manifest.failed_at = new Date().toISOString();
  manifest.error = String(error?.message || error);
  writeManifest();
  throw error;
} finally {
  await restoreElasticReviewers();
}

async function runSimplifiedPipeline() {
  let sourceReviewInput = batchPath;
  // Raw native daily reports contain entry identities only. Load and lock one
  // concrete source sense before applying the production source-sense gate.
  if (dailyPrimarySenseSelection) {
    await stage(
      'daily_primary_sense_selection',
      'scripts/select-dictionary-v2-product-daily-primary-senses.mjs',
      [
        '--report', sourceReviewInput,
        '--source-db', args['source-db'] || 'data/processed/linguago_v2_full.db',
        '--product-db', args['product-db'] || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db',
        '--out', files.dailyPrimary,
        '--rejected-out', files.dailyPrimaryRejected,
        '--min-score', args['daily-primary-min-score'] || '2500',
        '--allow-linked-primary-for-additional-sense',
        String(allowLinkedPrimaryForAdditionalSense),
        ...(args['daily-primary-attempt-index']
          ? ['--attempt-index', args['daily-primary-attempt-index']]
          : [])
      ],
      [files.dailyPrimary, files.dailyPrimaryRejected]
    );
    sourceReviewInput = files.dailyPrimary;
  }

  if (productionPrefilter) {
    await stage('production_prefilter', 'scripts/filter-dictionary-v2-production-batch.mjs', [
      '--report', sourceReviewInput,
      '--out', files.productionFiltered,
      '--rejected-out', files.productionRejected,
      '--enabled', 'true',
      '--require-authoritative-source-sense', String(requireAuthoritativeSourceSense),
      '--allow-english-omw-source', args['allow-english-omw-source'] || 'false',
      '--allow-pt-br-omw-source', args['allow-pt-br-omw-source'] || (allowLinkedPrimaryForAdditionalSense ? 'true' : 'false'),
      '--allow-pt-br-wikdict-source', args['allow-pt-br-wikdict-source'] || (allowLinkedPrimaryForAdditionalSense ? 'true' : 'false'),
      '--allow-zh-kaikki-source', args['allow-zh-kaikki-source'] || (allowLinkedPrimaryForAdditionalSense ? 'true' : 'false'),
      '--allow-en-wikdict-source', args['allow-en-wikdict-source'] || (allowLinkedPrimaryForAdditionalSense ? 'true' : 'false')
    ], [files.productionFiltered, files.productionRejected]);
    sourceReviewInput = files.productionFiltered;
  }

  if (sourceSenseAlignment) {
    await stage(
      'source_sense_alignment',
      'scripts/align-dictionary-v2-product-source-gap-candidate-senses.mjs',
      [
        '--report', sourceReviewInput,
        '--out', files.senseAligned,
        '--rejected-out', files.senseAlignmentRejected,
        '--min-langs', '2',
        '--max-langs', args['source-sense-alignment-max-langs'] || '3',
        '--prefer-current-sense', 'true',
        '--allow-native-source-fallback', String(allowNativeSourceFallback)
      ],
      [files.senseAligned, files.senseAlignmentRejected]
    );
    sourceReviewInput = files.senseAligned;
  }

  if (reverseEvidencePrefilter) {
    if (!supplementalSourceDb) {
      throw new Error('--reverse-evidence-prefilter requires --supplemental-source-db');
    }
    await stage(
      'reverse_evidence_prefilter',
      'scripts/prefilter-dictionary-v2-product-source-gap-reverse-evidence.mjs',
      [
        '--report', sourceReviewInput,
        '--out', files.reverseEvidenceFiltered,
        '--evidence-out', files.reverseEvidenceFilterDetails,
        '--supplemental-source-db', supplementalSourceDb,
        '--limit', String(reverseEvidencePrefilterLimit),
        '--min-sources', '2',
        '--min-source-families', '2',
        '--min-target-langs', String(reverseEvidenceMinimumTargetLanguages),
        ...(strongSupplementalSourceKeys
          ? ['--strong-supplemental-source-keys', strongSupplementalSourceKeys]
          : []),
        ...(reviewedSupplementalSourceKeys
          ? [
              '--allow-reviewed-supplemental-source-roundtrip', 'true',
              '--reviewed-supplemental-source-keys', reviewedSupplementalSourceKeys
            ]
          : []),
        ...(candidateBoundSourceRoundtripKeys
          ? ['--candidate-bound-source-roundtrip-keys', candidateBoundSourceRoundtripKeys]
          : [])
      ],
      [files.reverseEvidenceFiltered, files.reverseEvidenceFilterDetails]
    );
    sourceReviewInput = files.reverseEvidenceFiltered;
  }

  if (reportItemCount(sourceReviewInput) === 0) {
    const summary = {
      ok: true,
      run_id: runId,
      input_fingerprint: inputFingerprint,
      pipeline_mode: 'simplified',
      capacity_exhausted: true,
      summary: {
        input: batchItemCount,
        production_prefilter_selected: productionPrefilter
          ? reportItemCount(files.productionFiltered)
          : batchItemCount,
        production_prefilter_rejected: productionPrefilter
          ? Math.max(0, batchItemCount - reportItemCount(files.productionFiltered))
          : 0,
        daily_primary_selected: dailyPrimarySenseSelection ? reportItemCount(files.dailyPrimary) : null,
        source_sense_aligned: sourceSenseAlignment ? reportItemCount(files.senseAligned) : null,
        reverse_evidence_prefilter_selected: reverseEvidencePrefilter
          ? reportItemCount(files.reverseEvidenceFiltered)
          : null,
        source_reviewed: 0,
        gemma_source_approved: 0,
        generated_valid: 0,
        reverse_supported: 0,
        reverse_manual_review: 0,
        final_accepted: 0,
        final_rejected: 0,
        automatic_database_writes: 0
      },
      reports: {
        productionFiltered: productionPrefilter ? relative(files.productionFiltered) : null,
        dailyPrimary: dailyPrimarySenseSelection ? relative(files.dailyPrimary) : null,
        senseAligned: sourceSenseAlignment ? relative(files.senseAligned) : null,
        reverseEvidenceFiltered: reverseEvidencePrefilter
          ? relative(files.reverseEvidenceFiltered)
          : null,
        reverseEvidenceFilterDetails: reverseEvidencePrefilter
          ? relative(files.reverseEvidenceFilterDetails)
          : null,
        summary: relative(files.summary)
      }
    };
    fs.writeFileSync(files.summary, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    manifest.status = 'complete';
    manifest.capacity_exhausted = true;
    manifest.completed_at = new Date().toISOString();
    manifest.summary = summary.summary;
    writeManifest();
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  await stage('gemma_source_review', 'scripts/review-dictionary-v2-product-source-gap-candidates-unsloth.mjs', [
    '--report', sourceReviewInput,
    '--out', files.gemmaReview,
    '--approved-out', files.gemmaApproved,
    '--rejected-out', files.gemmaRejected,
    '--endpoints', gemmaEndpoints,
    '--endpoint-gguf-variants', gemmaVariants,
    '--model', gemmaModel,
    '--limit', '1000000',
    '--confidence-threshold', '0.9',
    '--max-attempts', '4',
    '--timeout-ms', '60000',
    '--circuit-breaker-failures', '2',
    '--circuit-breaker-reset-ms', '30000',
    '--resume', String(resume),
    '--retry-decisions', 'manual_review',
    '--max-seq-length', '3072',
    '--max-tokens', '900',
    '--speculative-type', 'off',
    '--prompt-mode', 'full',
    '--response-format', 'json-object',
    '--require-daily-primary', 'true',
    '--require-definition-contract', 'true',
    '--stream', 'false',
    '--prewarm', 'true',
    '--unload-before-load', String(elasticModelSwap)
  ], [files.gemmaReview, files.gemmaApproved, files.gemmaRejected]);

  await stage(
    'source_suggested_reverse_evidence',
    'scripts/validate-dictionary-v2-product-source-gap-reverse-evidence.mjs',
    [
      '--report', files.gemmaApproved,
      '--out', files.consensusReverse,
      '--supported-report', files.consensusSupported,
      '--input-mode', 'reviewed-suggested',
      '--require-source-reverse-evidence', 'true',
      '--evidence-family-policy', evidenceFamilyPolicy,
      ...additionalSenseReverseEvidenceArgs,
      ...(supplementalSourceDb ? ['--supplemental-source-db', supplementalSourceDb] : []),
      ...supplementalValidationArgs
    ],
    [files.consensusReverse, files.consensusSupported]
  );

  await stage(
    'lock_reverse_supported_terms',
    'scripts/build-dictionary-v2-product-source-gap-controlled-consensus-input.mjs',
    [
      '--review', files.consensusSupported,
      '--out', files.locked,
      '--confidence-threshold', '0.9',
      '--bind-evidence-validated-suggestions', 'true',
      '--allow-unhinted-suggestions', 'true',
      '--allow-resolved-risk-flags', 'true'
    ],
    [files.locked]
  );

  await stage('build_semantic_preview', 'scripts/build-dictionary-v2-source-gap-semantic-preview.mjs', [
    '--report', files.locked,
    '--out', files.semanticPreview
  ], [files.semanticPreview]);

  if (reportHasRows(files.locked)) await stage(
    'semantic_preview_gemma',
    'scripts/review-dictionary-v2-product-source-gap-consensus-unsloth.mjs',
    [
      '--generation', files.semanticPreview,
      '--evidence', files.consensusReverse,
      '--out', files.semanticReview,
      '--accepted-out', files.semanticAccepted,
      '--endpoints', gemmaEndpoints,
      '--endpoint-gguf-variants', gemmaVariants,
      '--model', gemmaModel,
      '--generation-model', qwenModel,
      '--only-supported', 'true',
      '--limit', '1000000',
      '--concurrency', String(gemmaConcurrency),
      '--confidence-threshold', '0.9',
      '--max-attempts', '2',
      '--max-seq-length', '2048',
      '--max-tokens', '420',
      '--prompt-mode', 'full',
      '--resume', String(resume),
      '--stream', 'true',
      '--unload-before-load', String(elasticModelSwap)
    ],
    [files.semanticReview, files.semanticAccepted]
  );
  else skipConsensusStage('semantic_preview_gemma', files.semanticReview, files.semanticAccepted);

  await stage(
    'select_semantic_accepted',
    'scripts/select-dictionary-v2-source-gap-candidates-by-review.mjs',
    [
      '--report', files.locked,
      '--review', files.semanticReview,
      '--out', files.semanticSelected,
      '--accepted-only', 'true'
    ],
    [files.semanticSelected]
  );

  await stage(
    'jmdict_generation_preflight',
    'scripts/filter-dictionary-v2-source-gap-jmdict-generation-preflight.mjs',
    ['--report', files.semanticSelected, '--out', files.generationReady],
    [files.generationReady]
  );

  const generationItems = Math.min(reportItemCount(files.generationReady), generationTarget);
  const generationPool = qwenPoolForWork(generationItems);
  await stage('qwen_generation', 'scripts/supplement-dictionary-v2-product-source-gaps-unsloth.mjs', [
    '--report', files.generationReady,
    '--out', files.generation,
    '--checkpoint', files.generationCheckpoint,
    '--endpoints', generationPool.endpoints,
    '--endpoint-gguf-variants', generationPool.variants,
    '--model', qwenModel,
    '--limit', String(generationTarget),
    '--concurrency', String(generationPool.concurrency),
    '--batch-size', '1',
    '--chunk-size', '50',
    '--max-attempts', '2',
    '--circuit-breaker-failures', '2',
    '--max-seq-length', '2048',
    '--max-tokens', '1600',
    '--speculative-type', 'mtp',
    '--prompt-mode', 'compact',
    '--stream-response', 'true',
    '--disable-thinking', 'true',
    '--require-evidence-verdict', 'false',
    '--enforce-reviewed-preferred-terms', 'true',
    '--enforce-generation-hint-terms', String(enforceGenerationHintTerms),
    '--deterministic-readings', 'true',
    '--deterministic-pronunciations', 'true',
    '--prewarm', 'true',
    '--resume', String(resume),
    '--allow-endpoint-change-on-resume', 'true',
    '--dry-run', String(executionMode !== 'draft-production'),
    '--apply', String(executionMode === 'draft-production'),
    '--publishable', 'false',
    '--allow-no-promote-draft-writes', String(executionMode === 'draft-production'),
    '--log-generated', 'true'
  ], [files.generation, files.generationCheckpoint]);

  if (executionMode === 'draft-production') {
    const generation = JSON.parse(fs.readFileSync(files.generation, 'utf8'));
    const generationStats = generation?.stats || {};
    const summary = {
      ok: true,
      run_id: runId,
      input_fingerprint: inputFingerprint,
      pipeline_mode: 'simplified',
      execution_mode: executionMode,
      release_validation_pending: true,
      summary: {
        input: batchItemCount,
        production_prefilter_selected: productionPrefilter
          ? reportItemCount(files.productionFiltered)
          : batchItemCount,
        daily_primary_selected: dailyPrimarySenseSelection ? reportItemCount(files.dailyPrimary) : null,
        source_sense_aligned: sourceSenseAlignment ? reportItemCount(files.senseAligned) : null,
        source_reviewed: reportItemCount(files.gemmaReview),
        gemma_source_approved: reportItemCount(files.gemmaApproved),
        source_reverse_supported: reportItemCount(files.consensusSupported),
        semantic_preview_accepted: reportItemCount(files.semanticAccepted),
        jmdict_generation_ready: reportItemCount(files.generationReady),
        generated_valid: Number(generationStats.accepted || 0),
        draft_senses_inserted: Number(generationStats.senses_inserted || 0),
        draft_senses_reused: Number(generationStats.senses_reused || 0),
        draft_localizations_upserted: Number(generationStats.localizations_upserted || 0),
        reverse_supported: null,
        final_accepted: null,
        automatic_database_writes: Number(generationStats.senses_inserted || 0)
      },
      reports: {
        generationReady: relative(files.generationReady),
        generation: relative(files.generation),
        checkpoint: relative(files.generationCheckpoint),
        summary: relative(files.summary)
      }
    };
    fs.writeFileSync(files.summary, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    manifest.status = 'complete';
    manifest.completed_at = new Date().toISOString();
    manifest.release_validation_pending = true;
    manifest.summary = summary.summary;
    writeManifest();
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  await stage('reverse_evidence', 'scripts/validate-dictionary-v2-product-source-gap-reverse-evidence.mjs', [
    '--report', files.generation,
    '--out', files.reverse,
    '--supported-report', files.reverseSupported,
    '--input-mode', 'generated',
    '--require-source-reverse-evidence', 'true',
    '--evidence-family-policy', evidenceFamilyPolicy,
    ...additionalSenseReverseEvidenceArgs,
    ...(supplementalSourceDb ? ['--supplemental-source-db', supplementalSourceDb] : []),
    ...supplementalValidationArgs
  ], [files.reverse, files.reverseSupported]);

  if (reportHasRows(files.reverseSupported)) await stage('final_gemma', 'scripts/review-dictionary-v2-product-source-gap-consensus-unsloth.mjs', [
    '--generation', files.generation,
    '--evidence', files.reverse,
    '--out', files.finalGemma,
    '--accepted-out', files.finalAccepted,
    '--endpoints', gemmaEndpoints,
    '--endpoint-gguf-variants', gemmaVariants,
    '--model', gemmaModel,
    '--generation-model', qwenModel,
    '--only-supported', 'true',
    '--limit', '1000000',
    '--concurrency', String(gemmaConcurrency),
    '--confidence-threshold', '0.9',
    '--max-attempts', '2',
    '--max-seq-length', '3072',
    '--max-tokens', '650',
    '--prompt-mode', 'full',
    '--resume', String(resume),
    '--retry-decisions', 'manual_review',
    '--stream', 'false',
    '--unload-before-load', String(elasticModelSwap)
  ], [files.finalGemma, files.finalAccepted]);
  else skipConsensusStage('final_gemma', files.finalGemma, files.finalAccepted);

  const gemmaSource = JSON.parse(fs.readFileSync(files.gemmaReview, 'utf8'));
  const generation = JSON.parse(fs.readFileSync(files.generation, 'utf8'));
  const reverse = JSON.parse(fs.readFileSync(files.reverse, 'utf8'));
  const finalReview = JSON.parse(fs.readFileSync(files.finalGemma, 'utf8'));
  const summary = {
    ok: true,
    run_id: runId,
    input_fingerprint: inputFingerprint,
    pipeline_mode: 'simplified',
    summary: {
      input: batchItemCount,
      production_prefilter_selected: productionPrefilter
        ? reportItemCount(files.productionFiltered)
        : batchItemCount,
      production_prefilter_rejected: productionPrefilter
        ? Math.max(0, batchItemCount - reportItemCount(files.productionFiltered))
        : 0,
      daily_primary_selected: dailyPrimarySenseSelection ? reportItemCount(files.dailyPrimary) : null,
      reverse_evidence_prefilter_selected: reverseEvidencePrefilter
        ? reportItemCount(files.reverseEvidenceFiltered)
        : null,
      source_sense_aligned: sourceSenseAlignment ? reportItemCount(files.senseAligned) : null,
      source_reviewed: Number(gemmaSource?.summary?.reviewed || 0),
      gemma_source_approved: Number(gemmaSource?.summary?.approved || 0),
      source_reverse_supported: reportItemCount(files.consensusSupported),
      semantic_preview_accepted: Number(
        JSON.parse(fs.readFileSync(files.semanticReview, 'utf8'))?.summary?.consensus_accepted || 0
      ),
      jmdict_generation_ready: reportItemCount(files.generationReady),
      generated_valid: Number(generation?.stats?.accepted || 0),
      reverse_supported: Number(reverse?.summary?.decisions?.supported || 0),
      reverse_manual_review: Number(reverse?.summary?.decisions?.manual_review || 0),
      final_accepted: Number(finalReview?.summary?.consensus_accepted || 0),
      final_rejected: Number(finalReview?.summary?.rejected || 0),
      automatic_database_writes: 0
    },
    reports: {
      gemmaSourceReview: relative(files.gemmaReview),
      gemmaSourceApproved: relative(files.gemmaApproved),
      sourceSuggestedReverse: relative(files.consensusReverse),
      sourceSuggestedSupported: relative(files.consensusSupported),
      semanticPreview: relative(files.semanticPreview),
      semanticReview: relative(files.semanticReview),
      semanticSelected: relative(files.semanticSelected),
      generationReady: relative(files.generationReady),
      generation: relative(files.generation),
      reverse: relative(files.reverse),
      finalGemma: relative(files.finalGemma),
      finalAccepted: relative(files.finalAccepted),
      summary: relative(files.summary)
    }
  };
  fs.writeFileSync(files.summary, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  manifest.status = 'complete';
  manifest.completed_at = new Date().toISOString();
  manifest.summary = summary.summary;
  writeManifest();
  console.log(JSON.stringify(summary, null, 2));
}

async function runReleaseValidationPipeline() {
  if (!sourceRunDir) {
    throw new Error('--execution-mode release-validation requires --source-run-dir');
  }
  const generationReport = path.join(sourceRunDir, '05-qwen-generation.json');
  const generationReadyReport = path.join(sourceRunDir, '04f-generation-ready-candidates.json');
  if (!fs.existsSync(generationReport)) {
    throw new Error(`Source generation report not found: ${generationReport}`);
  }
  if (!fs.existsSync(generationReadyReport)) {
    throw new Error(`Source generation-ready report not found: ${generationReadyReport}`);
  }

  await stage('reverse_evidence', 'scripts/validate-dictionary-v2-product-source-gap-reverse-evidence.mjs', [
    '--report', generationReport,
    '--out', files.reverse,
    '--supported-report', files.reverseSupported,
    '--input-mode', 'generated',
    '--require-source-reverse-evidence', 'true',
    '--evidence-family-policy', evidenceFamilyPolicy,
    ...additionalSenseReverseEvidenceArgs,
    ...(supplementalSourceDb ? ['--supplemental-source-db', supplementalSourceDb] : []),
    ...supplementalValidationArgs
  ], [files.reverse, files.reverseSupported]);

  if (reportHasRows(files.reverseSupported)) await stage('final_gemma', 'scripts/review-dictionary-v2-product-source-gap-consensus-unsloth.mjs', [
    '--generation', generationReport,
    '--evidence', files.reverse,
    '--out', files.finalGemma,
    '--accepted-out', files.finalAccepted,
    '--endpoints', gemmaEndpoints,
    '--endpoint-gguf-variants', gemmaVariants,
    '--model', gemmaModel,
    '--generation-model', qwenModel,
    '--only-supported', 'true',
    '--limit', '1000000',
    '--concurrency', String(gemmaConcurrency),
    '--confidence-threshold', '0.9',
    '--max-attempts', '2',
    '--max-seq-length', '3072',
    '--max-tokens', '650',
    '--prompt-mode', 'full',
    '--resume', String(resume),
    '--retry-decisions', 'manual_review',
    '--stream', 'false',
    '--unload-before-load', String(elasticModelSwap)
  ], [files.finalGemma, files.finalAccepted]);
  else skipConsensusStage('final_gemma', files.finalGemma, files.finalAccepted);

  const reverse = JSON.parse(fs.readFileSync(files.reverse, 'utf8'));
  const finalReview = JSON.parse(fs.readFileSync(files.finalGemma, 'utf8'));
  const summary = {
    ok: true,
    run_id: runId,
    input_fingerprint: inputFingerprint,
    pipeline_mode: pipelineMode,
    execution_mode: executionMode,
    source_run_dir: relative(sourceRunDir),
    summary: {
      input: batchItemCount,
      jmdict_generation_ready: reportItemCount(generationReadyReport),
      generated_valid: reportItemCount(generationReport),
      reverse_supported: Number(reverse?.summary?.decisions?.supported || 0),
      reverse_manual_review: Number(reverse?.summary?.decisions?.manual_review || 0),
      final_accepted: Number(finalReview?.summary?.consensus_accepted || 0),
      final_rejected: Number(finalReview?.summary?.rejected || 0),
      automatic_database_writes: 0
    },
    reports: {
      sourceGeneration: relative(generationReport),
      reverse: relative(files.reverse),
      reverseSupported: relative(files.reverseSupported),
      finalGemma: relative(files.finalGemma),
      finalAccepted: relative(files.finalAccepted),
      summary: relative(files.summary)
    }
  };
  fs.writeFileSync(files.summary, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  manifest.status = 'complete';
  manifest.completed_at = new Date().toISOString();
  manifest.summary = summary.summary;
  writeManifest();
  console.log(JSON.stringify(summary, null, 2));
}

async function stage(name, script, stageArgs, expectedOutputs) {
  const existing = manifest.stages[name];
  if (resume && existing?.status === 'complete' && outputsMatch(existing.outputs, expectedOutputs)) {
    console.log(`[resume] ${name}`);
    return;
  }
  if (resume && existing?.status !== 'complete') {
    const recovery = inspectCompletedPipelineStage(name, expectedOutputs);
    if (recovery.recoverable) {
      manifest.stages[name] = {
        ...existing,
        status: 'complete',
        exit_code: 0,
        completed_at: new Date().toISOString(),
        recovered_at: new Date().toISOString(),
        recovery_reason: recovery.reason,
        recovery_counts: {
          selected: recovery.selected,
          accepted: recovery.accepted,
          rejected: recovery.rejected
        },
        output_item_counts: Object.fromEntries(
          expectedOutputs.map((filePath) => [relative(filePath), safeReportItemCount(filePath)])
        ),
        outputs: expectedOutputs.map((filePath) => ({ path: relative(filePath), sha256: sha256File(filePath) }))
      };
      writeManifest();
      console.log(`[resume] recovered ${name} from complete durable outputs`);
      return;
    }
  }
  const discovery = await expandStageEndpointPool(script, stageArgs);
  stageArgs = discovery.args;
  const logPath = output(`${name}.log`);
  manifest.stages[name] = {
    status: 'running',
    started_at: new Date().toISOString(),
    script,
    args: redactArgs(stageArgs),
    log: relative(logPath),
    ...(discovery.report ? { endpoint_discovery: discovery.report } : {})
  };
  writeManifest();
  const started = performance.now();
  const exitCode = await runNode(script, stageArgs, logPath);
  if (exitCode !== 0) {
    manifest.stages[name] = { ...manifest.stages[name], status: 'failed', exit_code: exitCode };
    writeManifest();
    throw new Error(`Stage ${name} failed with exit code ${exitCode}`);
  }
  for (const filePath of expectedOutputs) {
    if (!fs.existsSync(filePath)) throw new Error(`Stage ${name} did not produce ${filePath}`);
  }
  manifest.stages[name] = {
    ...manifest.stages[name],
    status: 'complete',
    exit_code: 0,
    completed_at: new Date().toISOString(),
    duration_seconds: Math.round((performance.now() - started) / 10) / 100,
    output_item_counts: Object.fromEntries(
      expectedOutputs.map((filePath) => [relative(filePath), safeReportItemCount(filePath)])
    ),
    outputs: expectedOutputs.map((filePath) => ({ path: relative(filePath), sha256: sha256File(filePath) }))
  };
  writeManifest();
}

async function expandStageEndpointPool(script, stageArgs) {
  if (!dynamicEndpointDiscovery || !/unsloth/u.test(script) || !optionValue(stageArgs, '--endpoints')) {
    return { args: stageArgs, report: null };
  }
  const model = optionValue(stageArgs, '--model');
  if (!model) return { args: stageArgs, report: null };
  const configuredEndpoints = csvValues(optionValue(stageArgs, '--endpoints'));
  const configuredVariants = parseVariantCsv(optionValue(stageArgs, '--endpoint-gguf-variants'));
  const discovered = await discoverUnslothStagePool({
    dashboardUrl: clusterStatusUrl,
    configuredEndpoints,
    configuredVariants,
    model,
    token,
    serviceUser: clusterServiceUser,
    requireInstalled: !allowModelDownload
  });
  const resolvedArgs = [...stageArgs];
  setOptionValue(resolvedArgs, '--endpoints', discovered.endpoints.join(','));
  setOptionValue(
    resolvedArgs,
    '--endpoint-gguf-variants',
    [...discovered.variants.entries()].map(([port, variant]) => `${port}=${variant}`).join(',')
  );
  if (optionValue(resolvedArgs, '--concurrency') !== null) {
    setOptionValue(resolvedArgs, '--concurrency', String(discovered.endpoints.length));
  }
  console.log(`[cluster] stage=${script} endpoints=${discovered.endpoints.map(endpointPort).join(',')} dynamic=${discovered.ok}`);
  return {
    args: resolvedArgs,
    report: {
      checked_at: new Date().toISOString(),
      ok: discovered.ok,
      degraded: discovered.degraded,
      reason: discovered.reason || null,
      selected: discovered.selected,
      excluded: discovered.excluded
    }
  };
}

function optionValue(values, name) {
  const index = values.indexOf(name);
  return index >= 0 && index + 1 < values.length ? String(values[index + 1]) : null;
}

function setOptionValue(values, name, value) {
  const index = values.indexOf(name);
  if (index >= 0 && index + 1 < values.length) values[index + 1] = value;
  else values.push(name, value);
}

function runNode(script, stageArgs, logPath) {
  return runChildProcessWithLog({
    command: process.execPath,
    args: [script, ...stageArgs],
    cwd: process.cwd(),
    env: {
      ...process.env,
      UNSLOTH_REQUIRE_INSTALLED_MODEL: allowModelDownload ? '0' : '1'
    },
    logPath,
    // Scheduled tasks have no reader for stdout. Forwarding every child report can
    // fill the Windows pipe and leave an otherwise completed pipeline stuck.
    echoOutput: Boolean(process.stdout.isTTY),
    exitDrainTimeoutMs: 5000
  });
}

function csvValues(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function mergeCsv(...values) {
  return [...new Set(values.flatMap(csvValues))].join(',');
}

function qwenPoolForWork(itemCount) {
  const useElastic = elasticModelSwap && itemCount >= elasticMinimumItems;
  const endpoints = useElastic ? mergeCsv(qwenEndpoints, elasticEndpoints) : qwenEndpoints;
  const allVariants = useElastic ? mergeCsv(qwenVariants, elasticQwenVariants) : qwenVariants;
  const variants = variantsForEndpoints(allVariants, endpoints);
  return { endpoints, variants, concurrency: csvValues(endpoints).length, use_elastic: useElastic, item_count: itemCount };
}

function variantsForEndpoints(variants, endpoints) {
  const allowedPorts = new Set(csvValues(endpoints).map(endpointPort));
  return csvValues(variants)
    .filter((item) => allowedPorts.has(item.split('=', 1)[0]))
    .join(',');
}

function reportItemCount(filePath) {
  const report = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  for (const key of ['selected', 'candidates', 'aligned', 'generated', 'replayed', 'reviews', 'supported', 'validations', 'rows']) {
    if (Array.isArray(report[key])) return report[key].length;
  }
  return Number(report.selected_count || report.summary?.selected || report.summary?.input || 0);
}

function safeReportItemCount(filePath) {
  try { return reportItemCount(filePath); } catch { return null; }
}

async function restoreElasticReviewers() {
  if (!elasticModelSwap) return;
  const reviewerEndpoints = new Set(csvValues(gemmaEndpoints));
  const targets = csvValues(elasticEndpoints).filter((endpoint) => reviewerEndpoints.has(endpoint));
  if (!targets.length) return;
  const variants = parseVariantCsv(gemmaVariants);
  const startedAt = new Date().toISOString();
  const results = await Promise.all(
    targets.map((endpoint) => ensureUnslothModel({
      endpoint,
      token,
      model: gemmaModel,
      variant: variants.get(endpointPort(endpoint)) || null,
      maxSeqLength: 3072,
      speculativeType: 'off',
      unloadBeforeLoad: true,
      loadTimeoutMs: 300_000,
      requireInstalled: !allowModelDownload
    }))
  );
  manifest.stages.restore_elastic_reviewers = {
    status: results.every((row) => row.ok) ? 'complete' : 'degraded',
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    results
  };
  writeManifest();
}

function parseVariantCsv(value) {
  return new Map(csvValues(value).map((item) => {
    const separator = item.indexOf('=');
    return separator > 0 ? [item.slice(0, separator), item.slice(separator + 1)] : [item, ''];
  }));
}

function endpointPort(endpoint) {
  return new URL(endpoint).port;
}

function buildSummary(paths) {
  const read = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const qwen = read(paths.qwenReview);
  const gemma = read(paths.gemmaReview);
  const consensus = read(paths.consensus);
  const consensusReverse = read(paths.consensusReverse);
  const semanticReview = read(paths.semanticReview);
  const semanticRepairInput = read(paths.semanticRepairInput);
  const semanticRepairGeneration = read(paths.semanticRepairGeneration);
  const semanticRepairFinal = read(paths.semanticRepairFinal);
  const generationReady = read(paths.generationReady);
  const generation = read(paths.generation);
  const reverse = read(paths.reverse);
  const final = read(paths.finalGemma);
  const repairInput = read(paths.repairInput);
  const repairGeneration = read(paths.repairGeneration);
  const repairFinal = read(paths.repairFinalGemma);
  const initialAccepted = Number(final?.summary?.consensus_accepted || 0);
  const repairAccepted = Number(repairFinal?.summary?.consensus_accepted || 0);
  const semanticRepairAccepted = Number(semanticRepairFinal?.summary?.consensus_accepted || 0);
  return {
    ok: true,
    run_id: runId,
    input_fingerprint: inputFingerprint,
    summary: {
      input: Number(qwen?.summary?.reviewed || 0),
      qwen_source_approved: Number(qwen?.summary?.approved || 0),
      gemma_source_approved: Number(gemma?.summary?.approved || 0),
      source_consensus: Number(consensus?.summary?.agreed || 0),
      source_consensus_reverse_supported: Number(consensusReverse?.summary?.decisions?.supported || 0),
      semantic_preview_accepted: Number(semanticReview?.summary?.consensus_accepted || 0),
      semantic_repair_selected: Number(semanticRepairInput?.summary?.selected || 0),
      semantic_repair_generated_valid: Number(semanticRepairGeneration?.stats?.accepted || 0),
      semantic_repair_final_accepted: semanticRepairAccepted,
      generation_preflight_ready: Number(generationReady?.selected_count || 0),
      generation_preflight_rejected: Number(generationReady?.jmdict_preflight_summary?.rejected || 0),
      generation_target: generationTarget,
      generated_valid: Number(generation?.stats?.accepted || 0),
      reverse_supported: Number(reverse?.summary?.decisions?.supported || 0),
      final_accepted: Number(final?.summary?.consensus_accepted || 0),
      repair_selected: Number(repairInput?.summary?.selected || 0),
      repair_generated_valid: Number(repairGeneration?.stats?.accepted || 0),
      repair_final_accepted: repairAccepted,
      total_final_accepted: initialAccepted + repairAccepted + semanticRepairAccepted,
      automatic_database_writes: 0
    },
    reports: Object.fromEntries(Object.entries(paths).map(([key, filePath]) => [key, relative(filePath)]))
  };
}

function buildSourceScreenSummary(paths) {
  const read = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const qwen = read(paths.qwenReview);
  const gemma = read(paths.gemmaReview);
  const consensus = read(paths.consensus);
  const reverse = read(paths.consensusReverse);
  return {
    ok: true,
    run_id: runId,
    input_fingerprint: inputFingerprint,
    source_screen_only: true,
    summary: {
      input: Number(qwen?.summary?.reviewed || 0),
      qwen_source_approved: Number(qwen?.summary?.approved || 0),
      gemma_source_approved: Number(gemma?.summary?.approved || 0),
      source_consensus: Number(consensus?.summary?.agreed || 0),
      source_consensus_reverse_supported: Number(reverse?.summary?.decisions?.supported || 0),
      automatic_database_writes: 0
    },
    reports: {
      qwenReview: relative(paths.qwenReview),
      gemmaReview: relative(paths.gemmaReview),
      consensus: relative(paths.consensus),
      consensusReverse: relative(paths.consensusReverse),
      consensusSupported: relative(paths.consensusSupported),
      summary: relative(paths.summary)
    }
  };
}

function reportHasRows(filePath) {
  const report = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return ['selected', 'candidates', 'rows', 'reviews', 'generated', 'validations']
    .some((key) => Array.isArray(report?.[key]) && report[key].length > 0);
}

function skipConsensusStage(name, outPath, acceptedPath) {
  const empty = {
    ok: true,
    skipped: true,
    reason: 'no_supported_candidates',
    summary: {
      targeted: 0,
      valid: 0,
      accepted: 0,
      rejected: 0,
      manual_review: 0,
      consensus_accepted: 0,
      failed: 0
    },
    reviews: []
  };
  fs.writeFileSync(outPath, `${JSON.stringify(empty, null, 2)}\n`, 'utf8');
  fs.writeFileSync(acceptedPath, `${JSON.stringify(empty, null, 2)}\n`, 'utf8');
  manifest.stages[name] = {
    status: 'skipped',
    reason: empty.reason,
    completed_at: new Date().toISOString(),
    outputs: [outPath, acceptedPath].map((filePath) => ({ path: relative(filePath), sha256: sha256File(filePath) }))
  };
  writeManifest();
}

function outputsMatch(recorded, expected) {
  if (!Array.isArray(recorded) || recorded.length !== expected.length) return false;
  return expected.every((filePath) => {
    const item = recorded.find((row) => path.resolve(row.path) === path.resolve(filePath));
    return item && fs.existsSync(filePath) && item.sha256 === sha256File(filePath);
  });
}

function loadManifest() {
  if (!fs.existsSync(manifestPath)) return {};
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function writeManifest() {
  const temporary = `${manifestPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.rmSync(manifestPath, { force: true });
  fs.renameSync(temporary, manifestPath);
}

function output(name) { return path.join(runDir, name); }
function sourceOutput(name) { return path.join(sourceRunDir || runDir, name); }
function relative(filePath) { return path.relative(process.cwd(), filePath); }
function sha256File(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); }
function redactArgs(values) { return values.map((value) => /sk-[a-z0-9]/iu.test(String(value)) ? '<redacted>' : value); }

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const filePath = path.resolve(value);
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return filePath;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return parsed;
}
