#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(
  args.report || 'logs/product-coverage-gaps-v97-northeuralex-mainland-first-strict.json'
);
const historyPath = requiredPath(
  args.history || 'logs/product-source-gap-v97-current-all-history-attempts.json'
);
const productDbPath = requiredPath(
  args['product-db'] || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db'
);
const ptPronunciationDbPath = requiredPath(
  args['pt-pronunciation-db'] || 'data/processed/kaikki_portuguese_pronunciations.db'
);
const outPath = path.resolve(
  args.out || 'logs/product-source-gap-v97-retry-capacity.json'
);
const limit = boundedInteger(args.limit, 5000, 1);
const selectionMode = String(args.mode || 'production').trim();
if (!['production', 'review'].includes(selectionMode)) {
  throw new Error(`Unsupported --mode: ${selectionMode}`);
}
const RETRY_ELIGIBLE = new Set([
  'fresh_unattempted',
  'infrastructure_or_parse_failure',
  'generation_quality_reject',
  'generated_but_unpublished',
  'checkpoint_attempt_unresolved'
]);
const KNOWN_SEMANTIC_RESIDUALS = new Set([
  'pt-BR|dobragem|dubbing',
  'pt-BR|excreção|excretion'
]);

const report = readJson(reportPath);
const history = readJson(historyPath);
const candidates = Array.isArray(report.selected) ? report.selected : [];
const historyExact = new Map();
const historyWildcard = new Map();
for (const row of history.selected || []) {
  if (row.source_sense_id) historyExact.set(key(row.source_entry_id, row.source_sense_id), row);
  else historyWildcard.set(String(row.source_entry_id), row);
}

const db = new Database(productDbPath, { readonly: true, fileMustExist: true });
db.pragma('query_only = ON');
const links = db.prepare(`
  SELECT link.source_sense_id, ps.id product_sense_id, ps.status sense_status,
         pe.id product_entry_id, pe.status entry_status
  FROM product_sense_source_links link
  JOIN product_senses ps ON ps.id = link.product_sense_id
  JOIN product_entries pe ON pe.id = ps.product_entry_id
`).all();
const linksBySourceSense = new Map();
for (const row of links) {
  const list = linksBySourceSense.get(Number(row.source_sense_id)) || [];
  list.push(row);
  linksBySourceSense.set(Number(row.source_sense_id), list);
}
const ptDb = new Database(ptPronunciationDbPath, { readonly: true, fileMustExist: true });
ptDb.pragma('query_only = ON');
const findBrazilianPortuguesePronunciation = ptDb.prepare(`
  SELECT 1
  FROM portuguese_pronunciations
  WHERE normalized_key = ?
    AND region IN ('Brazil', 'São-Paulo', 'Rio-de-Janeiro', 'Caipira',
                   'Southern-Brazil', 'Northeast-Brazil')
  LIMIT 1
`);

const classified = candidates.map((candidate) => {
  const sourceSenseId = Number(candidate.first_sense_id || candidate.source_sense_id);
  const sourceEntryId = Number(candidate.source_entry_id);
  const linked = linksBySourceSense.get(sourceSenseId) || [];
  const accepted = linked.find((row) => row.sense_status === 'accepted');
  const draft = linked.find((row) => row.sense_status === 'draft_single_source');
  const attempt = historyExact.get(key(sourceEntryId, sourceSenseId)) || historyWildcard.get(String(sourceEntryId));
  const evidence = new Set(attempt?.evidence || []);
  const classification = classify({ accepted, draft, attempt, evidence });
  const localeEligible = candidate.source_lang !== 'pt-BR' || Boolean(
    findBrazilianPortuguesePronunciation.get(normalize(candidate.word))
  );
  const knownSemanticResidual = KNOWN_SEMANTIC_RESIDUALS.has(semanticResidualKey(candidate));
  const targetTermEvidenceGaps = targetTermEvidenceGapsFor(candidate);
  return {
    ...candidate,
    retry_capacity: {
      classification,
      retry_eligible: RETRY_ELIGIBLE.has(classification),
      has_single_four_language_hints: hasSingleFourLanguageHints(candidate),
      has_four_language_hint_candidates: hasFourLanguageHintCandidates(candidate),
      target_terms_evidence_bound: targetTermEvidenceGaps.length === 0,
      target_term_evidence_gaps: targetTermEvidenceGaps,
      locale_eligible: localeEligible,
      known_semantic_residual: knownSemanticResidual,
      historical_attempts: Number(attempt?.attempts || 0),
      historical_evidence: [...evidence].sort(),
      historical_files: attempt?.files || [],
      linked_product_senses: linked.map((row) => ({
        product_entry_id: row.product_entry_id,
        product_sense_id: row.product_sense_id,
        entry_status: row.entry_status,
        sense_status: row.sense_status
      }))
    }
  };
});

