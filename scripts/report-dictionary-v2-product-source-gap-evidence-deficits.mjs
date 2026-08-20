#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const reportPaths = String(args.reports || args.report || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => requiredPath(value));
if (!reportPaths.length) throw new Error('Missing --reports <path[,path]>');
const outPath = path.resolve(args.out || 'logs/product-source-gap-evidence-deficits.json');
const supplementalDbPath = args['supplemental-db']
  ? requiredPath(args['supplemental-db'])
  : null;

const validations = reportPaths.flatMap((reportPath) => {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  return (Array.isArray(report.validations) ? report.validations : []).map((row) => ({
    ...row,
    diagnostic_source_report: relative(reportPath)
  }));
});

const rejected = validations.filter((row) => row.decision !== 'supported');
const roundTripFailures = rejected
  .filter((row) => row.reason === 'existing_localization_does_not_round_trip')
  .flatMap((row) =>
    (row.existing_localization_roundtrip?.checks || [])
      .filter((check) => !check.passed)
      .map((check) => ({
        candidate_key: row.candidate_key,
        word: row.word,
        source_lang: row.source_lang,
        target_lang: check.lang,
        best_family_count: Math.max(0, ...check.terms.map((term) => term.evidence_family_count || 0)),
        observed_families: unique(check.terms.flatMap((term) => term.evidence_families || [])),
        terms: check.terms
      }))
  );
const sourceConflicts = rejected
  .filter((row) => row.reason === 'strong_dictionary_gloss_conflict')
  .map((row) => ({
    candidate_key: row.candidate_key,
    word: row.word,
    source_lang: row.source_lang,
    anchor: row.evidence?.anchor || null,
    matching_sources: row.evidence?.matching_sources || [],
    matching_source_families: row.evidence?.matching_source_families || [],
    nonmatching_sources: unique(
      (row.evidence?.nonmatching_evidence || []).map((item) => item.source)
    ),
    nonmatching_glosses: unique(
      (row.evidence?.nonmatching_evidence || []).map((item) => item.english_gloss)
    )
  }));
const sourceNearUnlock = rejected
  .filter((row) =>
    row.source_lang === 'ja' &&
    row.evidence?.anchor &&
    ![
      'missing_english_anchor',
      'capitalized_proper_or_named_english_anchor',
      'insufficient_independent_target_evidence',
      'existing_localization_does_not_round_trip'
    ].includes(row.reason)
  )
  .map((row) => ({
    candidate_key: row.candidate_key,
    word: row.word,
    source_lang: row.source_lang,
    anchor: row.evidence.anchor,
    reason: row.reason,
    matching_sources: row.evidence?.matching_sources || [],
    matching_source_families: row.evidence?.matching_source_families || []
  }));
const insufficientTargets = rejected
  .filter((row) => row.reason === 'insufficient_independent_target_evidence')
  .flatMap((row) => {
    const hints = row.generation_hints || {};
    return ['en', 'pt-BR', 'zh', 'ja']
      .filter((lang) => lang !== row.source_lang && lang !== 'en')
      .filter((lang) => (hints[lang]?.evidence_families || []).length < 2)
      .map((lang) => ({
        candidate_key: row.candidate_key,
        word: row.word,
        source_lang: row.source_lang,
        target_lang: lang,
        terms: hints[lang]?.terms || [],
        observed_families: hints[lang]?.evidence_families || []
      }));
  });

const targetCoverageShortfalls = validations
  .filter((row) =>
    row.decision === 'supported' &&
    Number(row.target_coverage_count || 0) < 2
  )
  .flatMap((row) => {
    const hints = row.generation_hints || {};
    return ['pt-BR', 'zh', 'ja']
      .filter((lang) => lang !== row.source_lang)
      .filter((lang) => !(hints[lang]?.terms || []).length)
      .map((lang) => ({
        candidate_key: row.candidate_key,
        word: row.word,
        source_lang: row.source_lang,
        target_lang: lang,
        target_coverage_count: Number(row.target_coverage_count || 0),
        terms: hints[lang]?.terms || [],
        observed_families: hints[lang]?.evidence_families || []
      }));
  });

