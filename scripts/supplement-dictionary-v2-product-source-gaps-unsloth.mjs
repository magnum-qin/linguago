import './lib/load-local-env.mjs';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { pinyin } from 'pinyin-pro';
import * as OpenCC from 'opencc-js';
import { definitionContractLanguageLooksRight } from './lib/source-review-contract.mjs';
import {
  compositionalJapanesePhraseReadings,
  compositionalJapaneseNumberReadings,
  normalizeJapaneseKanaReading,
  selectCanonicalJapaneseReading,
  transparentJapaneseCompoundReadings
} from './lib/japanese-reading-contract.mjs';

const LANGS = ['en', 'pt-BR', 'zh', 'ja'];
const DEFAULT_DB = 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const DEFAULT_REPORT = 'logs/product-incomplete-gap-senses-after-repair-20260622.json';
const DEFAULT_ENDPOINTS = [
  'http://100.99.99.99:11441',
  'http://100.99.99.99:11444',
  'http://100.99.99.99:11448',
  'http://100.99.99.99:11447'
];
const DEFAULT_MODEL = 'unsloth/Qwen3.6-35B-A3B-MTP-GGUF';
const SOURCE = 'unsloth:source-gap-supplement-20260622';
const HTML_ENTITY_RE = /&(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#[0-9]{1,7}|#x[0-9a-fA-F]{1,6});/u;
const REPLACEMENT_CHAR_RE = /[\uFFFD]/u;
const LATIN1_MOJIBAKE_RE = /(?:\u00c3[\u0080-\u00bf]|\u00c2[\u0080-\u00bf]|\u00e2[\u0080-\u00bf]{1,2})/u;
const JAPANESE_MOJIBAKE_RE = /[\u9287\u9288\u9289][\u3040-\u30ff\u4e00-\u9fff]?/u;
const traditionalToSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });
const MAINLAND_VARIANT_REPLACEMENTS = new Map([
  ['擡', '抬']
]);
const MANUAL_RESIDUAL_SOURCE_ENTRY_IDS = new Set([2512756, 2482999, 2734525, 2607307, 2639444, 2399378, 2649794]);
const FUNCTION_GLOSSES = new Set([
  'a',
  'an',
  'the',
  'of',
  'to',
  'in',
  'on',
  'at',
  'for',
  'from',
  'by',
  'with',
  'and',
  'or',
  'but',
  'if',
  'as',
  'this',
  'that',
  'these',
  'those',
  'my',
  'your',
  'his',
  'her',
  'their',
  'our',
  'its',
  'neither',
  'all',
  'one',
  'two'
]);

// Keep this list narrow: each alias must resolve to a term that is present in
// the bundled JMdict snapshot and has the same modern lexical meaning.
const JMDICT_CANONICAL_TERM_ALIASES = new Map([
  ['側弯症', '側彎症'],
  ['脊柱側弯症', '脊柱側彎症']
]);

// Productive expressions that are read compositionally but are not standalone
// JMdict headwords. Additions require an exact term and one unambiguous reading.
const VERIFIED_JAPANESE_COMPOSITIONAL_READINGS = new Map([
  ['百分の一', new Set(['ひゃくぶんのいち'])]
]);

// Productive suffixes may form valid dictionary terms even when JMdict only
// contains the base. The base reading must still come from JMdict exactly.
const JMDICT_COMPOSITIONAL_SUFFIX_READINGS = new Map([
  ['化', 'か'],
  ['患者', 'かんじゃ'],
  ['可能な', 'かのうな']
]);

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const reportPath = path.resolve(args.report || DEFAULT_REPORT);
const token = args.token || process.env.UNSLOTH_API_KEY;
const endpoints = String(args.endpoints || DEFAULT_ENDPOINTS.join(','))
  .split(',')
  .map((item) => item.trim().replace(/\/$/, ''))
  .filter(Boolean);
const model = args.model || DEFAULT_MODEL;
const sourceLangFilter = parseSourceLangFilter(args['source-langs']);
const onlySourceEntryIds = parseIntegerSet(args['only-source-entry-ids'], 'only-source-entry-ids');
const limit = Number(args.limit || 8);
const concurrency = Number(args.concurrency || Math.min(4, endpoints.length));
const batchSize = Number(args['batch-size'] || 1);
const endpointConcurrency = parseEndpointConcurrency(args['endpoint-concurrency'], endpoints);
const dryRun = args['dry-run'] === 'true';
const apply = args.apply === 'true' || args.apply === true;
const selectOnly = args['select-only'] === 'true';
const includeRisky = args['include-risky'] === 'true';
const prewarm = args.prewarm !== 'false';
const forceReload = args['force-reload'] === 'true';
const quiet = args.quiet === 'true';
const timeoutMs = Number(args['timeout-ms'] || 180_000);
const loadTimeoutMs = Number(args['load-timeout-ms'] || 300_000);
const postLoadWaitMs = Number(args['post-load-wait-ms'] || 15_000);
const maxTokens = args['max-tokens'] ? Number(args['max-tokens']) : null;
const logGenerated = args['log-generated'] === 'true' || (dryRun && args['log-generated'] !== 'false');
const ggufVariant = args['gguf-variant'] || null;
const endpointGgufVariants = parseEndpointStringMap(
  args['endpoint-gguf-variants'],
  endpoints,
  'endpoint-gguf-variants'
);
const maxSeqLength = Number(args['max-seq-length'] || 8192);
const speculativeType = normalizeSpeculativeType(args['speculative-type'] || 'mtp');
const loadIn4bit = args['load-in-4bit'] !== 'false';
const residualMode = args['residual-mode'] === 'true';
const promptMode = args['prompt-mode'] || 'compact';
const minimalRequest = args['minimal-request'] === 'true';
const streamResponse = args['stream-response'] === 'true';
const chatPath = normalizeChatPath(args['chat-path'] || '/v1/chat/completions');
const disableThinking = args['disable-thinking'] !== 'false';
const skipExistingDrafts = args['skip-existing-drafts'] !== 'false';
const requireEvidenceVerdict = args['require-evidence-verdict'] === 'true';
const replayReportPath = args['replay-report'] ? path.resolve(args['replay-report']) : null;
const replayInvalidOutputs = args['replay-invalid-outputs'] === 'true';
const controlledConsensusDraftWrite = args['controlled-consensus-draft-write'] === 'true';
const replayReportStats = replayReportPath && fs.existsSync(replayReportPath)
  ? JSON.parse(fs.readFileSync(replayReportPath, 'utf8'))?.stats || null
  : null;
const enforceReviewedPreferredTerms = args['enforce-reviewed-preferred-terms'] === undefined
  ? args['controlled-consensus-draft-write'] === 'true'
    ? false
    : replayReportStats?.enforce_reviewed_preferred_terms !== false
  : args['enforce-reviewed-preferred-terms'] !== 'false';
const enforceGenerationHintTerms = args['enforce-generation-hint-terms'] === 'true';
const requireExamples = args['require-examples'] === 'true';
const qualityReview = args['quality-review'] === 'true';
const qualityReviewConfidence = Number(args['quality-review-confidence'] || 0.9);
const qualityReviewMaxTokens = Number(args['quality-review-max-tokens'] || 260);
const deferEvidenceBoundQualityRejects = args['defer-evidence-bound-quality-rejects'] === 'true';
const pronunciationReview = args['pronunciation-review'] === 'true';
const pronunciationReviewMaxTokens = Number(args['pronunciation-review-max-tokens'] || 260);
const pronunciationRepair = args['pronunciation-repair'] !== 'false';
const pronunciationRepairMaxTokens = Number(args['pronunciation-repair-max-tokens'] || 180);
const deterministicReadings = args['deterministic-readings'] !== 'false';
const deterministicPronunciations = args['deterministic-pronunciations'] !== 'false';
const jmdictIndexOnly = args['jmdict-index-only'] === 'true';
const jmdictPath = path.resolve(args.jmdict || 'data/raw/JMdict_e.gz');
const sourceDbPath = path.resolve(args['source-db'] || 'data/processed/linguago_v2_full.db');
const ptPronunciationDbPath = path.resolve(
  args['pt-pronunciation-db'] || 'data/processed/kaikki_portuguese_pronunciations.db'
);
let jmdictReadingMap = null;
let deterministicSourceDb = null;
let findEcdictPronunciation = null;
let ptPronunciationDb = null;
let findPortuguesePronunciation = null;
const chunkSize = Number(args['chunk-size'] || 50);
const checkpointPath = args.checkpoint ? path.resolve(args.checkpoint) : null;
const resume = args.resume === 'true';
const allowEndpointChangeOnResume = args['allow-endpoint-change-on-resume'] === 'true';
const maxAttempts = Number(args['max-attempts'] || 2);
const circuitBreakerFailures = Number(args['circuit-breaker-failures'] || 2);
const circuitBreakerResetMs = Number(args['circuit-breaker-reset-ms'] || 30_000);
const endpointCooldownMs = Number(args['endpoint-cooldown-ms'] || 0);
const publishable = args.publishable === 'true';
const appliedEntryStatus = publishable ? 'accepted' : 'draft_single_source';
const appliedSenseStatus = publishable ? 'accepted' : 'draft_single_source';
const appliedLocalizationNeedsReview = publishable ? 0 : 1;
const outPath = path.resolve(
  args.out || `logs/product-source-gap-unsloth-${apply ? 'apply' : 'dry-run'}-20260622.json`
);
const eligibleReportPath = args['eligible-report'] ? path.resolve(args['eligible-report']) : null;

if (!fs.existsSync(dbPath)) throw new Error(`Product DB not found: ${dbPath}`);
if (!fs.existsSync(reportPath)) throw new Error(`Gap report not found: ${reportPath}`);
if (!selectOnly && !replayReportPath && !token) throw new Error('Missing --token or UNSLOTH_API_KEY');
if (replayReportPath && !fs.existsSync(replayReportPath)) {
  throw new Error(`Replay report not found: ${replayReportPath}`);
}
if (controlledConsensusDraftWrite && !replayReportPath) {
  throw new Error('--controlled-consensus-draft-write requires --replay-report');
}
if (controlledConsensusDraftWrite && publishable) {
  throw new Error('--controlled-consensus-draft-write cannot be combined with --publishable true');
}
if (!endpoints.length) throw new Error('No endpoints configured');
if (!Number.isInteger(limit) || limit < 1) throw new Error(`Invalid --limit: ${args.limit}`);
if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error(`Invalid --concurrency: ${args.concurrency}`);
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 12)
  throw new Error(`Invalid --batch-size: ${args['batch-size']}`);
if (promptMode === 'micro' && batchSize !== 1) throw new Error('--prompt-mode micro requires --batch-size 1');
if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new Error(`Invalid --chunk-size: ${args['chunk-size']}`);
if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
  throw new Error(`Invalid --max-attempts: ${args['max-attempts']}`);
}
if (!Number.isInteger(circuitBreakerFailures) || circuitBreakerFailures < 1) {
  throw new Error(`Invalid --circuit-breaker-failures: ${args['circuit-breaker-failures']}`);
}
if (!Number.isInteger(circuitBreakerResetMs) || circuitBreakerResetMs < 10 || circuitBreakerResetMs > 600_000) {
  throw new Error(`Invalid --circuit-breaker-reset-ms: ${args['circuit-breaker-reset-ms']}`);
}
if (!Number.isInteger(endpointCooldownMs) || endpointCooldownMs < 0 || endpointCooldownMs > 30_000) {
  throw new Error(`Invalid --endpoint-cooldown-ms: ${args['endpoint-cooldown-ms']}`);
}
if (maxTokens !== null && (!Number.isInteger(maxTokens) || maxTokens < 128)) {
  throw new Error(`Invalid --max-tokens: ${args['max-tokens']}`);
}
if (!Number.isFinite(qualityReviewConfidence) || qualityReviewConfidence < 0 || qualityReviewConfidence > 1) {
  throw new Error(`Invalid --quality-review-confidence: ${args['quality-review-confidence']}`);
}
if (!Number.isInteger(qualityReviewMaxTokens) || qualityReviewMaxTokens < 128) {
  throw new Error(`Invalid --quality-review-max-tokens: ${args['quality-review-max-tokens']}`);
}
if (!Number.isInteger(pronunciationReviewMaxTokens) || pronunciationReviewMaxTokens < 96) {
  throw new Error(`Invalid --pronunciation-review-max-tokens: ${args['pronunciation-review-max-tokens']}`);
}
if (!Number.isInteger(pronunciationRepairMaxTokens) || pronunciationRepairMaxTokens < 96) {
  throw new Error(`Invalid --pronunciation-repair-max-tokens: ${args['pronunciation-repair-max-tokens']}`);
}
if (!Number.isInteger(maxSeqLength) || maxSeqLength < 512) {
  throw new Error(`Invalid --max-seq-length: ${args['max-seq-length']}`);
}
if (!Number.isInteger(postLoadWaitMs) || postLoadWaitMs < 0 || postLoadWaitMs > 120_000) {
  throw new Error(`Invalid --post-load-wait-ms: ${args['post-load-wait-ms']}`);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const allRows = report.selected || report.residuals || [];
const noPromoteSourceEntryIds = new Set(
  allRows
    .filter((row) => row?.promote_allowed === false)
    .map((row) => String(Number(row.source_entry_id)))
);
const replaySourceEntryIds = replayReportPath ? loadReplaySourceEntryIds(replayReportPath) : null;
const checkpointConfig = buildCheckpointConfig();
const checkpoint = loadCheckpoint();
const checkpointCompleted = new Set(
  Object.values(checkpoint?.items || {})
    .filter((item) => item?.status === 'accepted' || item?.status === 'rejected')
    .map((item) => checkpointCandidateKey(item))
);
// --limit is the total run target. A resumed run only fills the unfinished remainder.
// Replay is exact over its approved report, so the normal generation limit
// must not truncate matching rows that occur later in the gap report.
const selectionLimit = replaySourceEntryIds
  ? Number.MAX_SAFE_INTEGER
  : resume
    ? Math.max(0, limit - checkpointCompleted.size)
    : limit;
const eligibilityDb = new Database(dbPath, { readonly: true });
const existingCompleteSense = eligibilityDb.prepare(`
  SELECT ps.id
  FROM product_entries pe
  JOIN product_senses ps ON ps.product_entry_id = pe.id
  JOIN product_localizations pl ON pl.product_sense_id = ps.id
  WHERE pe.group_key = ?
    AND ps.gloss_key = ?
    AND ps.status = 'accepted'
    AND COALESCE(pl.needs_review, 0) = 0
  GROUP BY ps.id
  HAVING COUNT(DISTINCT pl.lang) = 4
  LIMIT 1
`);
const existingLinkedCompleteSense = eligibilityDb.prepare(`
  SELECT ps.id
  FROM product_sense_source_links link
  JOIN product_senses ps ON ps.id = link.product_sense_id
  JOIN product_localizations pl ON pl.product_sense_id = ps.id
  WHERE link.source_sense_id = ?
    AND ps.status = 'accepted'
    AND COALESCE(pl.needs_review, 0) = 0
  GROUP BY ps.id
  HAVING COUNT(DISTINCT pl.lang) = 4
  LIMIT 1
`);
const existingLinkedDraftOrCompleteSense = eligibilityDb.prepare(`
  SELECT ps.id
  FROM product_sense_source_links link
  JOIN product_senses ps ON ps.id = link.product_sense_id
  WHERE link.source_sense_id = ?
    AND ps.status IN ('accepted', 'draft_single_source')
  LIMIT 1
`);
const acceptedSemanticSenseIndex = buildAcceptedSemanticSenseIndex(
  eligibilityDb.prepare(`
    SELECT pl.product_sense_id, pl.lang, pl.term
    FROM product_localizations pl
    JOIN product_senses ps ON ps.id = pl.product_sense_id
    WHERE ps.status IN ('accepted', 'draft_single_source')
  `).all()
);
const rejectedBeforeGeneration = [];
const selected = [];
for (const row of allRows) {
  if (selected.length >= selectionLimit) break;
  if (replaySourceEntryIds && !replaySourceEntryIds.has(Number(row?.source_entry_id))) continue;
  if (onlySourceEntryIds && !onlySourceEntryIds.has(Number(row?.source_entry_id))) continue;
  if (sourceLangFilter && !sourceLangFilter.has(row?.source_lang)) continue;
  if (checkpointCompleted.has(checkpointCandidateKey(row))) {
    rejectedBeforeGeneration.push({
      source_entry_id: row?.source_entry_id,
      source_sense_id: row?.first_sense_id ?? row?.source_sense_id ?? null,
      word: row?.word,
      source_lang: row?.source_lang,
      frequency_rank: row?.frequency_rank,
      reason: 'checkpoint_completed'
    });
    continue;
  }
  const eligibility = candidateEligibility(row);
  if (!eligibility.ok) {
    rejectedBeforeGeneration.push({
      source_entry_id: row?.source_entry_id,
      source_sense_id: row?.first_sense_id ?? row?.source_sense_id ?? null,
      word: row?.word,
      source_lang: row?.source_lang,
      frequency_rank: row?.frequency_rank,
      reason: eligibility.reason
    });
    continue;
  }
  selected.push(row);
}
eligibilityDb.close();

if (jmdictIndexOnly) {
  await preloadJmdictReadingMap();
  console.log(
    JSON.stringify(
      {
        ok: true,
        terms: jmdictReadingMap.size,
        samples: Object.fromEntries(
          ['湿布', '小便器', '色素', '静脈内の', '際立つ', 'ナショナリズム'].map((term) => [
            term,
            [...(jmdictReadingMap.get(term) || [])]
          ])
        )
      },
      null,
      2
    )
  );
  process.exit(0);
}

if (selectOnly) {
  const stats = {
    db: path.relative(process.cwd(), dbPath),
    report: path.relative(process.cwd(), reportPath),
    model,
    endpoints,
    source_langs: sourceLangFilter ? [...sourceLangFilter] : 'all',
    only_source_entry_ids: onlySourceEntryIds ? [...onlySourceEntryIds] : null,
    checkpoint: checkpointPath ? path.relative(process.cwd(), checkpointPath) : null,
    resume,
    select_only: true,
    limit,
    selected: selected.length,
    skipped_before_generation: rejectedBeforeGeneration.length,
    skipped_before_generation_by_reason: countBy(rejectedBeforeGeneration.map((row) => row.reason))
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        ok: true,
        generated_at: new Date().toISOString(),
        stats,
        selected_preview: selected.slice(0, 80).map((row) => ({
          source_entry_id: row.source_entry_id,
          source_sense_id: row.first_sense_id ?? row.source_sense_id ?? null,
          word: row.word,
          source_lang: row.source_lang,
          frequency_rank: row.frequency_rank,
          gloss: row.gloss_preview || row.gloss_key,
          quality_bucket: row.quality_bucket || null
        })),
        skipped_preview: rejectedBeforeGeneration.slice(0, 80)
      },
      null,
      2
    ),
    'utf8'
  );
  if (eligibleReportPath) {
    fs.mkdirSync(path.dirname(eligibleReportPath), { recursive: true });
    fs.writeFileSync(
      eligibleReportPath,
      `${JSON.stringify(
        {
          ok: true,
          generated_at: new Date().toISOString(),
          source_report: path.relative(process.cwd(), reportPath),
          product_db: path.relative(process.cwd(), dbPath),
          policy: {
            product_eligibility_prefiltered: true,
            automatic_publication: false
          },
          summary: {
            input: allRows.length,
            selected: selected.length,
            skipped: rejectedBeforeGeneration.length,
            skipped_by_reason: countBy(rejectedBeforeGeneration.map((row) => row.reason))
          },
          selected_count: selected.length,
          selected
        },
        null,
        2
      )}\n`,
      'utf8'
    );
  }
  console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), stats }, null, 2));
  process.exit(0);
}

if (deterministicReadings && selected.length && fs.existsSync(jmdictPath)) {
  await preloadJmdictReadingMap();
}
if (
  deterministicPronunciations &&
  selected.length &&
  (fs.existsSync(sourceDbPath) || fs.existsSync(ptPronunciationDbPath))
) {
  preloadDeterministicPronunciationSources();
}

if (replayReportPath) {
  try {
    replayGeneratedReport();
  } finally {
    closeDeterministicSources();
  }
  process.exit(0);
}