const retryRows = classified
  .filter((row) => row.retry_capacity.retry_eligible)
  .sort(compareRetryRows);
const productionRetryRows = retryRows.filter(
  (row) => row.retry_capacity.has_single_four_language_hints &&
    row.retry_capacity.target_terms_evidence_bound &&
    row.retry_capacity.locale_eligible &&
    !row.retry_capacity.known_semantic_residual
);
const reviewRetryRows = retryRows.filter(
  (row) => row.retry_capacity.has_four_language_hint_candidates &&
    row.retry_capacity.target_terms_evidence_bound &&
    row.retry_capacity.locale_eligible &&
    !row.retry_capacity.known_semantic_residual
);
const selectedPool = selectionMode === 'review' ? reviewRetryRows : productionRetryRows;
const selected = selectedPool.slice(0, limit);
const summary = {
  input_strict_candidates: candidates.length,
  classifications: countBy(classified, (row) => row.retry_capacity.classification),
  retry_eligible_rows: retryRows.length,
  retry_eligible_with_single_four_language_hints: retryRows.filter(
    (row) => row.retry_capacity.has_single_four_language_hints
  ).length,
  retry_eligible_with_locale_evidence: retryRows.filter(
    (row) => row.retry_capacity.locale_eligible
  ).length,
  retry_eligible_with_evidence_bound_target_terms: retryRows.filter(
    (row) => row.retry_capacity.target_terms_evidence_bound
  ).length,
  production_retry_eligible_rows: productionRetryRows.length,
  production_retry_unique_source_entries: new Set(
    productionRetryRows.map((row) => Number(row.source_entry_id))
  ).size,
  review_retry_eligible_rows: reviewRetryRows.length,
  review_retry_unique_source_entries: new Set(
    reviewRetryRows.map((row) => Number(row.source_entry_id))
  ).size,
  retry_eligible_by_source_lang: countBy(retryRows, (row) => row.source_lang),
  retry_eligible_by_historical_evidence: countEvidence(retryRows),
  selected_rows: selected.length,
  limit
};
const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_report: relative(reportPath),
  history_report: relative(historyPath),
  product_db: relative(productDbPath),
  pt_pronunciation_db: relative(ptPronunciationDbPath),
  policy: {
    selection_mode: selectionMode,
    exact_source_sense_identity: true,
    accepted_and_draft_links_excluded: true,
    explicit_source_review_rejects_excluded: true,
    generation_quality_rejects_retryable: true,
    infrastructure_and_parse_failures_retryable: true,
    generated_but_unpublished_rows_retryable: true,
    checkpoint_only_rows_retryable: true,
    retry_is_not_publication_approval: true,
    multi_hint_review_rows_require_per_language_selection_and_reverse_validation: true,
    full_pipeline_revalidation_required: true,
    target_terms_require_independent_lexical_evidence: true
  },
  summary,
  selected_count: selected.length,
  selected
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
db.close();
ptDb.close();
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary }, null, 2));