const summary = {
  input_reports: reportPaths.length,
  input_validations: validations.length,
  supported: validations.filter((row) => row.decision === 'supported').length,
  rejected: rejected.length,
  decisions: countBy(validations, (row) => row.decision),
  reasons: countBy(rejected, (row) => row.reason),
  source_conflicts_by_lang: countBy(sourceConflicts, (row) => row.source_lang),
  source_conflicts_by_matching_family_count: countBy(
    sourceConflicts,
    (row) => String(row.matching_source_families.length)
  ),
  source_near_unlock_by_reason: countBy(sourceNearUnlock, (row) => row.reason),
  roundtrip_failures_by_target_lang: countBy(roundTripFailures, (row) => row.target_lang),
  roundtrip_failures_by_best_family_count: countBy(
    roundTripFailures,
    (row) => String(row.best_family_count)
  ),
  insufficient_targets_by_lang: countBy(insufficientTargets, (row) => row.target_lang)
};
summary.insufficient_targets_by_family_count = countBy(
  insufficientTargets,
  (row) => String(row.observed_families.length)
);
summary.insufficient_targets_by_lang_and_family_count = countBy(
  insufficientTargets,
  (row) => `${row.target_lang}:${row.observed_families.length}`
);
summary.insufficient_targets_by_observed_family = countValues(
  insufficientTargets.flatMap((row) => row.observed_families)
);
summary.target_coverage_shortfalls_by_lang = countBy(
  targetCoverageShortfalls,
  (row) => row.target_lang
);
summary.target_coverage_shortfalls_by_lang_and_family_count = countBy(
  targetCoverageShortfalls,
  (row) => `${row.target_lang}:${row.observed_families.length}`
);
summary.evidence_acquisition_priority = buildEvidenceAcquisitionPriority(
  [...insufficientTargets, ...targetCoverageShortfalls],
  roundTripFailures
);
const supplementalInventory = supplementalDbPath
  ? loadSupplementalInventory(supplementalDbPath)
  : null;
const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_reports: reportPaths.map(relative),
  supplemental_db: supplementalDbPath ? relative(supplementalDbPath) : null,
  summary,
  supplemental_inventory: supplementalInventory,
  source_conflicts: sourceConflicts,
  source_near_unlock: sourceNearUnlock,
  roundtrip_failures: roundTripFailures,
  insufficient_targets: insufficientTargets,
  target_coverage_shortfalls: targetCoverageShortfalls
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), ...summary }, null, 2));

function loadSupplementalInventory(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  const sources = db.prepare(`
    SELECT source_key, source_family, lang, license, metadata_json
    FROM evidence_sources
    ORDER BY source_family, source_key, lang
  `).all().map((row) => {
    const metadata = safeJson(row.metadata_json);
    return {
      source_key: row.source_key,
      source_family: row.source_family,
      lang: row.lang,
      license: row.license,
      production_publishable: metadata.production_publishable !== false &&
        !/\b(?:cc\s*)?by-nc\b/iu.test(String(row.license || ''))
    };
  });
  const rowsByFamilyAndLang = db.prepare(`
    SELECT source_family, lang, COUNT(*) AS rows
    FROM lexical_evidence
    GROUP BY source_family, lang
    ORDER BY source_family, lang
  `).all();
  const totalRows = db.prepare('SELECT COUNT(*) AS rows FROM lexical_evidence').get().rows;
  db.close();
  return {
    total_rows: totalRows,
    source_count: sources.length,
    families: unique(sources.map((row) => row.source_family)),
    sources,
    rows_by_family_and_lang: rowsByFamilyAndLang
  };
}

function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = String(selector(row) || 'none');
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function countValues(values) {
  return countBy(values, (value) => value);
}

function buildEvidenceAcquisitionPriority(insufficientRows, roundTripRows) {
  const languages = unique([
    ...insufficientRows.map((row) => row.target_lang),
    ...roundTripRows.map((row) => row.target_lang)
  ]);
  return languages
    .map((lang) => {
      const insufficient = insufficientRows.filter((row) => row.target_lang === lang);
      const roundTrip = roundTripRows.filter((row) => row.target_lang === lang);
      const zeroFamily = insufficient.filter((row) => row.observed_families.length === 0).length;
      const oneFamily = insufficient.filter((row) => row.observed_families.length === 1).length;
      const roundTripBelowTwo = roundTrip.filter((row) => row.best_family_count < 2).length;
      return {
        lang,
        priority_score: zeroFamily * 3 + oneFamily * 2 + roundTripBelowTwo,
        insufficient_targets: insufficient.length,
        zero_family_targets: zeroFamily,
        one_family_targets: oneFamily,
        roundtrip_below_two_families: roundTripBelowTwo,
        observed_families: unique(insufficient.flatMap((row) => row.observed_families))
      };
    })
    .sort((left, right) =>
      right.priority_score - left.priority_score || left.lang.localeCompare(right.lang)
    );
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function safeJson(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function requiredPath(value) {
  const resolved = path.resolve(String(value));
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  return resolved;
}

function relative(value) {
  return path.relative(process.cwd(), value);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      result[key] = next;
      index += 1;
    } else result[key] = 'true';
  }
  return result;
}
