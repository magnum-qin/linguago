import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as OpenCC from 'opencc-js';

const LANGS = ['en', 'pt-BR', 'zh', 'ja'];
const DEFAULT_DB = 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const DEFAULT_SOURCE_PREFIX = 'unsloth:source-gap-supplement';
const STOP_TOKENS = new Set(['and', 'are', 'for', 'from', 'into', 'the', 'with']);
const HTML_ENTITY_RE = /&(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#[0-9]{1,7}|#x[0-9a-fA-F]{1,6});/u;
const LATIN1_MOJIBAKE_RE = /(?:\u00c3[\u0080-\u00bf]|\u00c2[\u0080-\u00bf]|\u00e2[\u0080-\u00bf]{1,2})/u;
const traditionalToSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });
const TRADITIONAL_SMOKE_RE = /[這個們來說時還後發聽與對會裡學開關體]/u;

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const apply = args.apply === 'true' || args.apply === true;
const limit = boundedNumber(args.limit, 500);
const sourcePrefix = String(args.source || DEFAULT_SOURCE_PREFIX);
const checkpointPath = args.checkpoint ? path.resolve(args.checkpoint) : null;
const reportPath = args.report ? path.resolve(args.report) : null;
const restrictToReport = args['restrict-to-report'] === 'true';
const semanticReviewPath = args['semantic-review'] ? path.resolve(args['semantic-review']) : null;
const reverseEvidencePath = args['reverse-evidence'] ? path.resolve(args['reverse-evidence']) : null;
const semanticReviewConfidence = boundedConfidence(args['semantic-review-confidence'], 0.9);
const verificationLevel = String(args['verification-level'] || 'verified').trim();
const requireExamples = args['require-examples'] === 'true';
if (!['verified', 'ai_reviewed'].includes(verificationLevel)) {
  throw new Error(`Invalid --verification-level: ${verificationLevel}`);
}
if (verificationLevel === 'ai_reviewed' && !semanticReviewPath) {
  throw new Error('--verification-level ai_reviewed requires --semantic-review');
}
const reviewModel = String(args['review-model'] || (verificationLevel === 'ai_reviewed' ? 'gemma-independent-review' : '')).trim() || null;
const evidenceFamilies = [...new Set(String(args['evidence-families'] || '')
  .split(',').map((value) => value.trim()).filter(Boolean))].sort();
const semanticReviewExcludedSenseIds = new Set(
  String(args['semantic-review-exclude-sense-ids'] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isInteger)
);
const outPath = path.resolve(
  args.out || `logs/product-source-gap-draft-promote-${apply ? 'apply' : 'dry-run'}-${dateStamp()}.json`
);

if (!fs.existsSync(dbPath)) throw new Error(`Product DB not found: ${dbPath}`);
if (checkpointPath && !fs.existsSync(checkpointPath)) throw new Error(`Checkpoint not found: ${checkpointPath}`);
if (reportPath && !fs.existsSync(reportPath)) throw new Error(`Coverage report not found: ${reportPath}`);
if (restrictToReport && !reportPath) throw new Error('--restrict-to-report requires --report');
if (semanticReviewPath && !fs.existsSync(semanticReviewPath)) {
  throw new Error(`Semantic review not found: ${semanticReviewPath}`);
}
if (reverseEvidencePath && !fs.existsSync(reverseEvidencePath)) {
  throw new Error(`Reverse-evidence report not found: ${reverseEvidencePath}`);
}

const checkpointSenseIds = checkpointPath ? loadCheckpointSenseIds(checkpointPath) : [];
const checkpointSourceBySense = checkpointPath ? loadCheckpointSourceBySense(checkpointPath) : new Map();
const checkpointProductSenseBySourceSense = checkpointPath
  ? loadCheckpointProductSenseBySourceSense(checkpointPath)
  : new Map();
const productSenseBySourceSense = checkpointProductSenseBySourceSense.size
  ? checkpointProductSenseBySourceSense
  : loadProductSenseBySourceSense(dbPath);
const reportGlossBySource = reportPath ? loadReportGlosses(reportPath) : new Map();
const reportSourceSenseIds = reportPath ? loadReportSourceSenseIds(reportPath) : [];
const allowAcceptedEntryAdditionalSenses =
  restrictToReport && reportPath ? reportContainsAdditionalSenseLane(reportPath) : false;
