#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const currentPath = requiredPath(args.current, 'current');
const historyPath = requiredPath(args.history, 'history');
const logsDir = path.resolve(args['logs-dir'] || 'logs');
const outPath = path.resolve(
  args.out || 'logs/product-source-gap-source-review-evidence-upgrades.json'
);

const current = readJson(currentPath);
const history = readJson(historyPath);
const currentRows = Array.isArray(current.selected) ? current.selected : [];
const currentByKey = new Map(currentRows.map((row) => [candidateKey(row), row]));
const rejectedHistory = (history.selected || []).filter(
  (row) => row?.evidence_files?.source_review_reject?.length && currentByKey.has(candidateKey(row))
);
const rejectFiles = unique(
  rejectedHistory.flatMap((row) => row.evidence_files.source_review_reject || [])
);
const historicalCandidates = new Map();
const missingReports = [];
const reportCache = new Map();

for (const fileName of rejectFiles) {
  const reviewPath = path.join(logsDir, fileName);
  if (!fs.existsSync(reviewPath)) {
    missingReports.push(fileName);
    continue;
  }
  const review = readJson(reviewPath);
  if (!isSourceReview(review)) continue;
  const inputPath = resolveReportPath(review.report);
  if (!inputPath) {
    missingReports.push(`${fileName}:input:${review.report || 'missing'}`);
    continue;
  }
  const input = cachedJson(inputPath);
  const inputByKey = new Map((input.selected || []).map((row) => [candidateKey(row), row]));
  for (const rejected of review.reviews || []) {
    if (rejected?.valid !== true || rejected?.decision !== 'reject') continue;
    const key = candidateKey(rejected);
    if (!currentByKey.has(key)) continue;
    const oldCandidate = inputByKey.get(key);
    if (!oldCandidate) continue;
    const record = historicalCandidates.get(key) || {
      reports: new Set(),
      families: emptyLanguageSets(),
      terms: emptyLanguageSets()
    };
    record.reports.add(fileName);
    collectHintEvidence(oldCandidate, record.families, record.terms);
    historicalCandidates.set(key, record);
  }
}

const assessed = rejectedHistory.map((historyRow) => {
  const key = candidateKey(historyRow);
  const row = currentByKey.get(key);
  const old = historicalCandidates.get(key);
  const changes = compareEvidence(row, old);
  const eligible =
    Boolean(old) &&
    hasSingleFourLanguageHints(row) &&
    targetTermsEvidenceBound(row) &&
    changes.some((change) => change.added_families.length || change.term_changed);
  return {
    ...row,
    source_review_evidence_upgrade: {
      eligible_for_dual_model_revalidation: eligible,
      historical_source_review_reports: old ? [...old.reports].sort() : [],
      historical_source_review_attempts: historyRow.evidence_files.source_review_reject.length,
      changes
    }
  };
});

const selected = assessed
  .filter((row) => row.source_review_evidence_upgrade.eligible_for_dual_model_revalidation)
  .sort((left, right) =>
    Number(left.frequency_rank || Number.MAX_SAFE_INTEGER) -
      Number(right.frequency_rank || Number.MAX_SAFE_INTEGER) ||
    candidateKey(left).localeCompare(candidateKey(right))
  );
const output = {
  ok: missingReports.length === 0,
  generated_at: new Date().toISOString(),
  current_report: relative(currentPath),
  history_report: relative(historyPath),
  policy: {
    historical_source_rejects_remain_blocked_by_default: true,
    revalidation_requires_new_evidence_family_or_changed_term: true,
    revalidation_requires_single_four_language_hints: true,
    revalidation_requires_current_independent_target_evidence: true,
    dual_model_revalidation_required: true,
    automatic_publication: false
  },
  summary: {
    current_rows: currentRows.length,
    current_rows_with_source_review_reject: rejectedHistory.length,
    source_review_files: rejectFiles.length,
    historical_candidates_reconstructed: historicalCandidates.size,
    eligible_for_dual_model_revalidation: selected.length,
    eligible_unique_entries: new Set(selected.map((row) => Number(row.source_entry_id))).size,
    eligible_by_source_lang: countBy(selected, (row) => row.source_lang),
    missing_reports: missingReports.length
  },
  missing_reports: missingReports,
  selected_count: selected.length,
  selected
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: output.ok, out: relative(outPath), summary: output.summary }, null, 2));
if (!output.ok) process.exitCode = 1;

function isSourceReview(report) {
  return Boolean(
    report?.report &&
      report?.model &&
      Array.isArray(report?.reviews) &&
      report.reviews.some(
        (row) => Object.hasOwn(row || {}, 'gloss_key') && Object.hasOwn(row || {}, 'approved')
      )
  );
}

function resolveReportPath(value) {
  if (!value) return null;
  const candidates = [path.resolve(value), path.resolve(logsDir, path.basename(value))];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function cachedJson(filePath) {
  if (!reportCache.has(filePath)) reportCache.set(filePath, readJson(filePath));
  return reportCache.get(filePath);
}

function emptyLanguageSets() {
  return Object.fromEntries(['en', 'pt-BR', 'zh', 'ja'].map((lang) => [lang, new Set()]));
}

function collectHintEvidence(row, families, terms) {
  for (const lang of ['en', 'pt-BR', 'zh', 'ja']) {
    const hint = row?.generation_hints?.[lang] || {};
    for (const family of hint.evidence_families || []) families[lang].add(String(family));
    for (const term of hint.terms || []) terms[lang].add(normalize(term));
  }
}

function compareEvidence(row, old) {
  return ['en', 'pt-BR', 'zh', 'ja'].map((lang) => {
    const hint = row?.generation_hints?.[lang] || {};
    const currentFamilies = unique((hint.evidence_families || []).map(String)).sort();
    const currentTerms = unique((hint.terms || []).map(normalize)).sort();
    const oldFamilies = old ? [...old.families[lang]].sort() : [];
    const oldTerms = old ? [...old.terms[lang]].sort() : [];
    return {
      lang,
      added_families: currentFamilies.filter((family) => !oldFamilies.includes(family)),
      removed_families: oldFamilies.filter((family) => !currentFamilies.includes(family)),
      historical_terms: oldTerms,
      current_terms: currentTerms,
      term_changed: oldTerms.join('\u0000') !== currentTerms.join('\u0000')
    };
  });
}

function hasSingleFourLanguageHints(row) {
  return ['en', 'pt-BR', 'zh', 'ja'].every(
    (lang) => Array.isArray(row?.generation_hints?.[lang]?.terms) && row.generation_hints[lang].terms.length === 1
  );
}

function targetTermsEvidenceBound(row) {
  return ['en', 'pt-BR', 'zh', 'ja'].every((lang) => {
    if (lang === row.source_lang) return true;
    const hint = row?.generation_hints?.[lang] || {};
    return (
      hint.provenance === 'omw_synset' ||
      (lang === 'en' && (hint.sources || []).includes('source_english_anchor')) ||
      new Set(hint.evidence_families || []).size >= 2
    );
  });
}

function candidateKey(row) {
  return `${Number(row?.source_entry_id)}:${Number(row?.first_sense_id ?? row?.source_sense_id)}`;
}

function normalize(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('pt-BR');
}

function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = String(selector(row) || 'unknown');
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function unique(values) {
  return [...new Set(values)];
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const filePath = path.resolve(value);
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return filePath;
}

function relative(filePath) {
  return path.relative(process.cwd(), filePath);
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