const prewarmResults = prewarm && selected.length ? await prewarmEndpoints() : [];
const endpointRuntimeStates = new Map(
  endpoints.map((endpoint) => [
    endpoint,
    {
      consecutiveFailures: 0,
      open: false,
      openUntil: 0,
      calls: 0,
      failures: 0,
      recoveries: 0
    }
  ])
);
const stats = {
  db: path.relative(process.cwd(), dbPath),
  report: path.relative(process.cwd(), reportPath),
  model,
  endpoints,
  source_langs: sourceLangFilter ? [...sourceLangFilter] : 'all',
  only_source_entry_ids: onlySourceEntryIds ? [...onlySourceEntryIds] : null,
  dry_run: dryRun,
  apply,
  include_risky: includeRisky,
  prewarm,
  force_reload: forceReload,
  quiet,
  concurrency,
  endpoint_concurrency: endpointConcurrency,
  batch_size: batchSize,
  max_tokens: maxTokens,
  post_load_wait_ms: postLoadWaitMs,
  gguf_variant: ggufVariant,
  endpoint_gguf_variants: endpointGgufVariants,
  max_seq_length: maxSeqLength,
  speculative_type: speculativeType,
  load_in_4bit: loadIn4bit,
  residual_mode: residualMode,
  prompt_mode: promptMode,
  minimal_request: minimalRequest,
  stream_response: streamResponse,
  chat_path: chatPath,
  disable_thinking: disableThinking,
  publishable,
  skip_existing_drafts: skipExistingDrafts,
  require_evidence_verdict: requireEvidenceVerdict,
  enforce_reviewed_preferred_terms: enforceReviewedPreferredTerms,
  enforce_generation_hint_terms: enforceGenerationHintTerms,
  require_examples: requireExamples,
  quality_review: qualityReview,
  quality_review_confidence: qualityReviewConfidence,
  quality_review_max_tokens: qualityReviewMaxTokens,
  defer_evidence_bound_quality_rejects: deferEvidenceBoundQualityRejects,
  pronunciation_review: pronunciationReview,
  pronunciation_review_max_tokens: pronunciationReviewMaxTokens,
  pronunciation_repair: pronunciationRepair,
  pronunciation_repair_max_tokens: pronunciationRepairMaxTokens,
  deterministic_readings: deterministicReadings,
  jmdict: deterministicReadings && fs.existsSync(jmdictPath) ? path.relative(process.cwd(), jmdictPath) : null,
  deterministic_pronunciations: deterministicPronunciations,
  source_db:
    deterministicPronunciations && fs.existsSync(sourceDbPath) ? path.relative(process.cwd(), sourceDbPath) : null,
  pt_pronunciation_db:
    deterministicPronunciations && fs.existsSync(ptPronunciationDbPath)
      ? path.relative(process.cwd(), ptPronunciationDbPath)
      : null,
  chunk_size: chunkSize,
  checkpoint: checkpointPath ? path.relative(process.cwd(), checkpointPath) : null,
  resume,
  allow_endpoint_change_on_resume: allowEndpointChangeOnResume,
  max_attempts: maxAttempts,
  circuit_breaker_failures: circuitBreakerFailures,
  circuit_breaker_reset_ms: circuitBreakerResetMs,
  endpoint_cooldown_ms: endpointCooldownMs,
  applied_entry_status: appliedEntryStatus,
  applied_sense_status: appliedSenseStatus,
  applied_localization_needs_review: appliedLocalizationNeedsReview,
  log_generated: logGenerated,
  selected: selected.length,
  checkpoint_completed: checkpointCompleted.size,
  planned_total: selected.length + checkpointCompleted.size,
  skipped_before_generation: rejectedBeforeGeneration.length,
  skipped_before_generation_by_reason: countBy(rejectedBeforeGeneration.map((row) => row.reason)),
  generated: 0,
  accepted: 0,
  no_promote_selected: selected.filter((row) => row?.promote_allowed === false).length,
  no_promote_accepted: 0,
  no_promote_writes_skipped: 0,
  rejected: 0,
  evidence_rejected: 0,
  infrastructure_rejected: 0,
  validation_rejected: 0,
  entries_inserted: 0,
  entries_reused: 0,
  senses_inserted: 0,
  senses_reused: 0,
  localizations_upserted: 0,
  source_links_upserted: 0,
  examples_upserted: 0,
  example_localizations_upserted: 0,
  chunks_committed: 0,
  endpoint_metrics: {}
};

const generated = Object.values(checkpoint?.items || {})
  .map((item) => item?.generated_item)
  .filter(Boolean);
stats.generated = generated.length;
stats.accepted = generated.filter((item) => item.valid).length;
stats.rejected = generated.length - stats.accepted;
stats.infrastructure_rejected = generated.filter((item) => item.infrastructure_failure).length;
stats.validation_rejected = generated.filter(
  (item) => !item.valid && !item.infrastructure_failure && !item.errors?.includes('source_evidence_mismatch')
).length;
const generationChunks = chunkRows(selected, chunkSize, false);
if (generationChunks.length === 0) {
  // An empty, fully filtered batch is a successful checkpointed run, not a
  // missing-artifact failure for the parent pipeline.
  updateCheckpoint(checkpoint, [], [], stats, 0, 0);
}
for (let chunkIndex = 0; chunkIndex < generationChunks.length; chunkIndex++) {
  const chunk = generationChunks[chunkIndex];
  const pool = await runGenerationPool(chunk);
  const chunkGenerated = pool.results;
  const chunkAcceptedItems = chunkGenerated.filter((item) => item.valid);
  const chunkAccepted = chunkAcceptedItems
    .filter((item) => !noPromoteSourceEntryIds.has(String(item.source_entry_id)))
    .map((item) => item.output);
  const chunkNoPromoteAccepted = chunkAcceptedItems.filter((item) =>
    noPromoteSourceEntryIds.has(String(item.source_entry_id))
  );
  const writes = apply && chunkAccepted.length && !dryRun ? applyOutputs(chunkAccepted, stats) : [];

  generated.push(...chunkGenerated);
  stats.generated += chunkGenerated.length;
  stats.accepted += chunkAcceptedItems.length;
  stats.no_promote_accepted += chunkNoPromoteAccepted.length;
  stats.no_promote_writes_skipped += chunkNoPromoteAccepted.length;
  stats.rejected += chunkGenerated.length - chunkAcceptedItems.length;
  stats.evidence_rejected += chunkGenerated.filter((item) => item.errors.includes('source_evidence_mismatch')).length;
  stats.infrastructure_rejected += chunkGenerated.filter((item) => item.infrastructure_failure).length;
  stats.validation_rejected += chunkGenerated.filter(
    (item) => !item.valid && !item.infrastructure_failure && !item.errors.includes('source_evidence_mismatch')
  ).length;
  stats.chunks_committed++;
  stats.endpoint_metrics = serializeEndpointMetrics(pool.endpointStats);
  updateCheckpoint(checkpoint, chunkGenerated, writes, stats, chunkIndex + 1, generationChunks.length);
  writeRunOutput({ partial: chunkIndex + 1 < generationChunks.length });
}

writeRunOutput({ partial: false });
console.log(JSON.stringify({ ok: stats.rejected === 0, out: path.relative(process.cwd(), outPath), stats }, null, 2));
closeDeterministicSources();

// Node's fetch implementation can retain idle Undici sockets on Windows after
// every result and checkpoint have been durably written. This script is a
// finite batch job, so do not let those handles stall the parent pipeline.
process.exit(0);

function writeRunOutput({ partial }) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        ok: !partial && stats.rejected === 0,
        partial,
        generated_at: new Date().toISOString(),
        stats,
        prewarm_results: prewarmResults,
        skipped_preview: rejectedBeforeGeneration.slice(0, 80),
        generated: logGenerated ? generated : undefined,
        generated_preview: logGenerated ? undefined : generated.slice(0, 80).map(compactGeneratedItem),
        rejected: logGenerated ? undefined : generated.filter((item) => !item.valid).map(compactGeneratedItem)
      },
      null,
      2
    ),
    'utf8'
  );
}

function replayGeneratedReport() {
  const replay = JSON.parse(fs.readFileSync(replayReportPath, 'utf8'));
  if (!Array.isArray(replay.generated)) throw new Error('Replay report must contain a generated array.');
  const rowsByCandidateKey = new Map(selected.map((row) => [replayCandidateKey(row), row]));
  const controlledDraftIds = controlledConsensusDraftWrite
    ? validateControlledConsensusReplay(replay, rowsByCandidateKey)
    : new Set();
  const replayed = [];
  for (const item of replay.generated) {
    if ((!item?.valid && !replayInvalidOutputs) || !item?.output) continue;
    const row = rowsByCandidateKey.get(replayCandidateKey(item));
    if (!row) continue;
    const output = normalizeGeneratedOutput(row, item.output);
    const errors = validateOutput(row, output).errors;
    if (item.quality_review && item.quality_review.approved !== true) errors.push('replay_quality_review_not_approved');
    replayed.push({
      ...item,
      output,
      errors,
      valid: errors.length === 0,
      replayed: true
    });
  }

  const validItems = replayed.filter((item) => item.valid);
  const accepted = validItems
    .filter(
      (item) =>
        !noPromoteSourceEntryIds.has(String(item.source_entry_id)) ||
        controlledDraftIds.has(String(item.source_entry_id))
    )
    .map((item) => item.output);
  const noPromoteWritesSkipped = validItems.filter(
    (item) =>
      noPromoteSourceEntryIds.has(String(item.source_entry_id)) &&
      !controlledDraftIds.has(String(item.source_entry_id))
  ).length;
  const replayStats = {
    db: path.relative(process.cwd(), dbPath),
    report: path.relative(process.cwd(), reportPath),
    replay_report: path.relative(process.cwd(), replayReportPath),
    dry_run: dryRun,
    apply,
    publishable,
    source_items: replay.generated.length,
    source_accepted: replay.generated.filter((item) => item?.valid).length,
    replay_invalid_outputs: replayInvalidOutputs,
    matched: replayed.length,
    accepted: accepted.length,
    rejected: replayed.length - accepted.length,
    controlled_consensus_draft_write: controlledConsensusDraftWrite,
    controlled_consensus_draft_write_count: controlledDraftIds.size,
    no_promote_writes_skipped: noPromoteWritesSkipped,
    entries_inserted: 0,
    entries_reused: 0,
    senses_inserted: 0,
    senses_reused: 0,
    localizations_upserted: 0,
    source_links_upserted: 0,
    examples_upserted: 0,
    example_localizations_upserted: 0
  };
  const writes = apply && accepted.length && !dryRun ? applyOutputs(accepted, replayStats) : [];
  updateCheckpoint(
    checkpoint,
    replayed,
    writes,
    {
      ...replayStats,
      planned_total: replayed.length,
      endpoint_metrics: {}
    },
    replayed.length ? 1 : 0,
    replayed.length ? 1 : 0
  );
  const result = {
    ok: replayStats.rejected === 0,
    generated_at: new Date().toISOString(),
    stats: replayStats,
    replayed: logGenerated ? replayed : undefined,
    rejected: replayed.filter((item) => !item.valid).map(compactGeneratedItem),
    writes
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(
    JSON.stringify({ ok: result.ok, out: path.relative(process.cwd(), outPath), stats: replayStats }, null, 2)
  );
}

function validateControlledConsensusReplay(replay, rowsByCandidateKey) {
  if (replay?.derived_from?.consensus === undefined) {
    throw new Error('Controlled consensus replay must identify its consensus report');
  }
  const consensusPath = path.resolve(replay.derived_from.consensus);
  if (!fs.existsSync(consensusPath)) {
    throw new Error(`Controlled consensus report not found: ${consensusPath}`);
  }
  const consensus = JSON.parse(fs.readFileSync(consensusPath, 'utf8'));
  if (consensus?.policy?.independent_model_families !== true) {
    throw new Error('Controlled consensus report does not certify independent model families');
  }
  if (consensus?.policy?.automatic_promotion !== false) {
    throw new Error('Controlled consensus report permits automatic promotion');
  }
  const reportLevelControlledProvenance =
    replay?.selection_policy?.lane === 'controlled_model_consensus' &&
    replay?.selection_policy?.automatic_promotion === false &&
    replay?.selection_policy?.final_generation_evidence_consensus_gate === true &&
    replay?.selection_policy?.require_independent_no_correction_consensus === true;

  const acceptedKeys = new Set(
    (consensus.reviews || [])
      .filter(
        (row) =>
          row?.valid === true &&
          row?.consensus_accepted === true &&
          row?.decision === 'accept' &&
          Array.isArray(row?.corrections) &&
          row.corrections.length === 0
      )
      .map((row) => `${Number(row.source_entry_id)}:${Number(row.source_sense_id)}`)
  );
  const allowedIds = new Set();
  for (const item of replay.generated) {
    const sourceEntryId = String(item?.source_entry_id);
    const sourceSenseId = Number(item?.source_sense_id ?? item?.output?.source_sense_id);
    const row = rowsByCandidateKey.get(replayCandidateKey(item));
    const rowLevelControlledProvenance =
      row?.candidate_review_provenance?.kind === 'controlled_model_consensus';
    if (!rowLevelControlledProvenance && !reportLevelControlledProvenance) {
      throw new Error(`Controlled replay row ${sourceEntryId} lacks controlled_model_consensus provenance`);
    }
    if (
      rowLevelControlledProvenance &&
      row?.candidate_review_provenance?.automatic_promotion !== false
    ) {
      throw new Error(`Controlled replay row ${sourceEntryId} has unsafe promotion policy`);
    }
    if (!acceptedKeys.has(`${Number(sourceEntryId)}:${sourceSenseId}`)) {
      throw new Error(`Controlled replay row ${sourceEntryId}:${sourceSenseId} lacks no-correction consensus`);
    }
    allowedIds.add(sourceEntryId);
  }
  return allowedIds;
}

function replayCandidateKey(value) {
  const sourceEntryId = Number(value?.source_entry_id);
  const sourceSenseId = Number(
    value?.source_sense_id ?? value?.output?.source_sense_id ?? value?.first_sense_id
  );
  if (!Number.isInteger(sourceEntryId) || !Number.isInteger(sourceSenseId)) {
    throw new Error(`Replay candidate lacks exact source identity: ${JSON.stringify(value)}`);
  }
  return `${sourceEntryId}:${sourceSenseId}`;
}

function loadReplaySourceEntryIds(file) {
  const replay = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(replay.generated)) throw new Error('Replay report must contain a generated array.');
  return new Set(
    replay.generated
      .filter((item) => (item?.valid || replayInvalidOutputs) && item?.output)
      .map((item) => Number(item.source_entry_id))
      .filter(Number.isInteger)
  );
}