if (restrictToReport && !reportSourceSenseIds.length) {
  throw new Error('Restricted coverage report has no source sense IDs');
}
const semanticApprovals = semanticReviewPath
  ? loadSemanticApprovals(
      semanticReviewPath,
      semanticReviewConfidence,
      productSenseBySourceSense
    )
  : new Map();
const reverseEvidenceApprovals = reverseEvidencePath ? loadReverseEvidenceApprovals(reverseEvidencePath) : null;
const checkpointClause = checkpointPath
  ? `AND ps.id IN (${checkpointSenseIds.length ? checkpointSenseIds.map((_, index) => `@checkpoint_${index}`).join(', ') : 'NULL'})`
  : '';
const reportClause = restrictToReport
  ? `AND EXISTS (
      SELECT 1
      FROM product_sense_source_links restricted_link
      WHERE restricted_link.product_sense_id = ps.id
        AND restricted_link.source_sense_id IN (${reportSourceSenseIds
          .map((_, index) => `@report_sense_${index}`)
          .join(', ')})
    )`
  : '';

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000');
if (apply) ensureVerificationSchema(db);

const candidateSourceSenseIds = db.prepare(`
  SELECT source_sense_id
  FROM product_sense_source_links
  WHERE product_sense_id = ?
    AND source_sense_id IS NOT NULL
`);

const candidates = db
  .prepare(
    `
    SELECT DISTINCT
      pe.id AS entry_id,
      pe.headword,
      pe.normalized_key,
      pe.primary_lang,
      pe.frequency_rank,
      pe.status AS entry_status,
      ps.id AS sense_id,
      ps.sense_order,
      ps.part_of_speech,
      ps.gloss_key,
      ps.status AS sense_status,
      ps.confidence
    FROM product_entries pe
    JOIN product_senses ps ON ps.product_entry_id = pe.id
    JOIN product_localizations pl ON pl.product_sense_id = ps.id
    WHERE (
        pe.group_method = 'source_gap_unsloth'
        OR (@allowAcceptedEntryAdditionalSenses = 1 AND pe.status = 'accepted')
      )
      AND ps.status = 'draft_single_source'
      AND pl.source LIKE @sourcePrefix
      ${checkpointClause}
      ${reportClause}
    ORDER BY pe.frequency_rank IS NULL, pe.frequency_rank, pe.id, ps.sense_order, ps.id
    LIMIT @queryLimit
  `
  )
  .all({
    sourcePrefix: `${sourcePrefix}%`,
    allowAcceptedEntryAdditionalSenses: allowAcceptedEntryAdditionalSenses ? 1 : 0,
    queryLimit: reverseEvidenceApprovals || semanticReviewPath ? 100000 : limit,
    ...Object.fromEntries(checkpointSenseIds.map((id, index) => [`checkpoint_${index}`, id])),
    ...Object.fromEntries(reportSourceSenseIds.map((id, index) => [`report_sense_${index}`, id]))
  })
  .map((candidate) => {
    const sourceEntryId = checkpointSourceBySense.get(Number(candidate.sense_id)) || null;
    const sourceGloss = sourceEntryId ? reportGlossBySource.get(sourceEntryId) : null;
    const effectiveGlossKey =
      sourceGloss && (!isBroadGlossKey(sourceGloss) || isBroadGlossKey(candidate.gloss_key))
        ? sourceGloss
        : candidate.gloss_key;
    return {
      ...candidate,
      source_entry_id: sourceEntryId,
      effective_gloss_key: effectiveGlossKey
    };
  })
  .filter((candidate) => {
    if (!reverseEvidenceApprovals) return true;
    const sourceSenseIds = candidateSourceSenseIds
      .all(candidate.sense_id)
      .map((row) => Number(row.source_sense_id))
      .filter(Number.isInteger);
    return sourceSenseIds.some((id) => reverseEvidenceApprovals.has(id));
  })
  .filter((candidate) => !semanticReviewPath || semanticApprovals.has(Number(candidate.sense_id)))
  .slice(0, limit);

