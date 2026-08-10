import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPath = path.resolve(args.report || 'logs/product-source-gap-candidate-approved.json');
const reviewPaths = parsePaths(args.reviews);
const outPath = path.resolve(args.out || 'logs/product-source-gap-reviewed-production.json');
const residualOutPath = path.resolve(args['residual-out'] || outPath.replace(/\.json$/u, '-residual.json'));
const minPrimaryEnglishLength = boundedInteger(args['min-primary-en-length'], 9, 1);
const directConfidence = boundedNumber(args['direct-confidence'], 1, 0, 1);
const minPrefilterTargetLangs = boundedInteger(args['min-prefilter-target-langs'], 0, 0);
const attachCandidateReview = args['attach-candidate-review'] === 'true';
const excludeManualOverrides = args['exclude-manual-overrides'] !== 'false';
const excludeOmwOnlySense = args['exclude-omw-only-sense'] !== 'false';

if (!fs.existsSync(reportPath)) throw new Error(`Candidate report not found: ${reportPath}`);
for (const reviewPath of reviewPaths) {
  if (!fs.existsSync(reviewPath)) throw new Error(`Review report not found: ${reviewPath}`);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const rows = Array.isArray(report.selected) ? report.selected : [];
const reviews = loadReviews(reviewPaths);
const selected = [];
const residuals = [];

for (const row of rows) {
  const review = reviews.get(String(row.source_entry_id)) || null;
  const primaryEnglishTerm = sourceEnglishTerm(row);
  const manualOverride = row?.candidate_review_provenance?.kind === 'manual_evidence_override';
  const reasons = [];
  if (excludeManualOverrides && manualOverride) reasons.push('manual_evidence_override');
  if (excludeOmwOnlySense && firstSenseSources(row).some((source) => source.startsWith('omw-'))) {
    reasons.push('omw_synset_requires_cross_dictionary');
  }
  if (!primaryEnglishTerm) reasons.push('missing_primary_english_term');
  if (!review) reasons.push('missing_evidence_review');
  if (review && (!review.valid || !review.approved)) reasons.push('evidence_review_not_approved');

  const directHighConfidence = Boolean(review?.approved && Number(review.confidence) >= directConfidence);
  const descriptiveAnchor = primaryEnglishTerm.length >= minPrimaryEnglishLength;
  const prefilterTargetCoverage = Number(row?.reverse_evidence_prefilter?.target_coverage_count || 0);
  const deterministicPrefilterQualified = Boolean(
    minPrefilterTargetLangs > 0 && prefilterTargetCoverage >= minPrefilterTargetLangs
  );
  if (!directHighConfidence && !descriptiveAnchor && !deterministicPrefilterQualified) {
    reasons.push('short_low_confidence_anchor');
  }

  const enriched = {
    ...row,
    ...(attachCandidateReview && review ? { candidate_evidence_review: compactCandidateReview(review) } : {}),
    production_triage: {
      primary_english_term: primaryEnglishTerm,
      primary_english_length: primaryEnglishTerm.length,
      evidence_confidence: review?.confidence ?? null,
      evidence_risk_flags: Array.isArray(review?.risk_flags) ? review.risk_flags : [],
      direct_high_confidence: directHighConfidence,
      descriptive_anchor: descriptiveAnchor,
      prefilter_target_coverage: prefilterTargetCoverage,
      deterministic_prefilter_qualified: deterministicPrefilterQualified
    }
  };
  if (reasons.length) {
    residuals.push({ ...enriched, production_triage_reasons: reasons });
  } else {
    selected.push(enriched);
  }
}

const summary = {
  source_report: path.relative(process.cwd(), reportPath),
  review_reports: reviewPaths.map((filePath) => path.relative(process.cwd(), filePath)),
  source_rows: rows.length,
  selected: selected.length,
  residuals: residuals.length,
  min_primary_english_length: minPrimaryEnglishLength,
  direct_confidence: directConfidence,
  min_prefilter_target_languages: minPrefilterTargetLangs,
  attach_candidate_review: attachCandidateReview,
  exclude_manual_overrides: excludeManualOverrides,
  exclude_omw_only_sense: excludeOmwOnlySense,
  selected_by_lang: countBy(selected.map((row) => row.source_lang)),
  residuals_by_reason: countReasons(residuals)
};

writeReport(outPath, report, selected, summary, 'production_candidate');
writeReport(residualOutPath, report, residuals, summary, 'manual_or_lower_confidence_residual');
console.log(
  JSON.stringify(
    {
      ok: true,
      out: path.relative(process.cwd(), outPath),
      residual_out: path.relative(process.cwd(), residualOutPath),
      summary
    },
    null,
    2
  )
);

function compactCandidateReview(review) {
  return {
    decision: review.decision,
    confidence: review.confidence,
    english_anchor: review.english_anchor,
    reason: review.reason,
    evidence: Array.isArray(review.evidence) ? review.evidence : [],
    risk_flags: Array.isArray(review.risk_flags) ? review.risk_flags : [],
    preferred_terms: review.preferred_terms || {}
  };
}

function sourceEnglishTerm(row) {
  const localizations = Array.isArray(row?.first_sense_localizations) ? row.first_sense_localizations : [];
  const english = localizations.find((item) => item?.lang === 'en' && String(item?.term || '').trim());
  return String(english?.term || '')
    .split(';')[0]
    .trim();
}

function firstSenseSources(row) {
  return [
    ...new Set(
      (Array.isArray(row?.first_sense_localizations) ? row.first_sense_localizations : [])
        .map((item) => String(item?.source || '').trim())
        .filter(Boolean)
    )
  ];
}

function loadReviews(paths) {
  const byId = new Map();
  for (const filePath of paths) {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    for (const review of value.reviews || []) {
      const key = String(review?.source_entry_id || '');
      if (!key) continue;
      const previous = byId.get(key);
      if (!previous || Number(review.confidence || 0) >= Number(previous.confidence || 0)) byId.set(key, review);
    }
  }
  return byId;
}

function writeReport(filePath, base, selectedRows, summary, bucket) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        ...base,
        ok: true,
        generated_at: new Date().toISOString(),
        source_report: path.relative(process.cwd(), reportPath),
        summary: { ...(base.summary || {}), production_triage: summary },
        triage_bucket: bucket,
        selected_count: selectedRows.length,
        selected: selectedRows
      },
      null,
      2
    ),
    'utf8'
  );
}

function countBy(values) {
  return Object.fromEntries(
    [...values.reduce((counts, value) => counts.set(value, (counts.get(value) || 0) + 1), new Map()).entries()].sort(
      ([left], [right]) => String(left).localeCompare(String(right))
    )
  );
}

function countReasons(rows) {
  return countBy(rows.flatMap((row) => row.production_triage_reasons || []));
}

function parsePaths(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(item));
}

function boundedInteger(value, fallback, minimum) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < minimum) throw new Error(`Invalid integer: ${value}`);
  return number;
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error(`Invalid number: ${value}`);
  return number;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return parsed;
}