async function generateBatch(rows, endpoint) {
  if (promptMode === 'nano-per-language') {
    if (rows.length !== 1) throw new Error('nano-per-language requires batch size 1');
    return [await generatePerLanguage(rows[0], endpoint)];
  }
  const prompt = rows.length === 1 ? buildPrompt(rows[0]) : buildBatchPrompt(rows);
  const requestBody = {
    model,
    stream: streamResponse,
    temperature: 0,
    max_tokens: maxTokens || Math.min(2600, 260 + rows.length * 520),
    messages: minimalRequest
      ? [
          {
            role: 'user',
            content: `Create concise multilingual dictionary records. Return only strict JSON.\n\n${prompt}`
          }
        ]
      : [
          {
            role: 'system',
            content: 'You create concise multilingual dictionary records. Return only strict JSON.'
          },
          { role: 'user', content: prompt }
        ]
  };
  if (disableThinking) requestBody.enable_thinking = false;
  if (!minimalRequest) {
    requestBody.reasoning_effort = 'none';
  }
  const response = await fetch(`${endpoint}${chatPath}`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  const content = streamResponse ? await readChatCompletionStream(response, timeoutMs) : await readChatCompletion(response);
  const output = parseJson(content);
  if (rows.length === 1) return [normalizeModelOutput(output, rows[0])];
  const items = Array.isArray(output) ? output : output?.items;
  if (!Array.isArray(items)) throw new Error('batch content missing items array');
  return rows.map((row, index) => {
    const byId = items.find((item) => String(item?.source_entry_id || '') === String(row.source_entry_id));
    return byId || items[index] || null;
  });
}

async function generatePerLanguage(row, endpoint) {
  const localizations = {};
  for (const lang of LANGS) {
    const term = lockedTargetTerm(row, lang);
    if (!term) throw new Error(`missing_locked_term_${lang}`);
    const prompt = buildPerLanguageGenerationPrompt(row, lang, term);
    const requestBody = {
      model,
      stream: streamResponse,
      temperature: 0,
      max_tokens: Math.min(maxTokens || 360, 360),
      enable_thinking: false,
      messages: [{ role: 'user', content: prompt }]
    };
    const response = await fetch(`${endpoint}${chatPath}`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    const content = streamResponse ? await readChatCompletionStream(response, timeoutMs) : await readChatCompletion(response);
    const parsed = parseJson(content);
    let pronunciation = String(parsed?.p || '').trim();
    const definition = String(parsed?.d || '').trim();
    if (!pronunciation || !definition) throw new Error(`invalid_localization_${lang}`);
    if (lang === 'ja' && /^[\p{Script=Katakana}ー・]+$/u.test(term)) pronunciation = term;
    localizations[lang] =
      lang === 'zh' || lang === 'ja'
        ? {
            term,
            reading: pronunciation,
            reading_system: lang === 'zh' ? 'pinyin' : 'kana',
            definition
          }
        : { term, pronunciation, pronunciation_system: 'IPA', definition };
  }
  return {
    headword: row.word,
    normalized_key: row.normalized_key || row.word,
    primary_lang: row.source_lang,
    frequency_rank: row.frequency_rank ?? null,
    part_of_speech: row.useful_senses?.[0]?.part_of_speech || row.part_of_speech || null,
    gloss_key: sourceMeaningAnchor(row),
    source_evidence_valid: true,
    source_evidence_reason: null,
    localizations
  };
}

function lockedTargetTerm(row, lang) {
  if (lang === row.source_lang) return String(row.word || '').trim();
  const preferred = row?.candidate_evidence_review?.preferred_terms?.[lang];
  if (nonEmpty(preferred)) return String(preferred).trim();
  const hinted = row?.generation_hints?.[lang]?.terms?.[0];
  return nonEmpty(hinted) ? String(hinted).trim() : '';
}

function buildPerLanguageGenerationPrompt(row, lang, term) {
  const readingLabel = lang === 'zh' ? 'pinyin' : lang === 'ja' ? 'kana' : 'IPA';
  const definitionContract = reviewedDefinitionContract(row, lang, term);
  const languageRule =
    lang === 'zh'
      ? 'Use Simplified Chinese. D must contain at least 8 Chinese characters, explain what T means, and must not equal T.'
      : lang === 'ja'
        ? 'D must contain at least 12 Japanese characters, explain what T means, and must not equal T. If T is all katakana, P must equal T exactly; otherwise P must be kana only, never romaji.'
        : lang === 'pt-BR'
          ? 'D must be natural Brazilian Portuguese, contain at least 6 words, and must not equal T.'
          : 'D must be natural English, contain at least 6 words, and must not equal T.';
  return [
    'JSON only. Create one dictionary localization.',
    `W=${JSON.stringify(row.word)};M=${JSON.stringify(sourceMeaningAnchor(row))};C=${JSON.stringify(definitionContract)};X=${lang};T=${JSON.stringify(term)}.`,
    `Use exact T. Return {"p":"${readingLabel}","d":"definition"}. P is the real ${readingLabel} of T. ${languageRule}`,
    'D must define only M, follow trustworthy contract C when C is informative, be complete, factual, and concise; never copy placeholders.'
  ].join(' ');
}

async function readChatCompletion(response) {
  const envelope = JSON.parse(await response.text());
  return envelope?.choices?.[0]?.message?.content || '';
}

async function readChatCompletionStream(response, bodyTimeoutMs) {
  if (!response.body) throw new Error('stream response missing body');
  const reader = response.body.getReader();
  let timer;
  const consume = (async () => {
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        const chunk = JSON.parse(data);
        content += chunk?.choices?.[0]?.delta?.content || '';
      }
      if (done) break;
    }
    return content;
  })();
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reader.cancel('stream_body_timeout').catch(() => {});
      reject(new Error(`stream_body_timeout_${bodyTimeoutMs}ms`));
    }, bodyTimeoutMs);
  });
  try {
    return await Promise.race([consume, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function runGenerationPool(rows) {
  const results = new Array(rows.length);
  const batches = chunkRows(rows, batchSize).map((batch) => ({
    rows: batch,
    excludedEndpoints: new Set(),
    recoveryCycles: 0,
    formatRecoveryCycles: 0
  }));
  const workerSlots = buildWorkerSlots(rows.length, batches.length);
  const endpointStates = endpointRuntimeStates;
  let inFlight = 0;
  const takeBatch = (endpoint) => {
    const index = batches.findIndex((item) => !item.excludedEndpoints.has(endpoint));
    if (index < 0) return null;
    return batches.splice(index, 1)[0];
  };
  const workers = workerSlots.map(async (endpoint, workerIndex) => {
    const state = endpointStates.get(endpoint);
    while (true) {
      if (state.open) {
        const hasEligibleTask = batches.some((item) => !item.excludedEndpoints.has(endpoint));
        if (!hasEligibleTask) {
          if (batches.length === 0 && inFlight === 0) break;
          await delay(25);
          continue;
        }
        const hasHealthyAlternative = [...endpointStates.entries()].some(
          ([candidate, candidateState]) =>
            candidate !== endpoint &&
            !candidateState.open &&
            batches.some((item) => !item.excludedEndpoints.has(candidate))
        );
        if (hasHealthyAlternative) {
          await delay(25);
          continue;
        }
        await recoverEndpointCircuit(state);
      }
      const task = takeBatch(endpoint);
      if (!task) {
        if (batches.length === 0 && inFlight === 0) break;
        await delay(25);
        continue;
      }
      inFlight++;
      state.calls++;
      const batchResults = await generateOneBatch(task.rows, endpoint, workerIndex);
      if (endpointCooldownMs) await delay(endpointCooldownMs);
      inFlight--;
      const infrastructureFailure = batchResults.every((item) => item.infrastructure_failure);
      const outputFormatFailure = batchResults.every(
        (item) => !item.infrastructure_failure && item.output == null && item.errors.some(isOutputFormatErrorMessage)
      );
      if (outputFormatFailure && task.formatRecoveryCycles < 1) {
        state.consecutiveFailures = 0;
        task.formatRecoveryCycles++;
        task.lastFailureResults = batchResults;
        task.excludedEndpoints.add(endpoint);
        const canReroute = [...endpointStates.keys()].some((candidate) => !task.excludedEndpoints.has(candidate));
        if (canReroute) {
          batches.push(task);
          continue;
        }
      }
      if (infrastructureFailure) {
        state.failures++;
        state.consecutiveFailures++;
        task.lastFailureResults = batchResults;
        task.excludedEndpoints.add(endpoint);
        if (state.consecutiveFailures >= circuitBreakerFailures) openEndpointCircuit(state);
        const canReroute = [...endpointStates.entries()].some(([candidate]) => !task.excludedEndpoints.has(candidate));
        if (canReroute) {
          batches.push(task);
          continue;
        }
        if (task.recoveryCycles < 1) {
          task.recoveryCycles++;
          task.excludedEndpoints.clear();
          batches.push(task);
          continue;
        }
      } else {
        state.consecutiveFailures = 0;
      }
      for (let itemIndex = 0; itemIndex < task.rows.length; itemIndex++) {
        results[task.rows[itemIndex].__selected_index] = batchResults[itemIndex];
      }
    }
  });
  await Promise.all(workers);
  for (const task of batches) {
    const fallback =
      task.lastFailureResults ||
      task.rows.map((row) =>
        generatedItem(row, null, ['all_endpoints_unavailable'], null, -1, task.rows.length, 0, maxAttempts, true)
      );
    for (let itemIndex = 0; itemIndex < task.rows.length; itemIndex++) {
      results[task.rows[itemIndex].__selected_index] = fallback[itemIndex];
    }
  }
  return {
    results: results.filter(Boolean),
    endpointStats: endpointStates
  };
}

function openEndpointCircuit(state) {
  state.open = true;
  state.openUntil = Date.now() + circuitBreakerResetMs;
}

async function recoverEndpointCircuit(state) {
  const waitMs = Math.max(0, Number(state.openUntil || 0) - Date.now());
  if (waitMs) await delay(waitMs);
  state.open = false;
  state.openUntil = 0;
  state.consecutiveFailures = 0;
  state.recoveries++;
}

async function generateOneBatch(rows, endpoint, workerIndex) {
  const started = performance.now();
  let lastError = null;
  let attemptRows = rows;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const outputs = await generateBatch(attemptRows, endpoint);
      const seconds = secondsSince(started);
      const items = rows.map((row, index) => {
        const output = normalizeGeneratedOutput(row, outputs[index]);
        applyReviewedDefinitionContracts(row, output);
        applyStructuredFieldCorrections(row, output);
        const validation = validateOutput(row, output);
        return generatedItem(
          row,
          output,
          validation.errors,
          endpoint,
          workerIndex,
          rows.length,
          seconds,
          attempt,
          false
        );
      });
      if (qualityReview) {
        await Promise.all(
          items.map(async (item, index) => {
            if (!item.valid) return;
            try {
              item.quality_review = await reviewGeneratedOutput(rows[index], item.output, endpoint);
              item.quality_review = applyEvidenceBoundQualityReviewDeferral(
                rows[index],
                item.output,
                item.quality_review
              );
              if (!item.quality_review.approved) {
                item.errors.push('quality_review_rejected');
                item.valid = false;
              }
            } catch (error) {
              item.quality_review = { approved: false, error: errorMessage(error) };
              item.errors.push('quality_review_failed');
              item.valid = false;
            }
          })
        );
      }
      if (pronunciationReview) {
        await Promise.all(
          items.map(async (item) => {
            if (!item.valid) return;
            try {
              item.pronunciation_review = await reviewGeneratedPronunciations(item.output, endpoint);
              if (!item.pronunciation_review.approved && pronunciationRepair && endpoints.some((value) => value !== endpoint)) {
                const repairEndpoint = alternateEndpoint(endpoint);
                item.pronunciation_review_initial = item.pronunciation_review;
                try {
                  item.pronunciation_repair = await repairGeneratedPronunciations(
                    item.output,
                    item.pronunciation_review,
                    repairEndpoint
                  );
                  item.pronunciation_review = await reviewGeneratedPronunciations(item.output, endpoint);
                } catch (error) {
                  item.pronunciation_repair = { endpoint: repairEndpoint, error: errorMessage(error) };
                }
              }
              if (!item.pronunciation_review.approved) {
                item.errors.push('pronunciation_review_rejected');
                item.valid = false;
              }
            } catch (error) {
              item.pronunciation_review = { approved: false, error: errorMessage(error) };
              item.errors.push('pronunciation_review_failed');
              item.valid = false;
            }
          })
        );
      }
      if (!quiet) {
        const accepted = items.filter((item) => item.valid).length;
        console.log(
          `[${attempt > 1 ? 'retry-' : ''}batch] accepted=${accepted}/${items.length} attempts=${attempt} seconds=${seconds} endpoint=${endpoint} worker=${workerIndex}`
        );
      }
      const retryableValidationFailure =
        ['micro', 'compact'].includes(promptMode) &&
        items.length === 1 &&
        !items[0].valid &&
        (!items[0].errors.includes('source_evidence_mismatch') ||
          evidenceRejectionContradictsReason(items[0].output?.source_evidence_reason, rows[0]));
      if (retryableValidationFailure && attempt < maxAttempts) {
        attemptRows = rows.map((row, index) => ({
          ...row,
          latest_errors: items[index].errors,
          latest_evidence_reason: items[index].output?.source_evidence_reason || null,
          latest_quality_review_reason: items[index].quality_review?.reason || null,
          latest_quality_review_errors: items[index].quality_review?.errors || [],
          latest_pronunciation_review_reason: items[index].pronunciation_review?.reason || null,
          latest_pronunciation_review_errors: items[index].pronunciation_review?.errors || [],
          latest_ja_term: items[index].output?.localizations?.ja?.term || null,
          latest_ja_expected_readings: expectedJapaneseReadings(items[index].output?.localizations?.ja?.term),
          latest_zh_term: items[index].output?.localizations?.zh?.term || null,
          latest_zh_expected_readings: expectedChineseReadings(items[index].output?.localizations?.zh?.term)
        }));
        continue;
      }
      return items;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || (!isRecoverableModelLoadError(error) && !isRecoverableGenerationError(error)))
        break;
      if (isRecoverableModelLoadError(error)) {
        try {
          await loadEndpoint(endpoint);
        } catch (loadError) {
          lastError = loadError;
        }
      }
    }
  }
  const seconds = secondsSince(started);
  const infrastructureFailure = isInfrastructureGenerationError(lastError);
  const items = rows.map((row) =>
    generatedItem(
      row,
      null,
      [errorMessage(lastError)],
      endpoint,
      workerIndex,
      rows.length,
      seconds,
      maxAttempts,
      infrastructureFailure
    )
  );
  if (!quiet) {
    console.log(
      `[failed-batch] size=${rows.length} seconds=${seconds} endpoint=${endpoint} ${errorMessage(lastError)}`
    );
  }
  return items;
}

function generatedItem(
  row,
  output,
  errors,
  endpoint,
  workerIndex,
  itemCount,
  seconds,
  attempts,
  infrastructureFailure
) {
  return {
    source_entry_id: row.source_entry_id,
    word: row.word,
    source_lang: row.source_lang,
    frequency_rank: row.frequency_rank,
    endpoint,
    worker: workerIndex,
    batch_size: itemCount,
    seconds: Number((seconds / itemCount).toFixed(2)),
    batch_seconds: seconds,
    attempts,
    infrastructure_failure: infrastructureFailure,
    quality_review: null,
    pronunciation_review: null,
    pronunciation_review_initial: null,
    pronunciation_repair: null,
    valid: !infrastructureFailure && errors.length === 0,
    errors,
    output
  };
}

async function reviewGeneratedOutput(row, output, endpoint) {
  const systemPrompt =
    'You are a strict four-language dictionary lexical QA reviewer. Check meaning, terms, definitions, and only readings not already locked by deterministic dictionary evidence. Return JSON only.';
  const userPrompt = buildQualityReviewPrompt(row, output);
  try {
    const { parsed, content } = await requestStructuredReview(
      endpoint,
      systemPrompt,
      userPrompt,
      qualityReviewMaxTokens
    );
    const firstReview = applyDeterministicReadingReviewOverride(output, normalizeReviewDecision(parsed, content));
    if (!qualityReviewContradictsDecision(firstReview) || endpoints.length < 2) return firstReview;
    const fallbackEndpoint = alternateEndpoint(endpoint);
    const retry = await requestStructuredReview(
      fallbackEndpoint,
      systemPrompt,
      `${userPrompt}\nThe previous reviewer returned a contradictory reject rationale: ${firstReview.reason}. Independently re-evaluate and return one consistent decision.`,
      qualityReviewMaxTokens
    );
    return {
      ...applyDeterministicReadingReviewOverride(output, normalizeReviewDecision(retry.parsed, retry.content)),
      endpoint: fallbackEndpoint,
      contradiction_retry: true,
      contradictory_review: firstReview
    };
  } catch (error) {
    if (!isOutputFormatErrorMessage(errorMessage(error)) || endpoints.length < 2) throw error;
    const fallbackEndpoint = alternateEndpoint(endpoint);
    const { parsed, content } = await requestStructuredReview(
      fallbackEndpoint,
      systemPrompt,
      `${userPrompt}\nA previous reviewer returned malformed JSON. Return exactly one valid JSON object.`,
      qualityReviewMaxTokens
    );
    return {
      ...applyDeterministicReadingReviewOverride(output, normalizeReviewDecision(parsed, content)),
      endpoint: fallbackEndpoint,
      format_retry: true
    };
  }
}

function qualityReviewContradictsDecision(review) {
  if (review?.decision !== 'reject') return false;
  const reason = String(review?.reason || '').toLocaleLowerCase();
  return /\b(?:is|are) correct\b|\bshould (?:be )?accept(?:ed)?\b|\bso accept\b|\bcorrect\.\s*so\b/u.test(reason);
}

async function reviewGeneratedPronunciations(output, endpoint) {
  const en = output?.localizations?.en || {};
  const pt = output?.localizations?.['pt-BR'] || {};
  const reviewInput = {};
  if (isReviewableIpa(en)) reviewInput.en = [en.term || '', en.pronunciation || ''];
  if (isReviewableIpa(pt)) reviewInput['pt-BR'] = [pt.term || '', pt.pronunciation || ''];
  if (!Object.keys(reviewInput).length) {
    return {
      approved: true,
      decision: 'accept',
      confidence: 1,
      reason: 'All available pronunciations came from deterministic dictionary evidence.',
      errors: [],
      raw_preview: ''
    };
  }
  const prompt = `Check only whether each IPA string actually pronounces its given term.
  Lexical validity was already approved. Never reject because a term is a loanword, regional, informal, rare, or nonstandard.
  Accept normal dialect variants and optional broad/narrow IPA detail. Reject an IPA copied from a different term or clearly impossible sound-to-spelling correspondence.
  Keep reason under 20 words and use at most one short error code per language.
  Return JSON only: {"decision":"accept|reject|manual_review","confidence":0.0,"reason":"short reason","errors":["lang:problem"]}
  Input=${JSON.stringify(reviewInput)}`;
  const first = await requestStructuredReview(
    endpoint,
    'You are an English and Brazilian Portuguese dictionary pronunciation reviewer. Return JSON only.',
    prompt,
    pronunciationReviewMaxTokens
  );
  const firstReview = normalizeReviewDecision(first.parsed, first.content);
  if (!pronunciationReviewIsOutOfScope(firstReview)) return firstReview;
  const second = await requestStructuredReview(
    endpoint,
    'You review pronunciation only. Lexical status and loanword status are out of scope. Return JSON only.',
    `${prompt}\nThe previous review was out of scope: ${firstReview.reason}. Re-evaluate only IPA-to-term correspondence.`,
    pronunciationReviewMaxTokens
  );
  return {
    ...normalizeReviewDecision(second.parsed, second.content),
    scope_retry: true,
    out_of_scope_review: firstReview
  };
}

function pronunciationReviewIsOutOfScope(review) {
  const text = `${review?.reason || ''} ${(review?.errors || []).join(' ')}`.toLocaleLowerCase();
  return /non[_ -]?standard|foreign[_ -]?word|loanword|not\s+(?:a\s+)?standard|not\s+native|:[_ -]?correct\b/u.test(text);
}

async function repairGeneratedPronunciations(output, rejectedReview, endpoint) {
  const en = output?.localizations?.en || {};
  const pt = output?.localizations?.['pt-BR'] || {};
  const targets = {};
  if (isReviewableIpa(en)) targets.en = [en.term || '', en.pronunciation || ''];
  if (isReviewableIpa(pt)) targets['pt-BR'] = [pt.term || '', pt.pronunciation || ''];
  if (!Object.keys(targets).length) throw new Error('pronunciation_repair_no_ipa_targets');
  const repairInput = {
    targets,
    rejection_reason: rejectedReview?.reason || '',
    rejection_errors: rejectedReview?.errors || []
  };
  const prompt = `Correct only the English and Brazilian Portuguese IPA strings for the exact terms below.
Use a common dictionary pronunciation. Preserve a current IPA when it is already valid, including ordinary dialect variants.
Return one string value for every language in targets plus a top-level reason, for example {"pt-BR":"/ipa/","reason":"short reason"}.
Do not return nested objects and do not add languages that are absent from targets.
Input=${JSON.stringify(repairInput)}`;
  const { parsed, content } = await requestStructuredReview(
    endpoint,
    'You repair English and Brazilian Portuguese dictionary IPA. Never change the terms. Return JSON only.',
    prompt,
    pronunciationRepairMaxTokens
  );
  const repaired = {};
  for (const lang of Object.keys(targets)) {
    const value = pronunciationRepairValue(parsed?.[lang]);
    if (!value || value.length > 80 || !/[A-Za-z\p{Letter}]/u.test(value)) {
      throw new Error(`pronunciation_repair_invalid_${lang}`);
    }
    repaired[lang] = value;
  }
  output.localizations = { ...output.localizations };
  if (repaired.en) {
    output.localizations.en = { ...en, pronunciation: repaired.en, pronunciation_system: 'IPA' };
  }
  if (repaired['pt-BR']) {
    output.localizations['pt-BR'] = {
      ...pt,
      pronunciation: repaired['pt-BR'],
      pronunciation_system: 'IPA'
    };
  }
  return {
    endpoint,
    pronunciations: repaired,
    reason: String(parsed?.reason || '').trim(),
    raw_preview: content.slice(0, 800)
  };
}

function pronunciationRepairValue(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  for (const key of ['ipa', 'pronunciation']) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
  }
  return '';
}

function isReviewableIpa(localization) {
  return (
    localization?.pronunciation_system === 'IPA' &&
    !String(localization?.pronunciation_source || '').startsWith('deterministic:')
  );
}

function alternateEndpoint(endpoint) {
  return endpoints.find((candidate) => candidate !== endpoint) || endpoint;
}

async function requestStructuredReview(endpoint, systemPrompt, userPrompt, maxReviewTokens) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetchJson(`${endpoint}${chatPath}`, {
        method: 'POST',
        timeoutMs,
        body: {
          model,
          stream: false,
          temperature: 0,
          max_tokens: maxReviewTokens,
          enable_thinking: false,
          reasoning_effort: 'none',
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content:
                attempt === 1
                  ? userPrompt
                  : `${userPrompt}\nPrevious response was invalid JSON. Return exactly one JSON object and no other text.`
            }
          ]
        }
      });
      const content = String(response?.choices?.[0]?.message?.content || '');
      return { parsed: parseJson(content), content };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function normalizeReviewDecision(parsed, content) {
  const decision = String(parsed?.decision || '');
  const confidence = Number(parsed?.confidence);
  if (!new Set(['accept', 'reject', 'manual_review']).has(decision)) throw new Error('quality_review_invalid_decision');
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
    throw new Error('quality_review_invalid_confidence');
  if (typeof parsed?.reason !== 'string' || !parsed.reason.trim()) throw new Error('quality_review_missing_reason');
  if (!Array.isArray(parsed?.errors)) throw new Error('quality_review_invalid_errors');
  return {
    approved: decision === 'accept' && confidence >= qualityReviewConfidence,
    decision,
    confidence,
    reason: parsed.reason,
    errors: parsed.errors.slice(0, 4),
    raw_preview: content.slice(0, 800)
  };
}

function buildQualityReviewPrompt(row, output) {
  const sourceGloss = sourceMeaningAnchor(row);
  const localizations = Object.fromEntries(
    Object.entries(output?.localizations || {}).map(([lang, value]) => [
      lang,
      {
        term: value?.term || '',
        reading: lang === 'zh' || lang === 'ja' ? value?.reading || '' : undefined,
        reading_evidence:
          lang === 'zh' || lang === 'ja' ? qualityReviewReadingEvidence(lang, value) : undefined,
        definition: value?.definition || ''
      }
    ])
  );
  return `Dictionary lexical QA. Source=[language,headword,meaning]. Each translation has term and definition; ZH/JA also include reading.
Reject only a clear factual error: wrong sense/term, invented or mismatched ZH/JA reading, or definition switching sense.
When reading_evidence is deterministic_dictionary, the reading already passed a deterministic pinyin or JMdict lookup. Treat it as locked evidence and do not reject, correct, or second-guess that reading. Review only readings marked model_generated_or_unknown.
Do not evaluate EN/PT pronunciation here. It is checked separately with pronunciation-system metadata, and deterministic ECDICT transcription is not IPA. Normal noun/adjective/verb translation shifts are acceptable. Kana-only Japanese ambiguity was already source-reviewed. Minor spacing and punctuation are acceptable.
Each target term itself must be a natural modern standalone translation of the source meaning. Do not approve an incorrect term merely because its definition describes the right sense, or rationalize it with a rare historical meaning.
The source meaning shown below is the controlling single-sense anchor. Do not mix in another meaning from a homograph or a broader source gloss.
${row.candidate_review_provenance?.kind === 'manual_evidence_override' ? 'A lexicographer verified that this exact source headword has the anchored sense. Do not reject it merely because a homograph or another spelling is more common.\n' : ''}If uncertain use manual_review, not reject. Return JSON only:
{"decision":"accept|reject|manual_review","confidence":0.0,"reason":"short reason","errors":["lang:field:problem"]}
Source=${JSON.stringify([row.source_lang, row.word, sourceGloss])}
Translations=${JSON.stringify(localizations)}`;
}

function qualityReviewReadingEvidence(lang, localization) {
  if (!localization || typeof localization !== 'object') return 'model_generated_or_unknown';
  if (lang === 'zh' && chineseReadingMatches(localization.term, localization.reading)) {
    return 'deterministic_dictionary';
  }
  if (
    lang === 'ja' &&
    validateJapaneseReading(localization.term, localization.reading, false) === 'match'
  ) {
    return 'deterministic_dictionary';
  }
  return 'model_generated_or_unknown';
}

function applyDeterministicReadingReviewOverride(output, review) {
  if (review?.approved || review?.decision !== 'reject' || !Array.isArray(review.errors) || !review.errors.length) {
    return review;
  }
  const locked = {
    zh: String(output?.localizations?.zh?.reading_source || '').startsWith('deterministic:'),
    ja: String(output?.localizations?.ja?.reading_source || '').startsWith('deterministic:')
  };
  const onlyLockedReadingErrors = review.errors.every((error) => {
    const value = String(error || '');
    return (locked.zh && /^zh:reading(?::|_|$)/iu.test(value)) || (locked.ja && /^ja:reading(?::|_|$)/iu.test(value));
  });
  if (!onlyLockedReadingErrors) return review;
  return {
    ...review,
    approved: true,
    decision: 'accept',
    deterministic_reading_override: true,
    overridden_decision: 'reject',
    overridden_reason: review.reason,
    overridden_errors: review.errors,
    reason: 'LLM reading objection ignored because all cited readings came from deterministic dictionary evidence.',
    errors: []
  };
}