const localizationStmt = db.prepare(`
  SELECT lang, term, reading, reading_system, pronunciation, pronunciation_system, definition, source, confidence, needs_review
  FROM product_localizations
  WHERE product_sense_id = ?
  ORDER BY lang
`);
const sourceLinkStmt = db.prepare(`
  SELECT source_lang, source_word, source_sense_id, source_frequency_rank, match_method
  FROM product_sense_source_links
  WHERE product_sense_id = ?
  ORDER BY id
`);
const exampleStmt = db.prepare(`
  SELECT id, source_lang, source_text, needs_review
  FROM product_examples
  WHERE product_sense_id = ?
  ORDER BY example_order, id
`);
const exampleLocalizationStmt = db.prepare(`
  SELECT lang, text, reading, needs_review
  FROM product_example_localizations
  WHERE product_example_id = ?
  ORDER BY lang
`);

const reviewed = candidates.map((candidate) => applySemanticApproval(validateCandidate(candidate)));
const accepted = reviewed.filter((item) => item.valid);
const rejected = reviewed.filter((item) => !item.valid);

const stats = {
  db: path.relative(process.cwd(), dbPath),
  apply,
  source_prefix: sourcePrefix,
  allow_accepted_entry_additional_senses: allowAcceptedEntryAdditionalSenses,
  checkpoint: checkpointPath ? path.relative(process.cwd(), checkpointPath) : null,
  report: reportPath ? path.relative(process.cwd(), reportPath) : null,
  restrict_to_report: restrictToReport,
  report_source_sense_ids: reportSourceSenseIds.length,
  semantic_review: semanticReviewPath ? path.relative(process.cwd(), semanticReviewPath) : null,
  reverse_evidence: reverseEvidencePath ? path.relative(process.cwd(), reverseEvidencePath) : null,
  reverse_evidence_approvals_loaded: reverseEvidenceApprovals?.size || 0,
  semantic_review_confidence: semanticReviewConfidence,
  verification_level: verificationLevel,
  require_examples: requireExamples,
  review_model: reviewModel,
  evidence_families: evidenceFamilies,
  semantic_review_excluded_sense_ids: [...semanticReviewExcludedSenseIds],
  semantic_approvals_loaded: semanticApprovals.size,
  checkpoint_sense_ids: checkpointSenseIds.length,
  scanned: candidates.length,
  accepted: accepted.length,
  rejected: rejected.length,
  rejected_by_reason: countBy(rejected.flatMap((item) => item.errors)),
  localizations_promoted: 0,
  examples_promoted: 0,
  example_localizations_promoted: 0,
  senses_promoted: 0,
  entries_promoted: 0,
  entries_refreshed: 0
};

if (apply && accepted.length) applyPromotions(accepted, stats);