function classify({ accepted, draft, attempt, evidence }) {
  if (accepted) return 'already_published';
  if (draft) return 'existing_draft';
  if (!attempt) return 'fresh_unattempted';
  if (evidence.has('source_review_reject') || evidence.has('review_reject')) {
    return 'explicit_semantic_reject';
  }
  if (evidence.has('review_failure_after_retries')) return 'infrastructure_or_parse_failure';
  if (evidence.has('generation_quality_reject') && !evidence.has('generated')) {
    return 'generation_quality_reject';
  }
  if (evidence.has('generated')) return 'generated_but_unpublished';
  if (evidence.has('checkpoint')) return 'checkpoint_attempt_unresolved';
  if (evidence.has('already_linked_complete_source_gap')) return 'stale_complete_marker';
  return 'historical_unknown';
}

function hasSingleFourLanguageHints(row) {
  const hints = row.generation_hints || {};
  return ['en', 'pt-BR', 'zh', 'ja'].every(
    (lang) => Array.isArray(hints[lang]?.terms) && hints[lang].terms.length === 1
  );
}

function hasFourLanguageHintCandidates(row) {
  const hints = row.generation_hints || {};
  return ['en', 'pt-BR', 'zh', 'ja'].every(
    (lang) => Array.isArray(hints[lang]?.terms) && hints[lang].terms.length > 0
  );
}

function targetTermEvidenceGapsFor(row) {
  const gaps = [];
  for (const lang of ['en', 'pt-BR', 'zh', 'ja']) {
    if (lang === row.source_lang) continue;
    const hint = row.generation_hints?.[lang] || {};
    const evidenceFamilies = new Set(
      Array.isArray(hint.evidence_families) ? hint.evidence_families : []
    );
    const uniqueOmw = hint.provenance === 'omw_synset';
    const reviewedEnglishAnchor =
      lang === 'en' &&
      Array.isArray(hint.sources) &&
      hint.sources.includes('source_english_anchor');
    if (!uniqueOmw && !reviewedEnglishAnchor && evidenceFamilies.size < 2) gaps.push(lang);
  }
  return gaps;
}

function semanticResidualKey(row) {
  const hinted = row.generation_hints?.en?.terms?.[0];
  const anchor = hinted || String(row.gloss_key || '').replace(/^en:\s*/iu, '').split(';')[0];
  return [row.source_lang, normalize(row.word), normalize(anchor)].join('|');
}

function normalize(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('pt-BR');
}

function compareRetryRows(left, right) {
  const order = {
    fresh_unattempted: 0,
    infrastructure_or_parse_failure: 1,
    generation_quality_reject: 2,
    checkpoint_attempt_unresolved: 3,
    generated_but_unpublished: 4
  };
  const classDifference =
    order[left.retry_capacity.classification] - order[right.retry_capacity.classification];
  if (classDifference) return classDifference;
  const attemptDifference =
    left.retry_capacity.historical_attempts - right.retry_capacity.historical_attempts;
  if (attemptDifference) return attemptDifference;
  return Number(left.frequency_rank || Number.MAX_SAFE_INTEGER) -
    Number(right.frequency_rank || Number.MAX_SAFE_INTEGER);
}

function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const value = String(selector(row) || 'unknown');
    counts[value] = (counts[value] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function countEvidence(rows) {
  const counts = {};
  for (const row of rows) {
    const evidence = row.retry_capacity.historical_evidence;
    const label = evidence.length ? evidence.join('+') : 'none';
    counts[label] = (counts[label] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function key(entryId, senseId) {
  return `${Number(entryId)}:${Number(senseId)}`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requiredPath(value) {
  const resolved = path.resolve(String(value || ''));
  if (!value || !fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  return resolved;
}

function relative(filePath) {
  return path.relative(process.cwd(), filePath);
}

function boundedInteger(value, fallback, minimum) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number >= minimum ? number : fallback;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    const next = argv[index + 1];
    parsed[name] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return parsed;
}