function applyEvidenceBoundQualityReviewDeferral(row, output, review) {
  if (
    !deferEvidenceBoundQualityRejects ||
    review?.approved ||
    review?.decision !== 'reject' ||
    !Array.isArray(review.errors) ||
    !review.errors.length
  ) {
    return review;
  }
  const sourceLang = String(row?.source_lang || '');
  const disputedLangs = new Set();
  const onlyBoundTargetTermOrReadingErrors = review.errors.every((error) => {
    const match = String(error || '').match(/^(en|pt-BR|zh|ja):(term|reading)(?::|_|$)/iu);
    if (!match) return false;
    const lang = match[1] === 'pt-br' ? 'pt-BR' : match[1];
    if (lang === sourceLang) return false;
    const localization = output?.localizations?.[lang];
    if (!String(localization?.term_source || '').startsWith('deterministic:reviewed-independent-evidence')) {
      return false;
    }
    disputedLangs.add(lang);
    return true;
  });
  if (!onlyBoundTargetTermOrReadingErrors || !disputedLangs.size) return review;
  return {
    ...review,
    approved: true,
    decision: 'manual_review',
    evidence_bound_deferral: true,
    deferred_to: ['deterministic_reverse_evidence', 'independent_gemma_consensus'],
    deferred_languages: [...disputedLangs],
    overridden_decision: 'reject',
    overridden_reason: review.reason,
    overridden_errors: review.errors,
    reason: 'Same-model objection to independently bound target term deferred to reverse evidence and Gemma.',
    errors: []
  };
}

async function prewarmEndpoints() {
  return Promise.all(
    endpoints.map(async (endpoint) => {
      const started = performance.now();
      try {
        const status = await fetchJson(`${endpoint}/v1/status`, { timeoutMs: 30_000 });
        const endpointVariant = endpointGgufVariants?.[endpoint] || ggufVariant;
        const sameLoadedModel =
          status?.active_model === model &&
          (!endpointVariant || status?.gguf_variant === endpointVariant) &&
          (!status?.context_length || Number(status.context_length) === maxSeqLength) &&
          (!status?.speculative_type || status.speculative_type === speculativeType);
        if (sameLoadedModel && !forceReload) {
          return {
            endpoint,
            ok: true,
            skipped: true,
            seconds: secondsSince(started),
            active_model: status.active_model
          };
        }
        const load = await loadEndpoint(endpoint, status);
        return {
          endpoint,
          ok: true,
          skipped: false,
          seconds: secondsSince(started),
          active_model: load?.active_model || load?.model_path || model,
          speculative_type: load?.speculative_type || null
        };
      } catch (error) {
        return { endpoint, ok: false, skipped: false, seconds: secondsSince(started), error: errorMessage(error) };
      }
    })
  );
}

async function loadEndpoint(endpoint, status = null) {
  const currentStatus = status || (await fetchJson(`${endpoint}/v1/status`, { timeoutMs: 30_000 }));
  const endpointVariant = endpointGgufVariants?.[endpoint] || ggufVariant;
  const loadBody = {
    model_path: model,
    max_seq_length: maxSeqLength,
    load_in_4bit: loadIn4bit,
    speculative_type: currentStatus?.llama_cpp_supports_mtp === false ? 'off' : speculativeType
  };
  if (endpointVariant) loadBody.gguf_variant = endpointVariant;
  const loaded = await fetchJson(`${endpoint}/v1/load`, {
    method: 'POST',
    timeoutMs: loadTimeoutMs,
    body: loadBody
  });
  await waitForEndpointReady(endpoint);
  return loaded;
}

async function waitForEndpointReady(endpoint) {
  const started = performance.now();
  let consecutiveReady = 0;
  while (performance.now() - started < Math.max(postLoadWaitMs + 30_000, 45_000)) {
    await delay(2_000);
    try {
      const status = await fetchJson(`${endpoint}/v1/status`, { timeoutMs: 15_000 });
      if (status?.active_model === model && Array.isArray(status?.loaded) && status.loaded.includes(model)) {
        consecutiveReady++;
      } else {
        consecutiveReady = 0;
      }
      if (consecutiveReady >= 3 && performance.now() - started >= postLoadWaitMs) return;
    } catch {
      consecutiveReady = 0;
    }
  }
  throw new Error(`Model did not become ready after load: ${endpoint}`);
}