const output = {
  ok: rejected.length === 0,
  generated_at: new Date().toISOString(),
  stats,
  accepted_sense_ids: accepted.map((item) => Number(item.candidate.sense_id)),
  accepted_preview: accepted.slice(0, 50).map(compactReviewed),
  rejected: rejected.map(compactReviewed)
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
console.log(JSON.stringify({ ok: output.ok, out: path.relative(process.cwd(), outPath), stats }, null, 2));

db.close();

function loadCheckpointSenseIds(filePath) {
  const checkpoint = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return [
    ...new Set(
      checkpointItems(checkpoint)
        .filter((item) => item?.status === 'accepted' && Number.isInteger(Number(item?.product_sense_id)))
        .map((item) => Number(item.product_sense_id))
    )
  ];
}

function loadCheckpointSourceBySense(filePath) {
  const checkpoint = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return new Map(
    checkpointItems(checkpoint)
      .filter(
        (item) => Number.isInteger(Number(item?.product_sense_id)) && Number.isInteger(Number(item?.source_entry_id))
      )
      .map((item) => [Number(item.product_sense_id), Number(item.source_entry_id)])
  );
}

function loadCheckpointProductSenseBySourceSense(filePath) {
  const checkpoint = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return new Map(
    checkpointItems(checkpoint)
      .filter(
        (item) =>
          Number.isInteger(Number(item?.product_sense_id)) &&
          Number.isInteger(Number(item?.source_entry_id)) &&
          Number.isInteger(Number(item?.source_sense_id))
      )
      .map((item) => [
        `${Number(item.source_entry_id)}:${Number(item.source_sense_id)}`,
        Number(item.product_sense_id)
      ])
  );
}

function checkpointItems(checkpoint) {
  const items = Object.values(checkpoint?.items || {});
  const writes = Array.isArray(checkpoint?.writes)
    ? checkpoint.writes.map((item) => ({ ...item, status: item?.status || 'accepted' }))
    : [];
  return [...items, ...writes];
}

function loadReportGlosses(filePath) {
  const report = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const generatedRows = Array.isArray(report?.generated) ? report.generated : [];
  const rows = report?.selected || report?.residuals || generatedRows;
  const generatedGlosses = new Map(
    generatedRows
      .filter(
        (row) =>
          row?.valid === true &&
          Number.isInteger(Number(row?.source_entry_id)) &&
          String(row?.output?.gloss_key || '').trim()
      )
      .map((row) => [Number(row.source_entry_id), String(row.output.gloss_key).trim()])
  );
  return new Map(rows.map((row) => {
    const sourceEntryId = Number(row.source_entry_id);
    return [
      sourceEntryId,
      generatedGlosses.get(sourceEntryId) ||
        String(
          row?.output?.gloss_key ||
          row.first_gloss_key ||
          row.gloss_key ||
          row.first_gloss_preview ||
          row.gloss_preview ||
          ''
        ).trim()
    ];
  }));
}

function loadReportSourceSenseIds(filePath) {
  const report = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const rows = report?.selected || report?.residuals || report?.generated || [];
  return [
    ...new Set(
      rows
        .map((row) => Number(row?.first_sense_id ?? row?.source_sense_id ?? row?.output?.source_sense_id))
        .filter(Number.isInteger)
    )
  ];
}

function reportContainsAdditionalSenseLane(filePath) {
  const report = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const rows = report?.selected || report?.residuals || report?.generated || [];
  return rows.some(
    (row) =>
      row?.candidate_lane === 'additional_unlinked_source_sense' &&
      Number.isInteger(Number(row?.product_entry_id)) &&
      Number.isInteger(Number(row?.first_sense_id ?? row?.source_sense_id ?? row?.output?.source_sense_id))
  );
}

function loadSemanticApprovals(filePath, confidenceThreshold, productSenseBySourceSense) {
  const review = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const approvals = new Map();
  const consensusPolicySafe =
    review?.policy?.independent_model_families === true &&
    review?.policy?.automatic_promotion === false;

  for (const row of review.reviews || []) {
    if (row?.valid !== true || Number(row?.confidence) < confidenceThreshold) continue;
    if (Array.isArray(row?.risk_flags) && row.risk_flags.length) continue;

    if (row?.decision === 'accept_synonym' && Number.isInteger(Number(row?.sense_id))) {
      const productSenseId = Number(row.sense_id);
      if (!semanticReviewExcludedSenseIds.has(productSenseId)) {
        approvals.set(productSenseId, row);
      }
      continue;
    }

    if (
      !consensusPolicySafe ||
      row?.decision !== 'accept' ||
      row?.consensus_accepted !== true ||
      !Array.isArray(row?.corrections) ||
      row.corrections.length !== 0
    ) {
      continue;
    }
    const sourceKey = `${Number(row?.source_entry_id)}:${Number(row?.source_sense_id)}`;
    const productSenseId = productSenseBySourceSense.get(sourceKey);
    if (
      Number.isInteger(productSenseId) &&
      !semanticReviewExcludedSenseIds.has(productSenseId)
    ) {
      approvals.set(productSenseId, row);
    }
  }
  return approvals;
}

function loadProductSenseBySourceSense(filePath) {
  const lookupDb = new Database(filePath, { readonly: true, fileMustExist: true });
  lookupDb.pragma('query_only = ON');
  const rows = lookupDb.prepare(`
    SELECT pssl.source_entry_id, pssl.source_sense_id, pssl.product_sense_id
    FROM product_sense_source_links pssl
    WHERE pssl.source_entry_id IS NOT NULL
      AND pssl.source_sense_id IS NOT NULL
  `).all();
  lookupDb.close();
  return new Map(
    rows.map((row) => [
      `${Number(row.source_entry_id)}:${Number(row.source_sense_id)}`,
      Number(row.product_sense_id)
    ])
  );
}

function loadReverseEvidenceApprovals(filePath) {
  const review = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const approvals = (review.validations || [])
    .filter(
      (row) =>
        row?.generation_valid === true &&
        row?.decision === 'supported' &&
        Number.isInteger(Number(row?.source_sense_id))
    )
    .map((row) => [Number(row.source_sense_id), row]);
  if (!approvals.length) {
    throw new Error('Reverse-evidence report contains no supported source_sense_id rows.');
  }
  return new Map(approvals);
}

function applySemanticApproval(item) {
  const approval = semanticApprovals.get(Number(item.candidate.sense_id));
  if (!approval) return item;
  // Broad glosses still require sense splitting even when their generated translations are semantically coherent.
  const overridable = new Set(['semantic_drift_en_term_gloss_mismatch']);
  const errors = item.errors.filter((error) => !overridable.has(error));
  return {
    ...item,
    valid: errors.length === 0,
    errors,
    semantic_review: {
      decision: approval.decision,
      confidence: approval.confidence,
      reason: approval.reason
    }
  };
}

function validateCandidate(candidate) {
  const localizations = localizationStmt.all(candidate.sense_id);
  const sourceLinks = sourceLinkStmt.all(candidate.sense_id);
  const locMap = Object.fromEntries(localizations.map((loc) => [loc.lang, loc]));
  const errors = [];

  // Promoting one reviewed sense can temporarily leave the shared entry in
  // needs_review while independently reviewed sibling drafts remain pending.
  if (!['draft_single_source', 'needs_review', 'accepted'].includes(candidate.entry_status)) {
    errors.push('entry_not_promotable');
  }
  if (candidate.sense_status !== 'draft_single_source') errors.push('sense_not_draft_single_source');
  if (!LANGS.includes(candidate.primary_lang)) errors.push('invalid_primary_lang');
  if (!nonEmpty(candidate.headword)) errors.push('missing_headword');
  if (!nonEmpty(candidate.effective_gloss_key)) errors.push('missing_gloss_key');
  if (isBroadGlossKey(candidate.effective_gloss_key)) errors.push('broad_gloss_key');
  if (localizations.length !== 4 || new Set(localizations.map((loc) => loc.lang)).size !== 4) {
    errors.push('localization_count_not_four');
  }

  for (const lang of LANGS) {
    const loc = locMap[lang];
    if (!loc) {
      errors.push(`missing_loc_${lang}`);
      continue;
    }
    if (loc.needs_review !== 1) errors.push(`loc_not_review_flagged_${lang}`);
    if (!nonEmpty(loc.term)) errors.push(`missing_term_${lang}`);
    if (!nonEmpty(loc.definition)) errors.push(`missing_definition_${lang}`);
    if (
      hasBadEncoding(loc.term) ||
      hasBadEncoding(loc.reading) ||
      hasBadEncoding(loc.pronunciation) ||
      hasBadEncoding(loc.definition)
    ) {
      errors.push(`mojibake_${lang}`);
    }
    if (hasHtmlArtifact(loc.term) || hasHtmlArtifact(loc.definition)) errors.push(`html_artifact_${lang}`);
    if (!termLanguageLooksRight(loc.term, lang)) errors.push(`term_language_${lang}`);
    if (!definitionLanguageLooksRight(loc.definition, lang)) errors.push(`definition_language_${lang}`);
    if (lang === 'zh' && traditionalToSimplified(loc.definition) !== loc.definition) {
      errors.push('zh_definition_not_simplified');
    }
    if (
      lang === 'zh' &&
      candidate.primary_lang !== 'zh' &&
      traditionalToSimplified(loc.term) !== loc.term
    ) {
      errors.push('zh_term_not_simplified');
    }
    if (lang === 'zh' && !readingLooksRight(loc.reading, 'zh')) errors.push('missing_zh_reading');
    if (lang === 'ja' && !readingLooksRight(loc.reading, 'ja')) errors.push('missing_ja_reading');
    if ((lang === 'en' || lang === 'pt-BR') && !ipaLooksRight(loc.pronunciation)) {
      errors.push(`missing_pronunciation_${lang}`);
    }
    if (lang === 'zh' && /[\u3040-\u30ff]/u.test(`${loc.term} ${loc.definition}`)) {
      errors.push('zh_contains_kana');
    }
  }

  const sourceLoc = locMap[candidate.primary_lang];
  if (sourceLoc && normalize(sourceLoc.term) !== normalize(candidate.headword)) {
    errors.push('source_term_mismatch');
  }
  if (!sourceLinks.length) errors.push('missing_source_link');
  for (const link of sourceLinks) {
    if (link.source_lang !== candidate.primary_lang) errors.push('source_link_lang_mismatch');
    if (normalize(link.source_word) !== normalize(candidate.headword)) errors.push('source_link_word_mismatch');
  }
  const semanticDrift = sourceGapSemanticDrift({ ...candidate, gloss_key: candidate.effective_gloss_key }, locMap);
  if (semanticDrift) errors.push(semanticDrift);

  const examples = exampleStmt.all(candidate.sense_id);
  if (requireExamples && examples.length === 0) errors.push('missing_required_example');
  const checkedExamples = [];
  for (const example of examples) {
    const exampleLocalizations = exampleLocalizationStmt.all(example.id);
    const exampleErrors = validateExample(example, exampleLocalizations);
    errors.push(...exampleErrors);
    checkedExamples.push({ ...example, localizations: exampleLocalizations });
  }

  return {
    candidate,
    localizations,
    source_links: sourceLinks,
    examples: checkedExamples,
    valid: errors.length === 0,
    errors: [...new Set(errors)]
  };
}

function validateExample(example, localizations) {
  const errors = [];
  if (example.needs_review !== 1) errors.push('example_not_review_flagged');
  if (!LANGS.includes(example.source_lang)) errors.push('example_invalid_source_lang');
  if (!nonEmpty(example.source_text)) errors.push('example_missing_source_text');
  if (hasBadEncoding(example.source_text)) errors.push('example_mojibake_source');
  if (example.source_lang === 'zh' && TRADITIONAL_SMOKE_RE.test(example.source_text)) {
    errors.push('example_zh_source_traditional');
  }
  if (localizations.length && new Set(localizations.map((loc) => loc.lang)).size !== 4) {
    errors.push('example_localization_count_not_four');
  }
  for (const loc of localizations) {
    if (!LANGS.includes(loc.lang)) errors.push('example_invalid_loc_lang');
    if (loc.needs_review !== 1) errors.push(`example_loc_not_review_flagged_${loc.lang}`);
    if (!nonEmpty(loc.text)) errors.push(`example_missing_text_${loc.lang}`);
    if (hasBadEncoding(loc.text) || hasBadEncoding(loc.reading)) errors.push(`example_mojibake_${loc.lang}`);
    if (loc.lang === 'zh' && TRADITIONAL_SMOKE_RE.test(loc.text)) errors.push('example_zh_traditional');
  }
  return errors;
}

function applyPromotions(items, stats) {
  const updateLocalization = db.prepare(`
    UPDATE product_localizations
    SET needs_review = 0, confidence = MAX(confidence, 0.82)
    WHERE product_sense_id = ?
  `);
  const updateSense = db.prepare(`
    UPDATE product_senses
    SET status = 'accepted', confidence = MAX(confidence, 0.82), gloss_key = @gloss_key
    WHERE id = @sense_id
  `);
  const updateExamples = db.prepare(`
    UPDATE product_examples
    SET needs_review = 0, confidence = MAX(confidence, 0.8)
    WHERE product_sense_id = ?
  `);
  const updateExampleLocalizations = db.prepare(`
    UPDATE product_example_localizations
    SET needs_review = 0, confidence = MAX(confidence, 0.8)
    WHERE product_example_id IN (SELECT id FROM product_examples WHERE product_sense_id = ?)
  `);
  const entrySenses = db.prepare(`
    SELECT id, status
    FROM product_senses
    WHERE product_entry_id = ?
    ORDER BY CASE status WHEN 'accepted' THEN 0 ELSE 1 END, sense_order, id
  `);
  const setSenseOrder = db.prepare('UPDATE product_senses SET sense_order = ? WHERE id = ?');
  const setEntry = db.prepare(`
    UPDATE product_entries
    SET status = @status,
        lang_count = @lang_count,
        source_count = (
          SELECT COUNT(DISTINCT source_sense_id)
          FROM product_sense_source_links
          WHERE product_sense_id IN (SELECT id FROM product_senses WHERE product_entry_id = @entry_id)
        )
    WHERE id = @entry_id
  `);
  const upsertVerification = db.prepare(`
    INSERT INTO product_sense_verification
      (product_sense_id, verification_level, confidence, review_model,
       review_report_sha256, evidence_families_json, reviewed_at, updated_at)
    VALUES
      (@product_sense_id, @verification_level, @confidence, @review_model,
       @review_report_sha256, @evidence_families_json, @reviewed_at, CURRENT_TIMESTAMP)
    ON CONFLICT(product_sense_id) DO UPDATE SET
      verification_level = excluded.verification_level,
      confidence = excluded.confidence,
      review_model = excluded.review_model,
      review_report_sha256 = excluded.review_report_sha256,
      evidence_families_json = excluded.evidence_families_json,
      reviewed_at = excluded.reviewed_at,
      updated_at = CURRENT_TIMESTAMP
  `);
  const reviewReportSha256 = semanticReviewPath
    ? crypto.createHash('sha256').update(fs.readFileSync(semanticReviewPath)).digest('hex')
    : null;

  db.transaction(() => {
    const touchedEntries = new Set();
    for (const item of items) {
      stats.localizations_promoted += updateLocalization.run(item.candidate.sense_id).changes;
      stats.examples_promoted += updateExamples.run(item.candidate.sense_id).changes;
      stats.example_localizations_promoted += updateExampleLocalizations.run(item.candidate.sense_id).changes;
      stats.senses_promoted += updateSense.run({
        sense_id: item.candidate.sense_id,
        gloss_key: item.candidate.effective_gloss_key
      }).changes;
      upsertVerification.run({
        product_sense_id: item.candidate.sense_id,
        verification_level: verificationLevel,
        confidence: verificationLevel === 'verified' ? Math.max(Number(item.candidate.confidence || 0), 0.9) : semanticReviewConfidence,
        review_model: reviewModel,
        review_report_sha256: reviewReportSha256,
        evidence_families_json: JSON.stringify(evidenceFamilies),
        reviewed_at: new Date().toISOString()
      });
      touchedEntries.add(item.candidate.entry_id);
    }
    for (const entryId of touchedEntries) {
      renumberEntry(entryId, entrySenses, setSenseOrder);
      const senses = entrySenses.all(entryId);
      const allAccepted = senses.length > 0 && senses.every((sense) => sense.status === 'accepted');
      setEntry.run({
        entry_id: entryId,
        status: allAccepted ? 'accepted' : 'needs_review',
        lang_count: 4
      });
      if (allAccepted) stats.entries_promoted++;
      stats.entries_refreshed++;
    }
  })();
}

function ensureVerificationSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS product_sense_verification (
      product_sense_id INTEGER PRIMARY KEY REFERENCES product_senses(id) ON DELETE CASCADE,
      verification_level TEXT NOT NULL CHECK (verification_level IN ('verified', 'ai_reviewed')),
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      review_model TEXT,
      review_report_sha256 TEXT,
      evidence_families_json TEXT NOT NULL DEFAULT '[]',
      reviewed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_product_sense_verification_level
      ON product_sense_verification(verification_level, product_sense_id);
    INSERT OR IGNORE INTO product_sense_verification
      (product_sense_id, verification_level, confidence, review_model,
       review_report_sha256, evidence_families_json, reviewed_at)
    SELECT id, 'verified', MAX(0, MIN(1, confidence)), NULL, NULL, '[]', CURRENT_TIMESTAMP
    FROM product_senses
    WHERE status = 'accepted';
  `);
}

function renumberEntry(entryId, entrySensesStmt, setSenseOrderStmt) {
  const senses = entrySensesStmt.all(entryId);
  for (const sense of senses) setSenseOrderStmt.run(-sense.id, sense.id);
  senses.forEach((sense, index) => setSenseOrderStmt.run(index + 1, sense.id));
}

function compactReviewed(item) {
  return {
    entry_id: item.candidate.entry_id,
    sense_id: item.candidate.sense_id,
    headword: item.candidate.headword,
    primary_lang: item.candidate.primary_lang,
    frequency_rank: item.candidate.frequency_rank,
    sense_order: item.candidate.sense_order,
    gloss_key: item.candidate.effective_gloss_key,
    valid: item.valid,
    errors: item.errors,
    localizations: Object.fromEntries(
      item.localizations.map((loc) => [
        loc.lang,
        {
          term: loc.term,
          reading: loc.reading,
          pronunciation: loc.pronunciation,
          definition: abbreviate(loc.definition, 120),
          needs_review: loc.needs_review
        }
      ])
    ),
    semantic_review: item.semantic_review || null
  };
}

function termLanguageLooksRight(value, lang) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (lang === 'zh') return /[\u3400-\u9fff]/u.test(text) && !/[\u3040-\u30ff]/u.test(text);
  if (lang === 'ja') return /[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
  if (lang === 'pt-BR' || lang === 'en')
    return /[\p{Script=Latin}]/u.test(text) && !/[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
  return false;
}

function definitionLanguageLooksRight(value, lang) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (lang === 'zh') return /[\u3400-\u9fff]/u.test(text) && !/[\u3040-\u30ff]/u.test(text);
  if (lang === 'ja') return /[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
  if (lang === 'pt-BR' || lang === 'en') return /[\p{Script=Latin}]/u.test(text);
  return false;
}

function readingLooksRight(value, lang) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (lang === 'zh')
    return /[\p{Script=Latin}\u0300-\u036f0-9]/u.test(text) && !/[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
  if (lang === 'ja') return /[\u3040-\u30ff]/u.test(text);
  return true;
}

function ipaLooksRight(value) {
  const text = String(value || '').trim();
  return text.length >= 2 && /[\/\[\]\u0250-\u02af\u02b0-\u02ff\u0300-\u036fA-Za-z]/u.test(text);
}

function sourceGapSemanticDrift(candidate, locMap) {
  const gloss = normalize(candidate.gloss_key);
  const enTerm = normalize(locMap.en?.term);
  const ptTerm = normalize(locMap['pt-BR']?.term);
  if (!gloss || !enTerm) return '';

  if (/\b(luck|fortune)\b/u.test(gloss)) {
    const enOk = /\b(luck|fortune|fortunate|good luck)\b/u.test(enTerm);
    const ptOk = /\b(sorte|fortuna)\b/u.test(ptTerm);
    if (!enOk || !ptOk) return 'semantic_drift_luck_fortune';
  }

  const glossTokens = contentTokens(gloss);
  if (
    candidate.primary_lang !== 'en' &&
    glossTokens.length &&
    /[a-z]/u.test(gloss) &&
    !hasTokenOverlap(glossTokens, contentTokens(enTerm))
  ) {
    return 'semantic_drift_en_term_gloss_mismatch';
  }
  return '';
}

function contentTokens(value) {
  return String(value || '')
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .split(/[^a-z]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_TOKENS.has(token));
}

function hasTokenOverlap(left, right) {
  for (const a of left) {
    for (const b of right) {
      if (a === b || a.startsWith(b) || b.startsWith(a)) return true;
      if (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4)) return true;
    }
  }
  return false;
}

function hasBadEncoding(value) {
  const text = String(value || '');
  return /[\uFFFD]/u.test(text) || LATIN1_MOJIBAKE_RE.test(text) || /[閿熺禂]/u.test(text);
}

function hasHtmlArtifact(value) {
  return HTML_ENTITY_RE.test(String(value || ''));
}

function isBroadGlossKey(value) {
  const parts = String(value || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length >= 5;
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

function abbreviate(value, maxLength) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}...`;
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function boundedNumber(value, fallback) {
  const parsed = Number(value || fallback);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}

function boundedConfidence(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return fallback;
  return parsed;
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10).replaceAll('-', '');
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) parsed[key] = 'true';
    else {
      parsed[key] = next;
      index++;
    }
  }
  return parsed;
}