async function fetchJson(url, { method = 'GET', timeoutMs = 30_000, body = null } = {}) {
  const response = await fetch(url, {
    method,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: body ? JSON.stringify(body) : null
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

function buildPrompt(row) {
  if (promptMode === 'nano') return buildNanoPrompt(row);
  if (promptMode === 'micro') return buildMicroPrompt(row);
  if (promptMode === 'ultra') return buildUltraCompactPrompt(row);
  if (promptMode === 'compact') return buildCompactPrompt(row);
  const lines = [
    'Return one compact JSON object. No markdown. No extra keys.',
    `source_lang=${row.source_lang}`,
    `headword=${JSON.stringify(row.word)}`,
    `normalized_key=${JSON.stringify(row.normalized_key || row.word)}`,
    `frequency_rank=${row.frequency_rank ?? null}`,
    `part_of_speech=${JSON.stringify(row.useful_senses?.[0]?.part_of_speech || null)}`,
    `meaning_gloss=${JSON.stringify(row.first_gloss_key || row.first_gloss_preview || '')}`,
    'Shape:',
    '{"headword":"","normalized_key":"","primary_lang":"","frequency_rank":0,"part_of_speech":null,"gloss_key":"","source_evidence_valid":true,"source_evidence_reason":null,"localizations":{"en":{"term":"","pronunciation":"","pronunciation_system":"IPA","definition":""},"pt-BR":{"term":"","pronunciation":"","pronunciation_system":"IPA","definition":""},"zh":{"term":"","reading":"","reading_system":"pinyin","definition":""},"ja":{"term":"","reading":"","reading_system":"kana","definition":""}}}',
    'Rules: source language term must equal headword exactly, including accents and script. Other language terms translate meaning_gloss, not the spelling of headword.',
    'Definitions must be written in the same language as their localization and must explain the meaning or grammatical use in a short phrase of at least 4 words for en/pt-BR, and at least 4 characters for zh/ja. Never repeat only the term.',
    'gloss_key must be concise: use one meaning label or at most 2 close synonyms, not a long semicolon-separated synonym list.',
    'zh term and definition use Simplified Chinese. zh reading is pinyin with tone marks or tone numbers. ja reading must be kana only or kana with kanji okurigana; never romaji. en and pt-BR include IPA pronunciation. If unsure, keep the source term exactly and explain the gloss.'
  ];
  if (residualMode) lines.push(...residualPromptRules(row));
  return lines.join('\n');
}

function buildMicroPrompt(row) {
  const gloss = sourceMeaningAnchor(row);
  const sourceEvidence = compactSourceEvidence(row);
  const generationHints = compactGenerationHints(row);
  const preferredTerms = enforceReviewedPreferredTerms ? compactReviewedPreferredTerms(row) : '';
  const lines = [
    'JSON only.',
    `Word=${JSON.stringify(row.word)}; lang=${row.source_lang}; meaning=${JSON.stringify(gloss)}.`,
    sourceEvidence ? `SourceDictionaryEvidence=${JSON.stringify(sourceEvidence)}.` : '',
    generationHints ? `VerifiedTranslationHints=${JSON.stringify(generationHints)}.` : '',
    preferredTerms ? `ReviewedPreferredTerms=${JSON.stringify(preferredTerms)}.` : '',
    'Output {"v":true,"r":null,"g":"sense","en":["term","IPA","definition"],"pt-BR":["term","IPA","definition"],"zh":["term","pinyin","definition"],"ja":["term","kana","definition"]}.',
    'Verify word really has meaning; otherwise output only v=false,r=reason.',
    'When v=true all 12 array strings are required: source term exact, other terms translated, full natural definitions, zh simplified.',
    'A genuine secondary or contextual dictionary sense is valid. Do not reject only because it is non-primary, ambiguous, or a close synonym; reject only a clearly unrelated meaning.',
    row.candidate_review_provenance?.kind === 'manual_evidence_override'
      ? 'A lexicographer manually verified this source sense, including valid kana homographs or figurative meanings. Generate that specified sense; do not reject it merely because another sense is more common.'
      : '',
    'EN/PT terms use Latin text only and never copy CJK source text. JA reading must contain kana, never kanji-only or romaji.',
    generationHints ? 'Prefer the verified translation hints when they fit the anchored sense; do not replace them with a less certain synonym.' : '',
    preferredTerms
      ? enforceReviewedPreferredTerms
        ? 'ReviewedPreferredTerms are mandatory exact term values for their languages. Generate each definition and pronunciation/reading for that exact term.'
        : 'ReviewedPreferredTerms are strongly supported reference terms. Prefer them, but a standard close synonym is allowed when it is more natural and matches the anchored sense exactly.'
      : ''
  ];
  if (Array.isArray(row.latest_errors) && row.latest_errors.length) {
    lines.push(`Fix previous errors: ${row.latest_errors.join(',')}.`);
    if (row.latest_errors.includes('en_term_copies_non_english_source')) {
      lines.push(
        `EN term must translate the full meaning ${JSON.stringify(gloss)}, not merely copy the source spelling.`
      );
    }
    if (row.latest_errors.includes('missing_ja_reading')) {
      lines.push(
        'JA reading must use hiragana or katakana characters, never romaji. For a katakana term, copy its katakana spelling into the reading when appropriate.'
      );
    }
    if (row.latest_errors.includes('missing_zh_reading')) {
      lines.push('ZH reading must be pinyin with tone marks or tone numbers, never Chinese characters alone.');
    }
    if (
      row.latest_errors.includes('missing_pronunciation_en') ||
      row.latest_errors.includes('missing_pronunciation_pt-BR')
    ) {
      lines.push('Provide nonempty IPA for both translated EN and PT terms. Do not copy the source-language reading.');
    }
    if (row.latest_errors.includes('en_term_gloss_mismatch')) {
      lines.push(`EN term must express ${JSON.stringify(gloss)} and must not be an unrelated phrase.`);
    }
    if (row.latest_errors.includes('shared_en_pt_pronunciation')) {
      lines.push(
        'EN and PT pronunciations must pronounce their own translated terms. Never copy the source-language reading into either IPA field.'
      );
    }
    if (row.latest_errors.includes('quality_review_rejected')) {
      const details = Array.isArray(row.latest_quality_review_errors)
        ? row.latest_quality_review_errors.join('; ')
        : '';
      lines.push(
        `A dictionary QA reviewer found a factual error${details ? `: ${details}` : ''}. Regenerate the affected term, reading, IPA, or definition.`
      );
      if (row.latest_quality_review_reason) {
        lines.push(`QA reason: ${String(row.latest_quality_review_reason).slice(0, 220)}.`);
      }
    }
    if (row.latest_errors.includes('pronunciation_review_rejected')) {
      const details = Array.isArray(row.latest_pronunciation_review_errors)
        ? row.latest_pronunciation_review_errors.join('; ')
        : '';
      lines.push(`Fix the EN/PT IPA so each pronunciation matches its own term${details ? `: ${details}` : ''}.`);
      if (row.latest_pronunciation_review_reason) {
        lines.push(`Pronunciation QA reason: ${String(row.latest_pronunciation_review_reason).slice(0, 220)}.`);
      }
    }
    if (row.latest_errors.includes('ja_reading_mismatch') && row.latest_ja_term) {
      lines.push(
        `JA term ${JSON.stringify(row.latest_ja_term)} must use an exact matching kana reading` +
          `${row.latest_ja_expected_readings?.length ? ` such as ${JSON.stringify(row.latest_ja_expected_readings)}` : ''}.`
      );
    }
    if (row.latest_errors.includes('ja_term_not_in_jmdict') && row.latest_ja_term) {
      lines.push(
        `Replace JA term ${JSON.stringify(row.latest_ja_term)} with a common modern dictionary term whose exact kana reading is established in JMdict.`
      );
    }
    if (row.latest_errors.includes('zh_reading_mismatch') && row.latest_zh_term) {
      lines.push(
        `ZH term ${JSON.stringify(row.latest_zh_term)} must use matching pinyin` +
          `${row.latest_zh_expected_readings?.length ? ` such as ${JSON.stringify(row.latest_zh_expected_readings)}` : ''}.`
      );
    }
    if (
      row.latest_errors.includes('source_evidence_mismatch') &&
      evidenceRejectionContradictsReason(row.latest_evidence_reason, row)
    ) {
      lines.push(
        'Your previous rejection contradicted the supplied word or evidence. Re-evaluate the source dictionary evidence and set v=true unless the meaning is clearly unrelated.'
      );
    }
  }
  return lines.filter(Boolean).join(' ');
}

function buildNanoPrompt(row) {
  const terms = compactReviewedPreferredTerms(row) || compactGenerationHints(row);
  return [
    'JSON only.',
    `W=${JSON.stringify(row.word)};L=${row.source_lang};M=${JSON.stringify(sourceMeaningAnchor(row))}.`,
    terms ? `T=${JSON.stringify(terms)}.` : '',
    'If M is not a real sense of W: {"v":false,"r":"reason"}.',
    'Else: {"v":true,"r":null,"g":"sense","en":["term","IPA","definition"],"pt-BR":["term","IPA","definition"],"zh":["term","pinyin","definition"],"ja":["term","kana","definition"]}.',
    'Use W exactly for L; use T terms when given; translate the same sense; natural definitions; simplified zh.'
  ]
    .filter(Boolean)
    .join(' ');
}

function compactGenerationHints(row) {
  const hints = row?.generation_hints;
  if (!hints || typeof hints !== 'object') return '';
  return Object.entries(hints)
    .filter(([, value]) => Array.isArray(value?.terms) && value.terms.length)
    .map(([lang, value]) => `${lang}:${value.terms.slice(0, 3).join('|')}`)
    .join(' ; ');
}

function compactReviewedPreferredTerms(row) {
  const preferredTerms = row?.candidate_evidence_review?.preferred_terms;
  if (!preferredTerms || typeof preferredTerms !== 'object') return '';
  return Object.entries(preferredTerms)
    .filter(([, term]) => nonEmpty(term))
    .map(([lang, term]) => `${lang}:${String(term).trim()}`)
    .join(' ; ');
}

function compactReviewedSuggestedTerms(row) {
  const suggestedTerms = row?.candidate_evidence_review?.suggested_terms;
  if (!suggestedTerms || typeof suggestedTerms !== 'object') return '';
  return Object.entries(suggestedTerms)
    .filter(([, term]) => nonEmpty(term))
    .map(([lang, term]) => `${lang}:${String(term).trim()}`)
    .join(' ; ');
}

function compactJapaneseGenerationContract(row) {
  const contract = row?.generation_contract;
  if (!nonEmpty(contract?.ja_term) || !nonEmpty(contract?.ja_reading)) return '';
  return `term=${String(contract.ja_term).trim()}|reading=${String(contract.ja_reading).trim()}`;
}

function compactSourceEvidence(row) {
  const localizations = Array.isArray(row?.first_sense_localizations) ? row.first_sense_localizations : [];
  return localizations
    .filter((item) => item?.lang && item?.term)
    .slice(0, 4)
    .map((item) => `${item.lang}:${String(item.term).trim()}${item.source ? `@${item.source}` : ''}`)
    .join(' | ');
}

function evidenceRejectionContradictsReason(value, row = null) {
  const reason = String(value || '').normalize('NFKC');
  const sourceWord = String(row?.word || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
  if (sourceWord && evidenceReasonRepeatsSourceAsCorrection(reason, sourceWord)) return true;
  if (
    /\bdoes\s+(?!not\b)(?:also\s+)?mean\b|\bmeaning\s+is\s+valid\b|\bis\s+(?:a\s+)?valid\s+(?:meaning|translation|mapping)\b/iu.test(
      reason
    )
  ) {
    return true;
  }
  const gloss = firstGlossToken(
    row?.first_gloss_key || row?.first_gloss_preview || row?.gloss_key || row?.gloss_preview || ''
  );
  if (!gloss) return false;
  const normalizedReason = reason.toLowerCase();
  const positivePhrases = [`means '${gloss}`, `means \"${gloss}`, `means ${gloss}`];
  const negativePhrases = [`does not mean '${gloss}`, `does not mean \"${gloss}`, `does not mean ${gloss}`];
  return (
    positivePhrases.some((phrase) => normalizedReason.includes(phrase)) &&
    !negativePhrases.some((phrase) => normalizedReason.includes(phrase))
  );
}

function evidenceReasonRepeatsSourceAsCorrection(reason, sourceWord) {
  const normalized = String(reason || '')
    .normalize('NFKC')
    .toLowerCase();
  const quotedCorrections = [
    ...normalized.matchAll(/(?:misspelling of|correct spelling(?::| is))\s*['"]([^'"]+)['"]/gu)
  ].map((match) => match[1].trim());
  return quotedCorrections.includes(sourceWord);
}

function normalizeModelOutput(output, row) {
  if (!['micro', 'nano'].includes(promptMode) || !output || typeof output !== 'object') return output;
  const localization = (lang, readingSystem, pronunciationSystem) => {
    const values = Array.isArray(output[lang]) ? output[lang] : [];
    const normalized = {
      term: String(values[0] || '').trim(),
      definition: String(values[2] || '').trim()
    };
    if (readingSystem) {
      normalized.reading = String(values[1] || '').trim();
      normalized.reading_system = readingSystem;
    } else {
      normalized.pronunciation = String(values[1] || '').trim();
      normalized.pronunciation_system = pronunciationSystem;
    }
    return normalized;
  };
  const modelGloss = String(output.g || '').trim();
  const sourceGloss = String(row.first_gloss_key || row.gloss_key || row.first_gloss_preview || '').trim();
  return {
    headword: row.word,
    normalized_key: row.normalized_key || row.word,
    primary_lang: row.source_lang,
    frequency_rank: row.frequency_rank ?? null,
    part_of_speech: row.useful_senses?.[0]?.part_of_speech || row.part_of_speech || null,
    gloss_key: !modelGloss || /^(?:sense|meaning|definition)$/iu.test(modelGloss) ? sourceGloss : modelGloss,
    source_evidence_valid: output.v === true,
    source_evidence_reason: output.r == null ? null : String(output.r).trim(),
    localizations: {
      en: localization('en', null, 'IPA'),
      'pt-BR': localization('pt-BR', null, 'IPA'),
      zh: localization('zh', 'pinyin', null),
      ja: localization('ja', 'kana', null)
    }
  };
}

function buildBatchPrompt(rows) {
  if (promptMode === 'ultra') return buildUltraCompactBatchPrompt(rows);
  if (promptMode === 'compact') return buildCompactBatchPrompt(rows);
  const inputs = rows.map((row) => ({
    source_entry_id: row.source_entry_id,
    source_lang: row.source_lang,
    headword: row.word,
    normalized_key: row.normalized_key || row.word,
    frequency_rank: row.frequency_rank ?? null,
    part_of_speech: row.useful_senses?.[0]?.part_of_speech || null,
    meaning_gloss: row.first_gloss_key || row.first_gloss_preview || ''
  }));
  const lines = [
    'Return one compact JSON object. No markdown. No extra keys.',
    'Shape: {"items":[RECORD,...]}',
    'Each RECORD shape:',
    '{"source_entry_id":0,"headword":"","normalized_key":"","primary_lang":"","frequency_rank":0,"part_of_speech":null,"gloss_key":"","localizations":{"en":{"term":"","pronunciation":"","pronunciation_system":"IPA","definition":""},"pt-BR":{"term":"","pronunciation":"","pronunciation_system":"IPA","definition":""},"zh":{"term":"","reading":"","reading_system":"pinyin","definition":""},"ja":{"term":"","reading":"","reading_system":"kana","definition":""}}}',
    'Rules: return exactly one item for each input, preserving source_entry_id and order. source language term must equal headword exactly, including accents and script. Other language terms translate meaning_gloss, not the spelling of headword.',
    'Definitions must be written in the same language as their localization and must explain the meaning or grammatical use in a short phrase of at least 4 words for en/pt-BR, and at least 4 characters for zh/ja. Never repeat only the term.',
    'gloss_key must be concise: use one meaning label or at most 2 close synonyms, not a long semicolon-separated synonym list.',
    'zh term and definition use Simplified Chinese. zh reading is pinyin with tone marks or tone numbers. ja reading must be kana only or kana with kanji okurigana; never romaji. en and pt-BR include IPA pronunciation. If unsure, keep the source term exactly and explain the gloss.',
    `inputs=${JSON.stringify(inputs)}`
  ];
  if (residualMode) lines.push(...residualPromptRules());
  return lines.join('\n');
}

function buildUltraCompactPrompt(row) {
  const gloss = row.first_gloss_key || row.first_gloss_preview || row.gloss_key || row.gloss_preview || '';
  return [
    'Return strict JSON only.',
    `Input: source_entry_id=${row.source_entry_id}; headword=${row.word}; lang=${row.source_lang}; meaning=${gloss}`,
    'Schema:',
    '{"headword":"","normalized_key":"","primary_lang":"","frequency_rank":0,"part_of_speech":null,"gloss_key":"","localizations":{"en":{"term":"","pronunciation":"","pronunciation_system":"IPA","definition":""},"pt-BR":{"term":"","pronunciation":"","pronunciation_system":"IPA","definition":""},"zh":{"term":"","reading":"","reading_system":"pinyin","definition":""},"ja":{"term":"","reading":"","reading_system":"kana","definition":""}}}',
    'Rules: independently verify that meaning is a real meaning of the source-language headword. Set source_evidence_valid=false with a short reason when unrelated or mistranslated; otherwise true. source lang term equals headword exactly. en/pt terms translate meaning, not spelling. zh Simplified with pinyin reading. ja term Japanese with kana reading. en/pt pronunciations are IPA. Definitions are natural in each language. gloss_key max 2 close synonyms.'
  ].join('\n');
}

function buildUltraCompactBatchPrompt(rows) {
  const inputs = rows.map((row) => {
    const gloss = row.first_gloss_key || row.first_gloss_preview || row.gloss_key || row.gloss_preview || '';
    return `${row.source_entry_id}|${row.word}|${row.source_lang}|${gloss}`;
  });
  return [
    'Return strict JSON only: {"items":[records]}.',
    'Record schema:',
    '{"source_entry_id":0,"headword":"","normalized_key":"","primary_lang":"","frequency_rank":0,"part_of_speech":null,"gloss_key":"","source_evidence_valid":true,"source_evidence_reason":null,"localizations":{"en":{"term":"","pronunciation":"","pronunciation_system":"IPA","definition":""},"pt-BR":{"term":"","pronunciation":"","pronunciation_system":"IPA","definition":""},"zh":{"term":"","reading":"","reading_system":"pinyin","definition":""},"ja":{"term":"","reading":"","reading_system":"kana","definition":""}}}',
    'Rules: preserve source_entry_id. Independently verify meaning against the source-language headword; set source_evidence_valid=false with reason when unrelated, otherwise true. source lang term equals headword exactly. en/pt terms translate meaning. zh Simplified+pinyin. ja Japanese+kana. en/pt IPA. Natural definitions. gloss_key max 2 close synonyms.',
    'Inputs source_entry_id|headword|lang|meaning:',
    ...inputs
  ].join('\n');
}

function buildCompactPrompt(row) {
  const gloss = row.first_gloss_key || row.first_gloss_preview || row.gloss_key || row.gloss_preview || '';
  const preferredTerms = enforceReviewedPreferredTerms ? compactReviewedPreferredTerms(row) : '';
  const generationHints = enforceGenerationHintTerms ? compactGenerationHints(row) : '';
  const definitionContract = compactDefinitionContract(row);
  const suggestedTerms = compactReviewedSuggestedTerms(row);
  const japaneseContract = compactJapaneseGenerationContract(row);
  const lines = [
    'Return one JSON object for a multilingual dictionary entry.',
    `Headword: ${row.word}`,
    `Source language: ${row.source_lang}`,
    `Meaning: ${gloss}`,
    generationHints ? `Verified exact terms: ${generationHints}` : '',
    preferredTerms ? `Reviewed preferred terms: ${preferredTerms}` : '',
    suggestedTerms ? `Semantic term constraints: ${suggestedTerms}` : '',
    japaneseContract ? `Required JA term and reading: ${japaneseContract}` : '',
    definitionContract ? `Required definition contract: ${definitionContract}` : '',
    `Top-level keys: headword, normalized_key, primary_lang, frequency_rank, part_of_speech, gloss_key, source_evidence_valid, source_evidence_reason, localizations${requireExamples ? ', example' : ''}.`,
    'Set source_evidence_valid=true only when Meaning is a real sense of the source-language headword; otherwise set false and explain source_evidence_reason.',
    'Localizations: en, pt-BR, zh, ja.',
    'en and pt-BR fields: term, pronunciation, pronunciation_system, definition.',
    'zh and ja fields: term, reading, reading_system, definition.',
    'Use the exact headword as the source-language term.',
    generationHints
      ? 'Use the first Verified exact term for every matching localization term field, and generate its matching definition and reading or pronunciation.'
      : '',
    preferredTerms
      ? 'Use every Reviewed preferred term exactly in its matching localization term field.'
      : '',
    japaneseContract
      ? 'Copy the Required JA term and reading exactly into localizations.ja.term and localizations.ja.reading.'
      : '',
    definitionContract
      ? 'Every localization definition must preserve its matching Required definition contract exactly in meaning, scope, domain, and grammatical role.'
      : '',
    'All four terms must preserve the same grammatical category and concept type as the source sense. Never change noun to adjective, quality to doctrine, genus to plant, instrument to procedure, chemical group to material, or one colour/pigment to a related colour.',
    'If source language is zh or ja, en.term and pt-BR.term must be translated dictionary terms in English and Portuguese, not hanzi, kana, pinyin, or the original source spelling.',
    'If source language is zh or ja, en.pronunciation and pt-BR.pronunciation must pronounce the translated English/Portuguese term, not the source-language word.',
    "Use one coherent dictionary sense only. WikDict/OMW evidence can contain homographs from unrelated languages; never mix unrelated senses such as Portuguese verb forms with English area unit 'are'.",
    'Definitions must be natural explanations in the same language as the localization; do not copy the English meaning gloss as a definition for other languages.',
    'Every definition must explain the term rather than repeat it. English and Portuguese definitions require at least 6 words; Chinese requires at least 8 Chinese characters; Japanese requires at least 12 Japanese characters.',
    'For zh and ja, definition must be a complete Chinese/Japanese explanation, not just the translated term. Never place Chinese text in the Japanese definition.',
    'gloss_key must be concise: use one meaning label or at most 2 close synonyms, not a long semicolon-separated synonym list.',
    'Use Simplified Chinese for zh. zh.reading must be pinyin with tone marks or tone numbers, not hanzi.',
    'Use kana for ja reading. ja.reading must contain Japanese kana, not romaji.',
    'Use IPA for en and pt-BR.'
  ];
  if (requireExamples) {
    lines.push(
      'Also return example={"source_lang":"zh","source_text":"简体中文例句","localizations":{"en":"English sentence","pt-BR":"Frase em português brasileiro","zh":"同一个简体中文例句","ja":"日本語の文"}}.',
      'The example must naturally demonstrate this exact sense. source_text must be Simplified Chinese and equal example.localizations.zh. Every localization must translate the same sentence and use the corresponding localized term naturally.'
    );
  }
  if (Array.isArray(row.latest_errors) && row.latest_errors.includes('quality_review_rejected')) {
    const details = Array.isArray(row.latest_quality_review_errors)
      ? row.latest_quality_review_errors.join('; ')
      : '';
    lines.push(
      `A previous independent dictionary QA review rejected the output${details ? `: ${details}` : '.'}`
    );
    if (row.latest_quality_review_reason) {
      lines.push(`Regenerate and fix this QA finding: ${String(row.latest_quality_review_reason).slice(0, 700)}`);
    }
    lines.push('Do not repeat the rejected term, grammatical category, factual claim, or typo.');
  }
  if (Array.isArray(row.latest_errors) && row.latest_errors.includes('structured_consensus_correction_retry')) {
    const details = Array.isArray(row.latest_quality_review_errors)
      ? row.latest_quality_review_errors.join('; ')
      : '';
    lines.push(`Apply these exact independent-review corrections${details ? `: ${details}` : '.'}`);
    if (row.latest_quality_review_reason) {
      lines.push(`Correction reason: ${String(row.latest_quality_review_reason).slice(0, 700)}`);
    }
    lines.push('Do not restore the rejected current value.');
  }
  if (residualMode) lines.push(...residualPromptRules(row));
  return lines.filter(Boolean).join('\n');
}

function buildCompactBatchPrompt(rows) {
  const inputLines = rows.map((row) => {
    const gloss =
      row?.candidate_evidence_review?.english_anchor ||
      row.first_gloss_key ||
      row.first_gloss_preview ||
      row.gloss_key ||
      row.gloss_preview ||
      '';
    const preferredTerms = enforceReviewedPreferredTerms ? compactReviewedPreferredTerms(row) : '';
    const definitionContract = compactDefinitionContract(row);
    const suggestedTerms = compactReviewedSuggestedTerms(row);
    const japaneseContract = compactJapaneseGenerationContract(row);
    const retryErrors = Array.isArray(row.latest_errors) && row.latest_errors.length
      ? row.latest_errors.join(',')
      : '';
    const expectedJaReadings = Array.isArray(row.latest_ja_expected_readings)
      ? row.latest_ja_expected_readings.join('|')
      : '';
    const expectedZhReadings = Array.isArray(row.latest_zh_expected_readings)
      ? row.latest_zh_expected_readings.join('|')
      : '';
    return (
      `- source_entry_id=${row.source_entry_id}; headword=${row.word}; source_lang=${row.source_lang}; meaning=${gloss}` +
      (preferredTerms ? `; reviewed_preferred_terms=${preferredTerms}` : '') +
      (definitionContract ? `; definition_contract=${definitionContract}` : '') +
      (suggestedTerms ? `; semantic_term_suggestions=${suggestedTerms}` : '') +
      (japaneseContract ? `; required_ja_contract=${japaneseContract}` : '') +
      (retryErrors ? `; previous_validation_errors=${retryErrors}` : '') +
      (expectedJaReadings ? `; required_ja_reading=${expectedJaReadings}` : '') +
      (expectedZhReadings ? `; required_zh_reading=${expectedZhReadings}` : '')
    );
  });
  const lines = [
    'Return one JSON object with an items array for multilingual dictionary entries.',
    'Each item must preserve source_entry_id and include headword, normalized_key, primary_lang, frequency_rank, part_of_speech, gloss_key, source_evidence_valid, source_evidence_reason, localizations.',
    'Set source_evidence_valid=true only when meaning is a real sense of the source-language headword; otherwise set false and explain source_evidence_reason.',
    'Localizations: en, pt-BR, zh, ja.',
    'en and pt-BR fields: term, pronunciation, pronunciation_system, definition.',
    'zh and ja fields: term, reading, reading_system, definition.',
    'Use exact headword as the source-language term. Use Simplified Chinese for zh. Use kana for ja reading. Use IPA for en and pt-BR.',
    'When reviewed_preferred_terms are present, copy every listed term exactly into its matching localization term field.',
    'When required_ja_contract is present, copy its term and reading exactly into the Japanese localization.',
    'When definition_contract is present, each localization definition must preserve its matching contract meaning and must not add, remove, broaden, or narrow any sense, domain, participant, or grammatical role.',
    'semantic_term_suggestions were proposed by an independent semantic pre-review. Prefer them when natural, but correct them if needed; they are not binding dictionary evidence.',
    'Before setting source_evidence_valid=true, verify that every reviewed preferred term denotes the same exact semantic scope and grammatical concept as the source headword. If any term changes action/object, process/state, person/profession, material/object, or broad/narrow scope, set source_evidence_valid=false and explain the conflict.',
    'All four definitions must preserve one identical scope. Do not make one language specific to electricity while another includes heat or sound, and do not broaden a specific process into a general state.',
    'If source language is zh or ja, en.term and pt-BR.term must be translated dictionary terms in English and Portuguese, not hanzi, kana, pinyin, or the original source spelling.',
    'If source language is zh or ja, en.pronunciation and pt-BR.pronunciation must pronounce the translated English/Portuguese term, not the source-language word.',
    "Use one coherent dictionary sense only. WikDict/OMW evidence can contain homographs from unrelated languages; never mix unrelated senses such as Portuguese verb forms with English area unit 'are'.",
    'Definitions must be natural explanations in the same language as the localization; do not copy the English meaning gloss as a definition for other languages.',
    'Every definition must explain the term rather than repeat it. English and Portuguese definitions require at least 6 words; Chinese requires at least 8 Chinese characters; Japanese requires at least 12 Japanese characters.',
    'For zh and ja, definition must be a complete Chinese/Japanese explanation, not just the translated term. Never place Chinese text in the Japanese definition.',
    'gloss_key must be concise: use one meaning label or at most 2 close synonyms, not a long semicolon-separated synonym list.',
    'zh.reading must be pinyin with tone marks or tone numbers, not hanzi. ja.reading must contain Japanese kana, not romaji.',
    'Inputs:',
    ...inputLines
  ];
  if (requireExamples) {
    lines.splice(
      lines.length - inputLines.length - 1,
      0,
      'Each item must also include example={source_lang:"zh",source_text:"简体中文例句",localizations:{en:"",pt-BR:"",zh:"",ja:""}}. The four texts must express the same sentence and exact sense.'
    );
  }
  if (residualMode) lines.push(...residualPromptRules());
  return lines.join('\n');
}

function compactDefinitionContract(row) {
  const normalized = Object.fromEntries(
    ['en', 'pt-BR', 'zh', 'ja']
      .map((lang) => [lang, reviewedDefinitionContract(row, lang, lockedTargetTerm(row, lang))])
      .filter(([, value]) => value)
  );
  return Object.keys(normalized).length ? JSON.stringify(normalized) : '';
}

function reviewedDefinitionContract(row, lang, term = '') {
  const explicitCorrection = row?.structured_correction_retry?.corrections?.find(
    (item) => item?.language === lang && item?.field === 'definition' && nonEmpty(item?.replacement)
  );
  if (explicitCorrection) return String(explicitCorrection.replacement).trim();

  const value = String(row?.candidate_evidence_review?.definition_contract?.[lang] || '').trim();
  if (!value || /(?:^|\s)(?:en|pt(?:-BR)?|zh|ja)\s*:/iu.test(value)) return '';
  if (!definitionLanguageLooksRight(value, lang) || definitionTooThin(value, lang, term)) return '';

  const englishAnchor = String(row?.candidate_evidence_review?.english_anchor || '').trim();
  if (lang !== 'en' && englishAnchor && normalize(value) === normalize(englishAnchor)) return '';

  return value;
}

function applyReviewedDefinitionContracts(row, output) {
  if (!output?.localizations) return output;
  for (const lang of LANGS) {
    const definition = reviewedDefinitionContract(row, lang, output.localizations?.[lang]?.term);
    if (!definition || !output.localizations[lang]) continue;
    output.localizations[lang] = {
      ...output.localizations[lang],
      definition,
      definition_source: row?.structured_correction_retry
        ? 'deterministic:structured-correction'
        : 'deterministic:reviewed-definition-contract'
    };
  }
  return output;
}

function applyStructuredFieldCorrections(row, output) {
  if (!output?.localizations) return output;
  const corrections = row?.structured_correction_retry?.corrections;
  if (!Array.isArray(corrections)) return output;
  for (const correction of corrections) {
    const lang = correction?.language;
    const field = correction?.field;
    const replacement = String(correction?.replacement || '').trim();
    if (!LANGS.includes(lang) || !['definition', 'reading', 'pronunciation'].includes(field)) continue;
    if (!replacement || !output.localizations?.[lang]) continue;
    output.localizations = { ...output.localizations };
    output.localizations[lang] = {
      ...output.localizations[lang],
      [field]: replacement,
      [`${field}_source`]: 'deterministic:structured-correction'
    };
  }
  return output;
}

function residualPromptRules(row = null) {
  const extra = [
    'Residual-mode rules:',
    'The previous generic run failed validation, usually because the model copied source spelling or the English gloss into fields that need localized terms and definitions.',
    'Avoid copying the source headword into other languages unless it is a globally standard proper name, acronym, or loanword.',
    'Avoid using the English gloss verbatim as any definition. Expand it into a short natural explanation in each target language.',
    'For Chinese or Japanese source entries, English and Portuguese terms must be natural translations of meaning_gloss, not pinyin, kana, hanzi, or the original character.',
    'For rare Han characters and variants, translate the gloss into an ordinary target-language term. Keep the source character only in the source-language localization.',
    'For abbreviations, acronyms, brands, and proper names, use the conventional localized name if available; otherwise use a short expanded descriptive term in each target language.',
    'Always provide nonempty IPA for English and Portuguese. If a pronunciation is uncertain, give a conservative pronunciation for the chosen term instead of leaving it blank.',
    'Always provide Japanese reading in kana. For translated Japanese terms, prefer a common kanji/kana term and a kana reading.',
    'Never output Chinese in English or Portuguese terms. Never output romaji as a Japanese reading.'
  ];
  const errors = row?.latest_errors;
  if (Array.isArray(errors) && errors.length) extra.push(`Previous validation errors to fix: ${errors.join(', ')}`);
  return extra;
}

function validateOutput(row, output) {
  const errors = [];
  if (!output || typeof output !== 'object') return { errors: ['not_json_object'] };
  if (output.source_entry_id !== undefined && String(output.source_entry_id) !== String(row.source_entry_id)) {
    errors.push('source_entry_id_mismatch');
  }
  if (normalize(output.headword) !== normalize(row.word)) errors.push('headword_mismatch');
  if (output.primary_lang !== row.source_lang) errors.push('primary_lang_mismatch');
  if (requireEvidenceVerdict && output.source_evidence_valid !== true) {
    errors.push(
      output.source_evidence_valid === false ? 'source_evidence_mismatch' : 'missing_source_evidence_verdict'
    );
    if (output.source_evidence_valid === false) return { errors };
  }
  if (!nonEmpty(output.gloss_key)) errors.push('missing_gloss_key');
  if (isBroadGlossKey(output.gloss_key)) errors.push('broad_gloss_key');
  validateGeneratedText(errors, 'headword', output.headword);
  validateGeneratedText(errors, 'gloss_key', output.gloss_key);
  if (!output.localizations || typeof output.localizations !== 'object') errors.push('missing_localizations');
  const preferredTerms = row?.candidate_evidence_review?.preferred_terms || {};
  for (const lang of LANGS) {
    const loc = output.localizations?.[lang];
    if (!loc || typeof loc !== 'object') {
      errors.push(`missing_loc_${lang}`);
      continue;
    }
    if (!nonEmpty(loc.term)) errors.push(`missing_term_${lang}`);
    if (
      enforceReviewedPreferredTerms &&
      nonEmpty(preferredTerms[lang]) &&
      normalize(loc.term) !== normalize(preferredTerms[lang])
    ) {
      errors.push(`preferred_term_mismatch_${lang}`);
    }
    if (!nonEmpty(loc.definition)) errors.push(`missing_definition_${lang}`);
    for (const field of ['term', 'reading', 'pronunciation', 'definition']) {
      validateGeneratedText(errors, `${field}_${lang}`, loc[field]);
    }
    if (definitionTooThin(loc.definition, lang, loc.term)) errors.push(`thin_definition_${lang}`);
    if (!termLanguageLooksRight(loc.term, lang)) errors.push(`term_language_${lang}`);
    if (!definitionLanguageLooksRight(loc.definition, lang)) errors.push(`definition_language_${lang}`);
    if (lang === 'zh' && !readingLooksRight(loc.reading, 'zh')) errors.push('missing_zh_reading');
    if (lang === 'ja' && !readingLooksRight(loc.reading, 'ja')) errors.push('missing_ja_reading');
    if ((lang === 'en' || lang === 'pt-BR') && !nonEmpty(loc.pronunciation))
      errors.push(`missing_pronunciation_${lang}`);
  }
  if (deterministicReadings) {
    const zhLoc = output.localizations?.zh;
    if (zhLoc?.term && zhLoc?.reading && !chineseReadingMatches(zhLoc.term, zhLoc.reading)) {
      errors.push('zh_reading_mismatch');
    }
    const jaLoc = output.localizations?.ja;
    if (jaLoc?.term && jaLoc?.reading) {
      if (!matchesTrustedGenerationContractReading(row, jaLoc)) {
        const jaReadingValidation = validateJapaneseReading(jaLoc.term, jaLoc.reading, row.source_lang === 'ja');
        if (jaReadingValidation === 'unknown') errors.push('ja_term_not_in_jmdict');
        if (jaReadingValidation === 'mismatch') errors.push('ja_reading_mismatch');
      }
    }
  }
  const sourceTerm = output.localizations?.[row.source_lang]?.term;
  if (sourceTerm && normalize(sourceTerm) !== normalize(row.word)) errors.push('source_term_mismatch');
  const enTerm = output.localizations?.en?.term;
  const englishGlossTerms = englishGlossTermSet(row);
  if (
    row.source_lang !== 'en' &&
    englishGlossTerms.size &&
    enTerm &&
    normalize(enTerm) === normalize(row.word) &&
    !englishGlossTerms.has(normalize(enTerm))
  ) {
    errors.push('en_term_copies_non_english_source');
  }
  if (
    row.source_lang !== 'en' &&
    englishGlossTerms.size &&
    enTerm &&
    !termsShareContentToken([...englishGlossTerms], [enTerm, output.localizations?.en?.definition])
  ) {
    errors.push('en_term_gloss_mismatch');
  }
  const ptTerm = output.localizations?.['pt-BR']?.term;
  const enPronunciation = output.localizations?.en?.pronunciation;
  const ptPronunciation = output.localizations?.['pt-BR']?.pronunciation;
  if (
    (row.source_lang === 'zh' || row.source_lang === 'ja') &&
    enTerm &&
    ptTerm &&
    normalize(enTerm) !== normalize(ptTerm) &&
    normalizedPronunciation(enPronunciation) &&
    normalizedPronunciation(enPronunciation) === normalizedPronunciation(ptPronunciation)
  ) {
    errors.push('shared_en_pt_pronunciation');
  }
  const knownMismatch = knownSemanticMismatch(row, output);
  if (knownMismatch) errors.push(knownMismatch);
  if (requireExamples) validateGeneratedExample(errors, output.example);
  return { errors };
}

function validateGeneratedExample(errors, example) {
  if (!example || typeof example !== 'object' || Array.isArray(example)) {
    errors.push('missing_required_example');
    return;
  }
  if (example.source_lang !== 'zh') errors.push('example_source_lang_not_zh');
  const sourceText = String(example.source_text || '').trim();
  if (!sourceText) errors.push('example_missing_source_text');
  if (sourceText && toMainlandSimplified(sourceText) !== sourceText) {
    errors.push('example_source_not_simplified');
  }
  const localizations = example.localizations;
  if (!localizations || typeof localizations !== 'object' || Array.isArray(localizations)) {
    errors.push('example_missing_localizations');
    return;
  }
  for (const lang of LANGS) {
    const text = String(localizations[lang] || '').trim();
    if (!text) {
      errors.push(`example_missing_${lang}`);
      continue;
    }
    validateGeneratedText(errors, `example_${lang}`, text);
    if (!definitionLanguageLooksRight(text, lang)) errors.push(`example_language_${lang}`);
    if (lang === 'zh' && toMainlandSimplified(text) !== text) errors.push('example_zh_not_simplified');
  }
  if (sourceText && String(localizations.zh || '').trim() !== sourceText) {
    errors.push('example_source_zh_mismatch');
  }
}

function validateGeneratedText(errors, field, value) {
  const text = String(value || '').trim();
  if (!text) return;
  if (
    REPLACEMENT_CHAR_RE.test(text) ||
    LATIN1_MOJIBAKE_RE.test(text) ||
    JAPANESE_MOJIBAKE_RE.test(text)
  ) {
    errors.push(`mojibake_${field}`);
  }
  if (HTML_ENTITY_RE.test(text)) errors.push(`html_artifact_${field}`);
}

function normalizeGeneratedOutput(row, output) {
  if (!output || typeof output !== 'object') return output;
  const normalized = { ...output };
  normalized.source_entry_id = normalized.source_entry_id ?? row.source_entry_id;
  normalized.source_sense_id = normalized.source_sense_id ?? row.first_sense_id ?? row.useful_senses?.[0]?.id ?? null;
  normalized.source_word = normalized.source_word ?? row.word;
  normalized.source_frequency_rank = normalized.source_frequency_rank ?? row.frequency_rank ?? null;
  normalized.headword = row.word;
  normalized.normalized_key = normalized.normalized_key || row.normalized_key || row.word;
  normalized.primary_lang = row.source_lang;
  normalized.frequency_rank = normalized.frequency_rank ?? row.frequency_rank ?? null;
  normalized.part_of_speech = normalized.part_of_speech ?? row.useful_senses?.[0]?.part_of_speech ?? null;
  // Keep the reviewed semantic anchor separate from the model-facing gloss key.
  // Some source reports use a multilingual gloss summary as gloss_key, which is
  // unsuitable for English reverse-dictionary matching.
  normalized.source_meaning_anchor = sourceMeaningAnchor(row);
  normalized.source_meaning_anchors = sourceMeaningAnchors(row);
  normalized.gloss_key = nonEmpty(normalized.gloss_key)
    ? normalized.gloss_key
    : row.first_gloss_key || row.first_gloss_preview || row.gloss_key || row.gloss_preview || '';

  if (!normalized.localizations || typeof normalized.localizations !== 'object') return normalized;
  applyGenerationHintTerms(row, normalized);
  applyReviewedEvidenceTerms(row, normalized);
  const originalZhLoc = normalized.localizations.zh;
  if (originalZhLoc && typeof originalZhLoc === 'object') {
    normalized.localizations = { ...normalized.localizations };
    normalized.localizations.zh = {
      ...originalZhLoc,
      ...(row.source_lang === 'zh'
        ? {}
        : { term: toMainlandSimplified(String(originalZhLoc.term || '').trim()) }),
      definition: toMainlandSimplified(String(originalZhLoc.definition || '').trim())
    };
  }
  const zhLoc = normalized.localizations.zh;
  if (zhLoc && typeof zhLoc === 'object' && /[\p{Script=Han}]/u.test(String(zhLoc.term || ''))) {
    const deterministicReading = expectedChineseReadings(zhLoc.term)[0];
    if (deterministicReading) {
      normalized.localizations = { ...normalized.localizations };
      normalized.localizations.zh = {
        ...zhLoc,
        reading: deterministicReading,
        reading_system: 'pinyin',
        reading_source: 'deterministic:pinyin-pro'
      };
    }
  }
  const jaLoc = normalized.localizations.ja;
  // A kana-only Japanese term is already its own phonetic reading. Always
  // prefer it over model-supplied expansions or unrelated kana strings.
  if (
    jaLoc &&
    typeof jaLoc === 'object' &&
    kanaOnly(jaLoc.term) &&
    normalizeJapaneseReading(jaLoc.reading) !== normalizeJapaneseReading(jaLoc.term)
  ) {
    normalized.localizations = { ...normalized.localizations };
    normalized.localizations.ja = {
      ...jaLoc,
      reading: String(jaLoc.term).trim(),
      reading_system: 'kana'
    };
  }
  const sourceLoc = normalized.localizations[row.source_lang];
  if (sourceLoc && typeof sourceLoc === 'object') {
    normalized.localizations = { ...normalized.localizations };
    normalized.localizations[row.source_lang] = {
      ...sourceLoc,
      term: row.word,
      ...(row.source_lang === 'ja' && kanaOnly(row.word)
        ? { reading: String(row.word).trim(), reading_system: 'kana' }
        : {})
    };
  }
  applyGenerationContractReading(row, normalized);
  applyUniqueJmdictReading(normalized);
  applyDeterministicPronunciations(normalized);
  if (normalized.example && typeof normalized.example === 'object') {
    normalized.example = normalizeGeneratedExample(normalized.example);
  }
  return normalized;
}

function normalizeGeneratedExample(example) {
  const localizations = example?.localizations && typeof example.localizations === 'object'
    ? Object.fromEntries(
        LANGS.map((lang) => {
          const value = example.localizations[lang];
          const text = typeof value === 'string' ? value : value?.text;
          return [lang, lang === 'zh' ? toMainlandSimplified(text) : String(text || '').trim()];
        })
      )
    : {};
  // The public product contract always stores the Simplified Chinese sentence
  // as the source example. Models occasionally anchor source_text to the input
  // language even though the four localized sentences are otherwise correct.
  const sourceText = toMainlandSimplified(localizations.zh || example?.source_text || '');
  localizations.zh = sourceText;
  return {
    source_lang: 'zh',
    source_text: sourceText,
    localizations
  };
}

function toMainlandSimplified(value) {
  let normalized = traditionalToSimplified(String(value || ''));
  for (const [variant, standard] of MAINLAND_VARIANT_REPLACEMENTS) {
    normalized = normalized.replaceAll(variant, standard);
  }
  return normalized;
}

function applyGenerationContractReading(row, output) {
  if (!deterministicReadings) return;
  const contract = row?.generation_contract;
  const jaLoc = output.localizations?.ja;
  if (
    !contract ||
    !jaLoc ||
    !nonEmpty(contract.ja_term) ||
    !nonEmpty(contract.ja_reading) ||
    normalize(jaLoc.term) !== normalize(contract.ja_term)
  ) {
    return;
  }
  output.localizations = { ...output.localizations };
  output.localizations.ja = {
    ...jaLoc,
    reading: String(contract.ja_reading).trim(),
    reading_system: 'kana',
    reading_source: String(contract.ja_reading_source || 'deterministic:generation-contract')
  };
}

function matchesTrustedGenerationContractReading(row, localization) {
  const contract = row?.generation_contract;
  const trustedSources = new Set([
    'deterministic:kaikki-exact-term-anchor-sense',
    'deterministic:japan-moj-legal-term-suru',
    'deterministic:ndla-subject-heading',
    'deterministic:japan-official-reading-evidence'
  ]);
  if (!contract || !trustedSources.has(contract.ja_reading_source)) {
    return false;
  }
  return normalize(localization?.term) === normalize(contract.ja_term) &&
    normalizeJapaneseReading(localization?.reading) === normalizeJapaneseReading(contract.ja_reading);
}

function applyUniqueJmdictReading(output) {
  if (!deterministicReadings) return;
  const jaLoc = output.localizations?.ja;
  if (!jaLoc || typeof jaLoc !== 'object' || !nonEmpty(jaLoc.term)) return;
  const readings = lookupJapaneseReadings(String(jaLoc.term).trim());
  if (!readings?.size) return;
  const reading = selectCanonicalJapaneseReading(jaLoc.reading, readings);
  if (!reading || normalizeJapaneseReading(jaLoc.reading) === normalizeJapaneseReading(reading)) return;
  output.localizations = { ...output.localizations };
  output.localizations.ja = {
    ...jaLoc,
    reading,
    reading_system: 'kana',
    reading_source: readings.size === 1
      ? 'deterministic:jmdict-unique'
      : 'deterministic:jmdict-primary'
  };
}

function applyReviewedEvidenceTerms(row, output) {
  const review = row?.candidate_evidence_review;
  if (review?.decision !== 'accept' || Number(review.confidence) < 0.9) return;
  const preferredTerms = review.preferred_terms || {};
  for (const lang of LANGS) {
    const term = String(
      preferredTerms[lang] || safelyBoundReviewedSuggestion(row, lang) || ''
    ).trim();
    if (!term || !output.localizations?.[lang]) continue;
    output.localizations = { ...output.localizations };
    output.localizations[lang] = {
      ...output.localizations[lang],
      term,
      term_source: 'deterministic:reviewed-independent-evidence'
    };
  }
  const evidenceLocalizations = Array.isArray(row.first_sense_localizations) ? row.first_sense_localizations : [];
  const jaEvidence = evidenceLocalizations.find((loc) => loc?.lang === 'ja' && kanaOnly(loc.term));
  if (nonEmpty(preferredTerms.ja)) return;
  if (!jaEvidence || !output.localizations?.ja) return;
  output.localizations = { ...output.localizations };
  output.localizations.ja = {
    ...output.localizations.ja,
    term: String(jaEvidence.term).trim(),
    reading: String(jaEvidence.reading || jaEvidence.term).trim(),
    reading_system: 'kana',
    term_source: 'deterministic:reviewed-source-evidence'
  };
}

function safelyBoundReviewedSuggestion(row, lang) {
  // Source review suggestions are not lexical evidence. The only fallback
  // allowed here repairs an English hint whose separators were lost by an
  // upstream gloss normalizer (for example "trifle trifling matter"). The
  // selected word must still be present as a complete phrase in both the
  // reviewed anchor and an independently built generation hint; reverse
  // evidence and final Gemma review remain mandatory downstream.
  if (lang !== 'en') return '';
  const review = row?.candidate_evidence_review;
  if (review?.decision !== 'accept' || Number(review.confidence) < 0.9) return '';
  const suggestion = String(review?.suggested_terms?.en || '').trim();
  if (!suggestion) return '';
  const normalizedSuggestion = normalize(suggestion);
  if (!nonEmpty(review?.definition_contract?.en)) return '';
  const hints = row?.generation_hints?.en?.terms || [];
  return hints.some((hint) => startsWithWholePhrase(normalize(hint), normalizedSuggestion))
    ? suggestion
    : '';
}

function startsWithWholePhrase(value, phrase) {
  if (!value || !phrase) return false;
  const normalizedValue = String(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const normalizedPhrase = String(phrase).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return normalizedValue === normalizedPhrase || normalizedValue.startsWith(`${normalizedPhrase} `);
}

function applyGenerationHintTerms(row, output) {
  if (!enforceGenerationHintTerms) return;
  const hints = row?.generation_hints;
  if (!hints || typeof hints !== 'object') return;
  for (const lang of LANGS) {
    const term = String(hints?.[lang]?.terms?.[0] || '').trim();
    if (!term || !output.localizations?.[lang]) continue;
    output.localizations = { ...output.localizations };
    output.localizations[lang] = {
      ...output.localizations[lang],
      term,
      term_source: 'deterministic:independent-generation-hint'
    };
  }
}

function preloadDeterministicPronunciationSources() {
  if (fs.existsSync(sourceDbPath)) {
    deterministicSourceDb = new Database(sourceDbPath, { readonly: true, fileMustExist: true });
    deterministicSourceDb.pragma('query_only = ON');
    findEcdictPronunciation = deterministicSourceDb.prepare(`
      SELECT ss.raw_json
      FROM source_entries se
      JOIN dictionary_sources ds ON ds.id = se.source_id
      JOIN source_senses ss ON ss.source_entry_id = se.id
      WHERE ds.source_key = 'ecdict'
        AND se.lang = 'en'
        AND se.normalized_key = ?
      ORDER BY ss.sense_order, ss.id
      LIMIT 1
    `);
  }
  if (fs.existsSync(ptPronunciationDbPath)) {
    ptPronunciationDb = new Database(ptPronunciationDbPath, { readonly: true, fileMustExist: true });
    ptPronunciationDb.pragma('query_only = ON');
    findPortuguesePronunciation = ptPronunciationDb.prepare(`
      SELECT ipa, region
      FROM portuguese_pronunciations
      WHERE normalized_key = ?
      ORDER BY priority, ipa
      LIMIT 1
    `);
  }
}

function closeDeterministicSources() {
  findEcdictPronunciation = null;
  findPortuguesePronunciation = null;
  deterministicSourceDb?.close();
  deterministicSourceDb = null;
  ptPronunciationDb?.close();
  ptPronunciationDb = null;
}

function applyDeterministicPronunciations(output) {
  const en = output?.localizations?.en;
  if (findEcdictPronunciation && en?.term) {
    const row = findEcdictPronunciation.get(normalize(en.term));
    const raw = safeJsonObject(row?.raw_json);
    const phonetic = normalizeEcdictPhonetic(raw.phonetic, en.term);
    if (phonetic && phonetic.length <= 80 && hasIpaSignal(phonetic)) {
      output.localizations = { ...output.localizations };
      output.localizations.en = {
        ...en,
        pronunciation: phonetic,
        pronunciation_system: 'ecdict-phonetic',
        pronunciation_source: 'deterministic:ecdict'
      };
    }
  }

  const pt = output?.localizations?.['pt-BR'];
  if (findPortuguesePronunciation && pt?.term) {
    const row = findPortuguesePronunciation.get(normalize(pt.term));
    const ipa = String(row?.ipa || '').trim();
    if (ipa && ipa.length <= 100) {
      output.localizations = { ...output.localizations };
      output.localizations['pt-BR'] = {
        ...pt,
        pronunciation: ipa,
        pronunciation_system: 'IPA',
        pronunciation_source: `deterministic:kaikki-pt-BR:${row.region}`
      };
    }
  }
}

function safeJsonObject(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function hasIpaSignal(value) {
  return /[\u0250-\u02AF\u1D00-\u1D7F\u1D80-\u1DBF]/u.test(String(value || ''));
}

function normalizeEcdictPhonetic(value, term) {
  let phonetic = String(value || '').normalize('NFKC').trim();
  if (!phonetic) return '';
  phonetic = phonetic
    .replace(/^\/|\/$/gu, '')
    .replace(/^\./u, 'ˌ')
    .replace(/[,']/gu, (mark) => mark === ',' ? 'ˌ' : 'ˈ')
    .replace(/ә/gu, 'ə')
    .replace(/:/gu, 'ː')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!/\s/u.test(String(term || '').trim())) phonetic = phonetic.replace(/\s+/gu, '');
  return phonetic ? `/${phonetic}/` : '';
}

function chineseReadingMatches(term, reading) {
  const value = String(term || '').trim();
  if (!/[\p{Script=Han}]/u.test(value)) return true;
  const actual = normalizeReading(reading);
  const symbol = normalizeReading(pinyin(value, { toneType: 'symbol', type: 'array', toneSandhi: false }).join(' '));
  const numbered = normalizeReading(pinyin(value, { toneType: 'num', type: 'array', toneSandhi: false }).join(' '));
  if (actual === symbol || actual === numbered) return true;
  const termValue = String(term || '').trim();
  return /[的地得]$/u.test(termValue) && actual.endsWith('de') && (symbol.endsWith('di') || numbered.endsWith('di4'));
}

function expectedChineseReadings(term) {
  const value = String(term || '').trim();
  if (!value || !/[\p{Script=Han}]/u.test(value)) return [];
  return [
    pinyin(value, { toneType: 'symbol', type: 'array', toneSandhi: false }).join(' '),
    pinyin(value, { toneType: 'num', type: 'array', toneSandhi: false }).join(' ')
  ];
}

function japaneseReadingMatches(term, reading) {
  return validateJapaneseReading(term, reading, true) === 'ok';
}

function validateJapaneseReading(term, reading, allowUnknownTerm) {
  const normalizedTerm = normalizeJapaneseReading(term);
  const normalizedReading = normalizeJapaneseReading(reading);
  if (!normalizedReading) return 'mismatch';
  if (kanaOnly(term)) return normalizedTerm === normalizedReading ? 'ok' : 'mismatch';
  if (!/[\p{Script=Han}]/u.test(String(term || ''))) return 'ok';
  const expected = lookupJapaneseReadings(String(term).trim());
  if (!expected?.size) return allowUnknownTerm ? 'ok' : 'unknown';
  return expected.has(normalizedReading) ? 'ok' : 'mismatch';
}

function expectedJapaneseReadings(term) {
  const value = String(term || '').trim();
  if (!value) return [];
  if (kanaOnly(value)) return [normalizeJapaneseReading(value)];
  return [...(lookupJapaneseReadings(value) || [])];
}

function lookupJapaneseReadings(term) {
  const direct = getJmdictReadingMap().get(term);
  if (direct?.size) return direct;
  const numberReadings = compositionalJapaneseNumberReadings(term);
  if (numberReadings?.size) return numberReadings;
  const canonicalTerm = JMDICT_CANONICAL_TERM_ALIASES.get(term);
  if (canonicalTerm) {
    const canonicalReadings = getJmdictReadingMap().get(canonicalTerm);
    if (canonicalReadings?.size) return canonicalReadings;
  }
  const compositionalReadings = VERIFIED_JAPANESE_COMPOSITIONAL_READINGS.get(term);
  if (compositionalReadings?.size) return compositionalReadings;
  const transparentCompoundReadings = transparentJapaneseCompoundReadings(
    term,
    (prefix) => getJmdictReadingMap().get(prefix)
  );
  if (transparentCompoundReadings?.size) return transparentCompoundReadings;
  const phraseReadings = compositionalJapanesePhraseReadings(
    term,
    (segment) => getJmdictReadingMap().get(segment)
  );
  if (phraseReadings?.size) return phraseReadings;
  for (const [suffix, suffixReading] of JMDICT_COMPOSITIONAL_SUFFIX_READINGS) {
    if (!term.endsWith(suffix) || term.length <= suffix.length) continue;
    const baseReadings = getJmdictReadingMap().get(term.slice(0, -suffix.length));
    if (baseReadings?.size) {
      return new Set([...baseReadings].map((reading) => `${reading}${suffixReading}`));
    }
  }
  const suffixes = ['する', 'した', 'して', 'の', 'に', 'な', 'と', 'が', 'を', 'へ'];
  for (const suffix of suffixes) {
    if (!term.endsWith(suffix) || term.length <= suffix.length) continue;
    const base = term.slice(0, -suffix.length);
    const baseReadings = getJmdictReadingMap().get(base);
    if (baseReadings?.size) {
      return new Set([...baseReadings].map((reading) => `${reading}${normalizeJapaneseReading(suffix)}`));
    }
  }
  return null;
}

function getJmdictReadingMap() {
  return jmdictReadingMap || new Map();
}

async function preloadJmdictReadingMap() {
  if (jmdictReadingMap) return jmdictReadingMap;
  const started = performance.now();
  jmdictReadingMap = new Map();
  const stream = fs.createReadStream(jmdictPath).pipe(zlib.createGunzip());
  let buffer = '';
  for await (const chunk of stream) {
    buffer += chunk.toString('utf8');
    while (true) {
      const start = buffer.indexOf('<entry>');
      if (start < 0) {
        buffer = buffer.slice(-32);
        break;
      }
      const end = buffer.indexOf('</entry>', start);
      if (end < 0) {
        if (start > 0) buffer = buffer.slice(start);
        break;
      }
      addJmdictEntryReadings(buffer.slice(start + 7, end));
      buffer = buffer.slice(end + 8);
    }
  }
  if (!quiet) console.log(`[jmdict] terms=${jmdictReadingMap.size} seconds=${secondsSince(started)}`);
  return jmdictReadingMap;
}

function addJmdictEntryReadings(entry) {
  const terms = [...entry.matchAll(/<keb>([\s\S]*?)<\/keb>/gu)].map((match) => decodeXml(match[1]).trim());
  if (!terms.length) return;
  for (const readingMatch of entry.matchAll(/<r_ele>([\s\S]*?)<\/r_ele>/gu)) {
    const block = readingMatch[1];
    const readingValue = block.match(/<reb>([\s\S]*?)<\/reb>/u);
    if (!readingValue) continue;
    const reading = normalizeJapaneseReading(decodeXml(readingValue[1]));
    const restrictions = [...block.matchAll(/<re_restr>([\s\S]*?)<\/re_restr>/gu)].map((match) =>
      decodeXml(match[1]).trim()
    );
    for (const term of restrictions.length ? restrictions : terms) {
      if (!terms.includes(term)) continue;
      if (!jmdictReadingMap.has(term)) jmdictReadingMap.set(term, new Set());
      jmdictReadingMap.get(term).add(reading);
    }
  }
}

function normalizeReading(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s'’·.-]+/gu, '');
}

function normalizeJapaneseReading(value) {
  return normalizeJapaneseKanaReading(value);
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'");
}

function knownSemanticMismatch(row, output) {
  const key = `${row.source_lang}|${normalize(row.word)}|${normalize(output.gloss_key || '')}`;
  const enTerm = normalize(output.localizations?.en?.term || '');
  const zhTerm = normalize(output.localizations?.zh?.term || '');
  const jaTerm = normalize(output.localizations?.ja?.term || '');
  const ptTerm = normalize(output.localizations?.['pt-BR']?.term || '');
  const word = normalize(row.word);

  if (row.source_lang === 'pt-BR' && ['acha', 'minutos', 'num'].includes(word)) {
    return 'known_semantic_mismatch_pt_residual';
  }
  if (
    row.source_lang === 'pt-BR' &&
    [
      'abra',
      'apesar',
      'aposto',
      'babaca',
      'branca',
      'conosco',
      'dos',
      'esse',
      'falo',
      'for',
      'indo',
      'irão',
      'leva',
      'levante',
      'maldita',
      'pega',
      'pego',
      'perca',
      'porra',
      'possa',
      'quer',
      'regras',
      'sai',
      'sei',
      'trata'
    ].includes(word)
  ) {
    return 'known_semantic_mismatch_pt_residual';
  }
  if (row.source_lang === 'zh' && ['听听', '总会', '出身'].includes(word)) {
    return 'known_semantic_mismatch_zh_residual';
  }
  if (row.source_lang === 'ja' && ['思', 'いま', 'ピーター'].includes(word)) {
    return 'known_semantic_mismatch_ja_residual';
  }
  if (row.source_lang === 'ja' && [...String(row.word || '').trim()].length === 1) {
    return 'known_semantic_mismatch_ja_single_character';
  }
  if (row.source_lang === 'ja' && ['っけ', '受け取', '忘れ', 'あいつ', 'クソ', 'アホ', 'いったい'].includes(word)) {
    return 'known_semantic_mismatch_ja_residual';
  }
  if (row.source_lang === 'zh' && ['說說', '布洛克', '新书', '要做', '樂部'].includes(word)) {
    return 'known_semantic_mismatch_zh_residual';
  }
  if (
    row.source_lang === 'ja' &&
    [
      'いく',
      'きみ',
      'たま',
      'ほんと',
      'やつ',
      'アーロン',
      'ウィル',
      'ウソ',
      'ウォルター',
      'ジェイソン',
      'ベイビー',
      '見張'
    ].includes(word)
  ) {
    return 'known_semantic_mismatch_ja_residual';
  }

  if (row.source_lang === 'pt-BR' && normalize(row.word) === 'seja') {
    if (enTerm === 'are' || zhTerm === '公亩' || jaTerm === 'アール') return 'known_semantic_mismatch_pt_seja_are';
  }
  if (row.source_lang === 'pt-BR' && normalize(row.word) === 'ama') {
    if (enTerm === 'lady' || zhTerm === '女士' || jaTerm === '女性') return 'known_semantic_mismatch_pt_ama_lady';
  }
  if (row.source_lang === 'ja' && normalize(row.word) === 'だめ') {
    if (enTerm === 'ruin' || enTerm === 'spoil' || zhTerm === '毁坏') return 'known_semantic_mismatch_ja_dame_ruin';
  }
  if (row.source_lang === 'ja' && normalize(row.word) === 'わけ') {
    if (enTerm === 'difficulty' || enTerm === 'obstacle' || zhTerm === '困难')
      return 'known_semantic_mismatch_ja_wake_difficulty';
  }
  if (
    key === 'pt-br|seja|are' ||
    key === 'pt-br|ama|lady' ||
    key === 'ja|だめ|ruin' ||
    key === 'ja|わけ|difficulty; obstacle'
  ) {
    return 'known_source_gap_semantic_mismatch';
  }
  return '';
}

function isBroadGlossKey(value) {
  const parts = String(value || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length >= 5;
}

function applyOutputs(items, stats) {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 30000');
  const now = new Date().toISOString();
  const writes = [];

  const statements = {
    getEntry: db.prepare('SELECT id, headword, primary_lang, status FROM product_entries WHERE group_key = ?'),
    insertEntry: db.prepare(`
      INSERT INTO product_entries
        (headword, normalized_key, primary_lang, frequency_rank, group_key, group_method, status, source_count, lang_count, created_at)
      VALUES
        (@headword, @normalized_key, @primary_lang, @frequency_rank, @group_key, 'source_gap_unsloth', @status, 1, 4, @created_at)
    `),
    getSense: db.prepare('SELECT id FROM product_senses WHERE product_entry_id = ? AND gloss_key = ? AND status = ?'),
    existingLocalizationsByEntry: db.prepare(`
      SELECT ps.id AS product_sense_id,
             ps.gloss_key,
             pl.lang,
             pl.term,
             pl.definition
      FROM product_senses ps
      JOIN product_localizations pl ON pl.product_sense_id = ps.id
      WHERE ps.product_entry_id = ?
        AND ps.status = 'accepted'
        AND COALESCE(pl.needs_review, 0) = 0
      ORDER BY ps.sense_order, ps.id, pl.lang
    `),
    getNextSenseOrder: db.prepare(`
      SELECT COALESCE(MAX(sense_order), 0) + 1 AS next_order
      FROM product_senses
      WHERE product_entry_id = ?
    `),
    insertSense: db.prepare(`
      INSERT INTO product_senses
        (product_entry_id, sense_order, part_of_speech, gloss_key, status, confidence, created_at)
      VALUES
        (@product_entry_id, @sense_order, @part_of_speech, @gloss_key, @status, 0.78, @created_at)
    `),
    upsertLocalization: db.prepare(`
      INSERT INTO product_localizations
        (product_sense_id, lang, term, reading, reading_system, pronunciation, pronunciation_system, definition, source, confidence, needs_review)
      VALUES
        (@product_sense_id, @lang, @term, @reading, @reading_system, @pronunciation, @pronunciation_system, @definition, @source, 0.78, @needs_review)
      ON CONFLICT(product_sense_id, lang) DO UPDATE SET
        term = excluded.term,
        reading = excluded.reading,
        reading_system = excluded.reading_system,
        pronunciation = excluded.pronunciation,
        pronunciation_system = excluded.pronunciation_system,
        definition = excluded.definition,
        source = excluded.source,
        confidence = excluded.confidence,
        needs_review = excluded.needs_review
    `),
    insertSourceLink: db.prepare(`
      INSERT OR IGNORE INTO product_sense_source_links
        (product_sense_id, source_entry_id, source_sense_id, source_lang, source_word, source_frequency_rank, match_method, confidence)
      VALUES
        (@product_sense_id, @source_entry_id, @source_sense_id, @source_lang, @source_word, @source_frequency_rank, 'source_gap_unsloth', 0.78)
    `),
    upsertExample: db.prepare(`
      INSERT INTO product_examples
        (product_sense_id, source_example_id, example_order, source_lang, source_text, source, confidence, needs_review)
      VALUES
        (@product_sense_id, @source_example_id, 1, 'zh', @source_text, @source, 0.78, @needs_review)
      ON CONFLICT(product_sense_id, source_example_id) DO UPDATE SET
        source_lang = excluded.source_lang,
        source_text = excluded.source_text,
        source = excluded.source,
        confidence = excluded.confidence,
        needs_review = excluded.needs_review
      RETURNING id
    `),
    upsertExampleLocalization: db.prepare(`
      INSERT INTO product_example_localizations
        (product_example_id, lang, text, reading, source, confidence, needs_review)
      VALUES
        (@product_example_id, @lang, @text, NULL, @source, 0.78, @needs_review)
      ON CONFLICT(product_example_id, lang) DO UPDATE SET
        text = excluded.text,
        reading = excluded.reading,
        source = excluded.source,
        confidence = excluded.confidence,
        needs_review = excluded.needs_review
    `)
  };

  db.transaction(() => {
    for (const item of items) {
      const baseGroupKey = `source-gap:${item.primary_lang}:${normalize(item.normalized_key || item.headword)}`;
      let groupKey = baseGroupKey;
      let existingEntry = statements.getEntry.get(groupKey);
      if (
        existingEntry &&
        (existingEntry.primary_lang !== item.primary_lang ||
          normalize(existingEntry.headword) !== normalize(item.headword) ||
          !['accepted', 'draft_single_source'].includes(existingEntry.status))
      ) {
        // Romanized normalized keys can collide for distinct CJK homophones
        // (for example Japanese 祈とう and 気筒 both becoming "kitou").
        // Keep the legacy key only when the headword and lifecycle are safe.
        // A historical needs-review entry must not make a newly reviewed sense
        // unpromotable, so isolate it with the stable source entry id as well.
        groupKey = `${baseGroupKey}:source-${item.source_entry_id}`;
        existingEntry = statements.getEntry.get(groupKey);
        if (
          existingEntry &&
          !['accepted', 'draft_single_source'].includes(existingEntry.status)
        ) {
          groupKey = `${groupKey}:sense-${item.source_sense_id}`;
          existingEntry = statements.getEntry.get(groupKey);
        }
      }
      let entryId = existingEntry?.id;
      if (entryId) {
        stats.entries_reused++;
      } else {
        entryId = Number(
          statements.insertEntry.run({
            headword: item.headword,
            normalized_key: normalize(item.normalized_key || item.headword),
            primary_lang: item.primary_lang,
            frequency_rank: item.frequency_rank ?? null,
            group_key: groupKey,
            status: appliedEntryStatus,
            created_at: now
          }).lastInsertRowid
        );
        stats.entries_inserted++;
      }

      // Draft candidates are already deduplicated by reviewed source-sense
      // identity. Reusing a draft by model-generated gloss can collapse distinct
      // senses whose concise English labels happen to be identical.
      let senseId = publishable
        ? statements.getSense.get(entryId, item.gloss_key, appliedSenseStatus)?.id
        : null;
      if (senseId) {
        stats.senses_reused++;
      } else {
        senseId = publishable
          ? findEquivalentSenseId(statements.existingLocalizationsByEntry.all(entryId), item)
          : null;
        if (senseId) {
          stats.senses_reused++;
        } else {
          const senseOrder = statements.getNextSenseOrder.get(entryId)?.next_order || 1;
          senseId = Number(
            statements.insertSense.run({
              product_entry_id: entryId,
              sense_order: senseOrder,
              part_of_speech: item.part_of_speech || null,
              gloss_key: item.gloss_key,
              status: appliedSenseStatus,
              created_at: now
            }).lastInsertRowid
          );
          stats.senses_inserted++;
        }
      }

      for (const lang of LANGS) {
        const loc = item.localizations[lang];
        statements.upsertLocalization.run({
          product_sense_id: senseId,
          lang,
          term: loc.term,
          reading: loc.reading || null,
          reading_system: loc.reading_system || null,
          pronunciation: loc.pronunciation || null,
          pronunciation_system: loc.pronunciation_system || null,
          definition: loc.definition,
          source: SOURCE,
          needs_review: appliedLocalizationNeedsReview
        });
        stats.localizations_upserted++;
      }
      if (item.example?.source_text && item.example?.localizations) {
        const sourceExampleId = -Math.abs(Number(item.source_sense_id || item.source_entry_id || senseId));
        const exampleId = Number(
          statements.upsertExample.get({
            product_sense_id: senseId,
            source_example_id: sourceExampleId,
            source_text: item.example.source_text,
            source: SOURCE,
            needs_review: appliedLocalizationNeedsReview
          }).id
        );
        stats.examples_upserted++;
        for (const lang of LANGS) {
          statements.upsertExampleLocalization.run({
            product_example_id: exampleId,
            lang,
            text: item.example.localizations[lang],
            source: SOURCE,
            needs_review: appliedLocalizationNeedsReview
          });
          stats.example_localizations_upserted++;
        }
      }
      if (item.source_entry_id && item.source_sense_id) {
        stats.source_links_upserted += statements.insertSourceLink.run({
          product_sense_id: senseId,
          source_entry_id: item.source_entry_id,
          source_sense_id: item.source_sense_id,
          source_lang: item.primary_lang,
          source_word: item.source_word || item.headword,
          source_frequency_rank: item.source_frequency_rank ?? item.frequency_rank ?? null
        }).changes;
      }
      writes.push({
        source_entry_id: item.source_entry_id,
        source_sense_id: item.source_sense_id || null,
        product_entry_id: entryId,
        product_sense_id: senseId
      });
    }
  })();
  db.close();
  return writes;
}

function candidateEligibility(row) {
  if (!row || !LANGS.includes(row.source_lang)) return { ok: false, reason: 'invalid_lang' };
  if (MANUAL_RESIDUAL_SOURCE_ENTRY_IDS.has(Number(row.source_entry_id))) {
    return { ok: false, reason: 'manual_source_gap_residual' };
  }
  const word = String(row.word || '').trim();
  if (!word) return { ok: false, reason: 'empty_word' };
  const groupKey = `source-gap:${row.source_lang}:${normalize(row.normalized_key || row.word)}`;
  const glossKey = row.first_gloss_key || row.first_gloss_preview || row.gloss_key || row.gloss_preview || '';
  if (row.first_sense_id && existingLinkedCompleteSense.get(row.first_sense_id)) {
    return { ok: false, reason: 'already_linked_complete_source_gap' };
  }
  if (skipExistingDrafts && row.first_sense_id && existingLinkedDraftOrCompleteSense.get(row.first_sense_id)) {
    return { ok: false, reason: 'already_linked_draft_or_complete_source_gap' };
  }
  if (glossKey && existingCompleteSense.get(groupKey, glossKey))
    return { ok: false, reason: 'already_complete_source_gap' };
  if (findAcceptedSemanticDuplicate(row, acceptedSemanticSenseIndex))
    return { ok: false, reason: 'already_complete_semantic_duplicate' };
  if (row.repairable_from_same_entry) return { ok: false, reason: 'deterministic_repair_available' };
  if (row.entry_level_four_lang_available) return { ok: false, reason: 'entry_level_four_lang_available' };
  if (!Boolean(glossKey)) return { ok: false, reason: 'missing_gloss' };
  const risk = riskReason(row);
  if (risk && !includeRisky) return { ok: false, reason: risk };
  return { ok: true, reason: '' };
}

function findEquivalentSenseId(rows, item) {
  if (!rows.length || !item?.localizations) return null;
  const bySense = new Map();
  for (const row of rows) {
    if (!bySense.has(row.product_sense_id)) bySense.set(row.product_sense_id, []);
    bySense.get(row.product_sense_id).push(row);
  }
  let best = null;
  for (const [senseId, localizations] of bySense) {
    let exactMatches = 0;
    let sourceLangMatches = false;
    let englishMatches = false;
    for (const existing of localizations) {
      const generated = item.localizations[existing.lang];
      if (!generated) continue;
      const same =
        normalizeLocalizationText(existing.term) === normalizeLocalizationText(generated.term) &&
        normalizeLocalizationText(existing.definition) === normalizeLocalizationText(generated.definition);
      if (!same) continue;
      exactMatches++;
      if (existing.lang === item.primary_lang) sourceLangMatches = true;
      if (existing.lang === 'en') englishMatches = true;
    }
    const strongDuplicate = exactMatches >= 2 || (exactMatches >= 1 && sourceLangMatches && englishMatches);
    if (!strongDuplicate) continue;
    if (!best || exactMatches > best.exactMatches) best = { senseId, exactMatches };
  }
  return best?.senseId || null;
}

function buildAcceptedSemanticSenseIndex(rows) {
  const bySense = new Map();
  for (const row of rows) {
    if (!bySense.has(row.product_sense_id)) bySense.set(row.product_sense_id, new Map());
    const byLang = bySense.get(row.product_sense_id);
    if (!byLang.has(row.lang)) byLang.set(row.lang, new Set());
    byLang.get(row.lang).add(normalizeLocalizationText(row.term));
  }
  const byTerm = new Map();
  for (const [senseId, byLang] of bySense) {
    for (const [lang, terms] of byLang) {
      for (const term of terms) {
        const key = `${lang}:${term}`;
        if (!byTerm.has(key)) byTerm.set(key, []);
        byTerm.get(key).push({ senseId, byLang });
      }
    }
  }
  return byTerm;
}

function findAcceptedSemanticDuplicate(row, index) {
  const sourceLang = row?.source_lang;
  const sourceTerm = normalizeLocalizationText(row?.word);
  if (!sourceLang || !sourceTerm) return null;
  const candidates = index.get(`${sourceLang}:${sourceTerm}`) || [];
  for (const candidate of candidates) {
    let otherLanguageMatches = 0;
    for (const [lang, hint] of Object.entries(row?.generation_hints || {})) {
      if (lang === sourceLang) continue;
      const existing = candidate.byLang.get(lang);
      if (!existing) continue;
      const terms = Array.isArray(hint?.terms) ? hint.terms : [];
      if (terms.some((term) => existing.has(normalizeLocalizationText(term)))) otherLanguageMatches += 1;
    }
    if (otherLanguageMatches >= 2) return candidate.senseId;
  }
  return null;
}

function riskReason(row) {
  const word = String(row.word || '').trim();
  const gloss = String(row.first_gloss_key || row.first_gloss_preview || row.gloss_key || row.gloss_preview || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
  const latinOnly = /^[\p{Script=Latin}\s.'’-]+$/u.test(word);
  if (row.source_lang === 'en' && normalize(word) === 'audible' && /\bfootball play\b/u.test(gloss)) {
    return 'known_source_term_residual';
  }
  if (row.source_lang === 'en' && normalize(word) === 'maneuver' && /\bmilitary training exercise\b/u.test(gloss)) {
    return 'known_source_term_residual';
  }
  if (
    row.source_lang === 'en' &&
    normalize(word) === 'allegedly' &&
    /\baccording to what has been alleged\b/u.test(gloss)
  ) {
    return 'known_source_term_residual';
  }
  if (row.source_lang === 'en' && normalize(word) === 'tram' && /\btravel by tram\b/u.test(gloss)) {
    return 'known_source_term_residual';
  }
  if (row.source_lang === 'en' && normalize(word) === 'minimal' && /\bleast possible\b/u.test(gloss)) {
    return 'known_source_term_residual';
  }
  if (row.source_lang === 'en' && /^[A-Za-z]$/u.test(word)) return 'latin_single_letter';
  if (row.source_lang === 'en' && /^[A-Z]{2,}$/u.test(word)) return 'latin_acronym';
  if (row.source_lang === 'en' && /^[A-Z][a-z]+(?:[- ][A-Z][a-z]+)*$/u.test(word)) {
    return 'english_capitalized_proper_like';
  }
  if (latinOnly && normalizeLatinLetters(word).length <= 2) return 'very_short_latin';
  if (/\b(letter of the roman alphabet|blood group|radioactive|unit used in printing)\b/u.test(gloss))
    return 'encyclopedic_or_symbol_gloss';
  if (/\bsurname\b/u.test(gloss) || /(?:女子名|男子名|人名)/u.test(gloss)) return 'surname_gloss';
  if (/^boa$/u.test(gloss)) return 'gloss_repeats_word';
  if (
    normalize(word) === normalize(gloss) &&
    !(
      row?.candidate_evidence_review?.decision === 'accept' &&
      Number(row.candidate_evidence_review.confidence) >= 0.9
    )
  ) {
    return 'gloss_repeats_word';
  }
  if (row.source_lang === 'en' && /\b(one's|possessive|demonstrative)\b/u.test(gloss)) {
    return 'possessive_or_demonstrative';
  }
  if (row.source_lang === 'pt-BR' && FUNCTION_GLOSSES.has(gloss)) return 'pt_function_word';
  if ((row.source_lang === 'zh' || row.source_lang === 'ja') && word.length === 1 && FUNCTION_GLOSSES.has(gloss))
    return 'single_cjk_function_word';
  return '';
}

function parseJson(content) {
  const text = String(content || '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error('content is not JSON');
  }
}

function readingLooksRight(value, lang) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (lang === 'zh')
    return /[\p{Script=Latin}\u0300-\u036f0-9]/u.test(text) && !/[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
  if (lang === 'ja') return /[\u3040-\u30ff]/u.test(text);
  return true;
}

function kanaOnly(value) {
  const text = String(value || '').trim();
  return Boolean(text) && /^[\u3040-\u30ff\s]+$/u.test(text);
}

function termLanguageLooksRight(value, lang) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (lang === 'zh') return /[\u3400-\u9fff]/u.test(text) && !/[\u3040-\u30ff]/u.test(text);
  if (lang === 'ja') return /[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
  if (lang === 'pt-BR') return /[\p{Script=Latin}]/u.test(text) && !/[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
  if (lang === 'en') return /[A-Za-z]/u.test(text) && !/[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
  return false;
}

function definitionLanguageLooksRight(value, lang) {
  return definitionContractLanguageLooksRight(value, lang);
}

function definitionTooThin(definition, lang, term) {
  const text = String(definition || '').trim();
  const termText = String(term || '').trim();
  if (!text) return true;
  if (normalize(text) === normalize(termText)) return true;
  if (lang === 'en' || lang === 'pt-BR') return text.length < 12;
  return text.length < 4;
}

function firstGlossToken(value) {
  const text = String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/^\(?one['’]s\)?\s+/u, '')
    .replace(/^the\s+/u, '');
  const match = text.match(/^[a-z][a-z -]{0,40}/u);
  return match ? match[0].trim() : '';
}

function englishGlossTermSet(row) {
  const terms = new Set();
  for (const reviewedTerm of [
    row?.candidate_evidence_review?.preferred_terms?.en,
    row?.candidate_evidence_review?.suggested_terms?.en
  ]) {
    for (const term of String(reviewedTerm || '').split(';')) {
      const token = firstGlossToken(term);
      if (token) terms.add(normalize(token));
    }
  }
  for (const reviewedTerm of row?.generation_hints?.en?.terms || []) {
    const token = firstGlossToken(reviewedTerm);
    if (token) terms.add(normalize(token));
  }
  const reviewedAnchor = String(row?.candidate_evidence_review?.english_anchor || '').trim();
  if (reviewedAnchor) {
    for (const term of reviewedAnchor.split(';')) {
      const token = firstGlossToken(term);
      if (token) terms.add(normalize(token));
    }
  }
  for (const evidence of row?.supplemental_evidence || []) {
    const gloss = String(evidence?.gloss || '').trim();
    if (!gloss) continue;
    for (const alternative of gloss.split(/[;,]/u)) {
      const token = firstGlossToken(alternative.replace(/\([^)]*\)/gu, ' ').trim());
      if (token) terms.add(normalize(token));
    }
  }
  const locs = Array.isArray(row?.first_sense_localizations) ? row.first_sense_localizations : [];
  const enLoc = locs.find((loc) => loc?.lang === 'en' && nonEmpty(loc.term));
  if (enLoc) {
    for (const term of String(enLoc.term).split(';')) {
      const token = firstGlossToken(term);
      if (token) terms.add(normalize(token));
    }
  }

  const text = String(row?.first_gloss_key || row?.first_gloss_preview || row?.gloss_key || row?.gloss_preview || '')
    .normalize('NFKC')
    .trim();
  const labeledEnglish = text.match(/\ben\s*:\s*([^|]+)/iu);
  const sourceText = labeledEnglish ? labeledEnglish[1] : text;
  for (const term of sourceText.split(';')) {
    const token = firstGlossToken(term);
    if (token) terms.add(normalize(token));
  }
  return terms;
}

function sourceMeaningAnchor(row) {
  const reviewedAnchor = String(row?.candidate_evidence_review?.english_anchor || '').trim();
  if (reviewedAnchor) return reviewedAnchor;
  const locs = Array.isArray(row?.first_sense_localizations) ? row.first_sense_localizations : [];
  const enLoc = locs.find((loc) => loc?.lang === 'en' && nonEmpty(loc.term));
  const primaryEnglishTerm = String(enLoc?.term || '')
    .split(';')[0]
    .trim();
  return (
    primaryEnglishTerm || row.first_gloss_key || row.first_gloss_preview || row.gloss_key || row.gloss_preview || ''
  );
}

function sourceMeaningAnchors(row) {
  const values = new Set();
  const add = (value) => {
    for (const item of String(value || '').split(/[;,/]|\bor\b/iu)) {
      const term = item.trim();
      if (term) values.add(term);
    }
  };
  add(sourceMeaningAnchor(row));
  for (const term of row?.generation_hints?.en?.terms || []) add(term);
  const enLoc = (Array.isArray(row?.first_sense_localizations) ? row.first_sense_localizations : []).find(
    (loc) => loc?.lang === 'en'
  );
  add(enLoc?.term);
  return [...values].slice(0, 8);
}

function termsShareContentToken(leftValues, rightValues) {
  const phrases = (values) =>
    values
      .map((value) =>
        String(value || '')
          .toLocaleLowerCase()
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/gu, '')
          .replace(/[^a-z]+/gu, ' ')
          .trim()
      )
      .filter(Boolean);
  const leftPhrases = phrases(leftValues);
  const rightPhrases = phrases(rightValues);
  if (
    leftPhrases.some((left) =>
      rightPhrases.some(
        (right) => left === right || (left.length >= 4 && right.length >= 4 && (left.includes(right) || right.includes(left)))
      )
    )
  ) {
    return true;
  }
  const tokens = (values) =>
    values.flatMap((value) =>
      String(value || '')
        .toLocaleLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/gu, '')
        .split(/[^a-z]+/u)
        .filter((token) => token.length >= 3)
    );
  const left = tokens(leftValues);
  const right = tokens(rightValues);
  return left.some((a) =>
    right.some((b) => a === b || (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4)))
  );
}

function normalizedPronunciation(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s/\[\]]+/gu, '')
    .trim();
}

function buildCheckpointConfig() {
  const reportBytes = fs.readFileSync(reportPath);
  const dbStat = fs.statSync(dbPath);
  const config = {
    db: path.relative(process.cwd(), dbPath),
    db_initial_size: dbStat.size,
    db_initial_mtime: dbStat.mtime.toISOString(),
    report: path.relative(process.cwd(), reportPath),
    report_sha256: crypto.createHash('sha256').update(reportBytes).digest('hex'),
    model,
    endpoints,
    gguf_variant: ggufVariant,
    endpoint_gguf_variants: endpointGgufVariants,
    prompt_mode: promptMode,
    minimal_request: minimalRequest,
    stream_response: streamResponse,
    chat_path: chatPath,
    disable_thinking: disableThinking,
    max_tokens: maxTokens,
    post_load_wait_ms: postLoadWaitMs,
    max_seq_length: maxSeqLength,
    speculative_type: speculativeType,
    require_evidence_verdict: requireEvidenceVerdict,
    enforce_reviewed_preferred_terms: enforceReviewedPreferredTerms,
    enforce_generation_hint_terms: enforceGenerationHintTerms,
    quality_review: qualityReview,
    quality_review_confidence: qualityReviewConfidence,
    quality_review_max_tokens: qualityReviewMaxTokens,
    defer_evidence_bound_quality_rejects: deferEvidenceBoundQualityRejects,
    pronunciation_review: pronunciationReview,
    pronunciation_review_max_tokens: pronunciationReviewMaxTokens,
    pronunciation_repair: pronunciationRepair,
    pronunciation_repair_max_tokens: pronunciationRepairMaxTokens,
    deterministic_readings: deterministicReadings,
    jmdict: deterministicReadings && fs.existsSync(jmdictPath) ? path.relative(process.cwd(), jmdictPath) : null,
    deterministic_pronunciations: deterministicPronunciations,
    source_db:
      deterministicPronunciations && fs.existsSync(sourceDbPath) ? path.relative(process.cwd(), sourceDbPath) : null,
    pt_pronunciation_db:
      deterministicPronunciations && fs.existsSync(ptPronunciationDbPath)
        ? path.relative(process.cwd(), ptPronunciationDbPath)
        : null,
    publishable,
    apply,
    dry_run: dryRun,
    force_reload: forceReload,
    circuit_breaker_reset_ms: circuitBreakerResetMs,
    endpoint_cooldown_ms: endpointCooldownMs
  };
  config.signature = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        db: config.db,
        report_sha256: config.report_sha256,
        model: config.model,
        endpoints: config.endpoints,
        gguf_variant: config.gguf_variant,
        endpoint_gguf_variants: config.endpoint_gguf_variants,
        prompt_mode: config.prompt_mode,
        minimal_request: config.minimal_request,
        stream_response: config.stream_response,
        disable_thinking: config.disable_thinking,
        max_tokens: config.max_tokens,
        post_load_wait_ms: config.post_load_wait_ms,
        max_seq_length: config.max_seq_length,
        speculative_type: config.speculative_type,
        require_evidence_verdict: config.require_evidence_verdict,
        quality_review: config.quality_review,
        quality_review_confidence: config.quality_review_confidence,
        quality_review_max_tokens: config.quality_review_max_tokens,
        defer_evidence_bound_quality_rejects: config.defer_evidence_bound_quality_rejects,
        pronunciation_review: config.pronunciation_review,
        pronunciation_review_max_tokens: config.pronunciation_review_max_tokens,
        pronunciation_repair: config.pronunciation_repair,
        pronunciation_repair_max_tokens: config.pronunciation_repair_max_tokens,
        deterministic_readings: config.deterministic_readings,
        jmdict: config.jmdict,
        deterministic_pronunciations: config.deterministic_pronunciations,
        source_db: config.source_db,
        pt_pronunciation_db: config.pt_pronunciation_db,
        publishable: config.publishable,
        apply: config.apply,
        dry_run: config.dry_run,
        force_reload: config.force_reload,
        circuit_breaker_reset_ms: config.circuit_breaker_reset_ms,
        endpoint_cooldown_ms: config.endpoint_cooldown_ms
      })
    )
    .digest('hex');
  return config;
}

function loadCheckpoint() {
  if (!checkpointPath) return null;
  if (!fs.existsSync(checkpointPath)) {
    return {
      version: 1,
      run_id: `${dateStamp()}-${crypto.randomUUID()}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      config: checkpointConfig,
      items: {},
      summary: { pending: 0, completed: 0, accepted: 0, rejected: 0 }
    };
  }
  if (!resume) throw new Error(`Checkpoint already exists; pass --resume true or choose a new path: ${checkpointPath}`);
  const loaded = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
  if (loaded?.config?.signature !== checkpointConfig.signature) {
    if (!allowEndpointChangeOnResume || !endpointChangeIsCompatible(loaded.config, checkpointConfig)) {
      throw new Error('Checkpoint configuration does not match the current DB/report/model/endpoints');
    }
    loaded.endpoint_migrations = [
      ...(loaded.endpoint_migrations || []),
      {
        changed_at: new Date().toISOString(),
        from_endpoints: loaded.config.endpoints,
        to_endpoints: checkpointConfig.endpoints,
        from_endpoint_gguf_variants: loaded.config.endpoint_gguf_variants,
        to_endpoint_gguf_variants: checkpointConfig.endpoint_gguf_variants
      }
    ];
    loaded.config = checkpointConfig;
    writeJsonAtomically(checkpointPath, loaded);
  }
  return loaded;
}

function endpointChangeIsCompatible(previousConfig, nextConfig) {
  if (!previousConfig || !nextConfig) return false;
  const ignored = new Set([
    'signature',
    'endpoints',
    'endpoint_gguf_variants',
    'db_initial_size',
    'db_initial_mtime'
  ]);
  const stableConfig = (value) =>
    Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !ignored.has(key))
        .sort(([left], [right]) => left.localeCompare(right))
    );
  return JSON.stringify(stableConfig(previousConfig)) === JSON.stringify(stableConfig(nextConfig));
}

function updateCheckpoint(state, generatedItems, writes, runStats, committedChunks, totalChunks) {
  if (!checkpointPath || !state) return;
  const writesBySource = new Map(writes.map((item) => [checkpointCandidateKey(item), item]));
  for (const item of generatedItems) {
    const itemKey = checkpointCandidateKey(item);
    const write = writesBySource.get(itemKey);
    state.items[itemKey] = {
      source_entry_id: item.source_entry_id,
      source_sense_id: Number(item?.source_sense_id ?? item?.output?.source_sense_id) || null,
      word: item.word,
      source_lang: item.source_lang,
      status: item.valid ? 'accepted' : 'rejected',
      endpoint: item.endpoint,
      attempts: item.attempts || 1,
      seconds: item.seconds,
      infrastructure_failure: Boolean(item.infrastructure_failure),
      errors: item.errors || [],
      product_entry_id: write?.product_entry_id || null,
      product_sense_id: write?.product_sense_id || null,
      promote_allowed: !noPromoteSourceEntryIds.has(String(item.source_entry_id)),
      generated_item: item,
      completed_at: new Date().toISOString()
    };
  }
  const items = Object.values(state.items);
  state.updated_at = new Date().toISOString();
  state.last_successful_commit_at = state.updated_at;
  state.summary = {
    selected: runStats.planned_total,
    pending: Math.max(0, runStats.planned_total - items.length),
    completed: items.length,
    accepted: items.filter((item) => item.status === 'accepted').length,
    rejected: items.filter((item) => item.status === 'rejected').length,
    chunks_committed: committedChunks,
    chunks_total: totalChunks,
    endpoint_metrics: runStats.endpoint_metrics
  };
  writeJsonAtomically(checkpointPath, state);
}

function checkpointCandidateKey(value) {
  const sourceEntryId = Number(value?.source_entry_id);
  const sourceSenseId = Number(value?.source_sense_id ?? value?.first_sense_id ?? value?.output?.source_sense_id);
  return `${sourceEntryId}:${Number.isInteger(sourceSenseId) ? sourceSenseId : 'none'}`;
}

function writeJsonAtomically(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8');
  fs.rmSync(filePath, { force: true });
  fs.renameSync(tempPath, filePath);
}

function serializeEndpointMetrics(source) {
  return Object.fromEntries(
    [...source.entries()].map(([endpoint, metrics]) => [
      endpoint,
      {
        calls: Number(metrics.calls || 0),
        failures: Number(metrics.failures || 0),
        consecutive_failures: Number(metrics.consecutiveFailures || 0),
        open: Boolean(metrics.open),
        open_until: metrics.openUntil ? new Date(metrics.openUntil).toISOString() : null,
        recoveries: Number(metrics.recoveries || 0)
      }
    ])
  );
}

function dateStamp() {
  return new Date()
    .toISOString()
    .replace(/[-:TZ.]/gu, '')
    .slice(0, 14);
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function buildWorkerSlots(rowCount, batchCount) {
  const slots = [];
  if (endpointConcurrency) {
    for (const endpoint of endpoints) {
      const count = endpointConcurrency[endpoint] || 0;
      for (let index = 0; index < count; index++) slots.push(endpoint);
    }
  } else {
    const workerCount = Math.min(concurrency, batchCount || Math.ceil(rowCount / batchSize) || 1);
    for (let index = 0; index < workerCount; index++) slots.push(endpoints[index % endpoints.length]);
  }
  return slots.length ? slots : [endpoints[0]];
}

function parseEndpointConcurrency(value, endpointList) {
  if (!value) return null;
  const byEndpoint = Object.fromEntries(endpointList.map((endpoint) => [endpoint, 0]));
  for (const part of String(value).split(',')) {
    const [rawKey, rawCount] = part.split('=');
    const key = String(rawKey || '').trim();
    const count = Number(rawCount);
    if (!key || !Number.isInteger(count) || count < 0) {
      throw new Error(`Invalid --endpoint-concurrency item: ${part}`);
    }
    const endpoint = endpointList.find((candidate) => {
      const url = new URL(candidate);
      return candidate === key || `${url.hostname}:${url.port}` === key || url.port === key;
    });
    if (!endpoint) throw new Error(`Unknown endpoint in --endpoint-concurrency: ${key}`);
    byEndpoint[endpoint] = count;
  }
  return byEndpoint;
}

function parseEndpointStringMap(value, endpointList, optionName) {
  if (!value) return null;
  const byEndpoint = {};
  for (const part of String(value).split(',')) {
    const separator = part.indexOf('=');
    const key = separator >= 0 ? part.slice(0, separator).trim() : '';
    const mappedValue = separator >= 0 ? part.slice(separator + 1).trim() : '';
    if (!key || !mappedValue) throw new Error(`Invalid --${optionName} item: ${part}`);
    const endpoint = endpointList.find((candidate) => {
      const url = new URL(candidate);
      return candidate === key || `${url.hostname}:${url.port}` === key || url.port === key;
    });
    if (!endpoint) throw new Error(`Unknown endpoint in --${optionName}: ${key}`);
    byEndpoint[endpoint] = mappedValue;
  }
  return byEndpoint;
}

function parseSourceLangFilter(value) {
  if (!value) return null;
  const langs = String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  for (const lang of langs) {
    if (!LANGS.includes(lang)) throw new Error(`Invalid --source-langs value: ${lang}`);
  }
  return new Set(langs);
}

function parseIntegerSet(value, optionName) {
  if (!value) return null;
  const values = String(value)
    .split(',')
    .map((item) => Number(item.trim()));
  if (!values.length || values.some((item) => !Number.isInteger(item) || item < 1)) {
    throw new Error(`Invalid --${optionName}: ${value}`);
  }
  return new Set(values);
}

function normalizeSpeculativeType(value) {
  const normalized = String(value || 'mtp')
    .trim()
    .toLowerCase();
  if (normalized === 'none' || normalized === 'disabled') return 'off';
  const aliases = new Map([
    ['default', 'auto'],
    ['draft-mtp', 'mtp'],
    ['ngram-mod', 'ngram']
  ]);
  const canonical = aliases.get(normalized) || normalized;
  if (!['auto', 'mtp', 'ngram', 'mtp+ngram', 'off', 'ngram-simple'].includes(canonical)) {
    throw new Error(`Invalid --speculative-type: ${value}`);
  }
  return canonical;
}

function normalizeChatPath(value) {
  const normalized = String(value || '').trim();
  if (!normalized.startsWith('/') || normalized.includes('://') || normalized.includes('..')) {
    throw new Error(`Invalid --chat-path: ${value}`);
  }
  return normalized;
}

function chunkRows(rows, size) {
  const batches = [];
  for (let index = 0; index < rows.length; index += size) {
    batches.push(
      rows.slice(index, index + size).map((row, offset) => ({
        ...row,
        __selected_index: index + offset
      }))
    );
  }
  return batches;
}

function compactGeneratedItem(item) {
  return {
    source_entry_id: item.source_entry_id,
    word: item.word,
    source_lang: item.source_lang,
    frequency_rank: item.frequency_rank,
    endpoint: item.endpoint,
    worker: item.worker,
    batch_size: item.batch_size,
    seconds: item.seconds,
    batch_seconds: item.batch_seconds,
    valid: item.valid,
    errors: item.errors
  };
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase();
}

function normalizeLocalizationText(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase();
}

function normalizeLatinLetters(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/gu, '');
}

function secondsSince(started) {
  return Number(((performance.now() - started) / 1000).toFixed(2));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error) {
  const base = `${error?.name || 'Error'}: ${error?.message || String(error)}`;
  const cause = error?.cause;
  if (!cause) return base;
  const details = [cause.code, cause.message].filter(Boolean).join(' ');
  return details ? `${base} (${details})` : base;
}

function isRecoverableModelLoadError(error) {
  return /No model loaded|Call POST \/inference\/load first|Call POST \/v1\/load first/u.test(errorMessage(error));
}

function isRecoverableGenerationError(error) {
  return isOutputFormatErrorMessage(errorMessage(error));
}

function isOutputFormatErrorMessage(value) {
  return /content is not JSON|batch content missing items array|Unexpected token|Expected ',' or '\]'|unterminated string|JSON/iu.test(
    String(value || '')
  );
}

function isInfrastructureGenerationError(error) {
  const message = errorMessage(error);
  if (isRecoverableGenerationError(error) || error instanceof SyntaxError) return false;
  return /AbortError|TimeoutError|timed out|fetch failed|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|UND_ERR_|socket|HTTP (?:429|5\d\d)\b|No model loaded|Call POST \/(?:inference|v1)\/load first|Model did not become ready/iu.test(
    message
  );
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const keyName = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) result[keyName] = 'true';
    else {
      result[keyName] = next;
      index++;
    }
  }
  return result;
}
