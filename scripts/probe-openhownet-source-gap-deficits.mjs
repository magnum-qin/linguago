#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const reportPaths = String(required(args.reports, 'reports'))
  .split(',')
  .map((value) => requiredPath(value.trim()));
const evidenceDbPath = requiredPath(args['evidence-db']);
const outPath = path.resolve(args.out || 'logs/product-source-gap-openhownet-research-probe.json');
const scope = String(args.scope || 'deficits').trim().toLowerCase();
if (!['deficits', 'all'].includes(scope)) throw new Error(`Unsupported --scope: ${scope}`);
const lang = String(args.lang || '').trim();
const limit = integer(args.limit, Number.MAX_SAFE_INTEGER, 1);
const excludeProbePaths = String(args['exclude-probes'] || args['exclude-probe'] || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map(requiredPath);
const excludeReviewDir = args['exclude-review-dir']
  ? requiredDirectory(args['exclude-review-dir'])
  : null;
const excludeReviewPattern = String(args['exclude-review-pattern'] || 'openhownet').toLowerCase();
const excludeReviewPaths = excludeReviewDir
  ? fs.readdirSync(excludeReviewDir, { withFileTypes: true })
      .filter((entry) =>
        entry.isFile() &&
        entry.name.endsWith('.json') &&
        entry.name.toLowerCase().includes(excludeReviewPattern)
      )
      .map((entry) => path.join(excludeReviewDir, entry.name))
  : [];
const excludedCandidateKeys = new Set(
  [
    ...excludeProbePaths.flatMap(loadExcludedProbeCandidateKeys),
    ...excludeReviewPaths.flatMap(loadExcludedReviewCandidateKeys)
  ]
);

const reportRowsByKey = new Map();
for (const reportPath of reportPaths) {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const rows = Array.isArray(report.validations)
    ? report.validations
    : Array.isArray(report.selected)
      ? report.selected
      : Array.isArray(report.near_unlock)
        ? report.near_unlock
        : [];
  for (const row of rows) {
    const key = candidateKey(row);
    if (!key || excludedCandidateKeys.has(key)) continue;
    const existing = reportRowsByKey.get(key);
    if (existing) {
      existing.diagnostic_source_reports.push(relative(reportPath));
      continue;
    }
    reportRowsByKey.set(key, {
      ...row,
      candidate_key: key,
      diagnostic_source_reports: [relative(reportPath)]
    });
  }
}
const reportRows = [...reportRowsByKey.values()];
const targets = reportRows
  .filter((row) => !lang || row.source_lang === lang)
  .filter((row) => scope === 'all' || (
    row.reason === 'insufficient_independent_target_evidence' &&
    (row.generation_hints?.zh?.evidence_families || []).length < 2
  ))
  .slice(0, limit);

const db = new Database(evidenceDbPath, { readonly: true, fileMustExist: true });
db.pragma('query_only = ON');
const source = db.prepare(`
  SELECT source_key, source_family, license, metadata_json
  FROM evidence_sources
  ORDER BY source_key
`).get();
if (!source) throw new Error('OpenHowNet evidence DB contains no source metadata');
const metadata = safeJson(source.metadata_json);
const findExact = db.prepare(`
  SELECT e.term, e.english_gloss, e.concept_id,
         m.zh_pos, m.en_pos, m.sememe_definition
  FROM lexical_evidence e
  LEFT JOIN openhownet_sense_metadata m
    ON 'openhownet:' || m.sense_id = e.concept_id
  WHERE e.lang = 'zh' AND e.english_normalized_key = ?
  ORDER BY e.normalized_key, e.concept_id
`);

const probes = targets.map((row) => {
  const anchor = englishAnchor(row);
  const matches = findExact.all(normalize(anchor));
  const expectedPos = inferExpectedPos(row);
  const boundMatches = matches.map((match) => ({
    ...match,
    pos_binding: classifyPosBinding(expectedPos, match.en_pos, match.zh_pos)
  }));
  const terms = unique(matches.map((match) => match.term));
  const exactPosMatches = boundMatches.filter((match) => match.pos_binding === 'exact');
  const exactPosTerms = unique(exactPosMatches.map((match) => match.term));
  const internallyConsistentMatches = boundMatches.filter((match) =>
    match.pos_binding === 'exact' || match.pos_binding === 'internal_consistent'
  );
  return {
    candidate_key: row.candidate_key || `${row.source_entry_id}:${row.first_sense_id}`,
    word: row.word,
    source_lang: row.source_lang,
    english_anchor: anchor,
    exact_match: matches.length > 0,
    expected_pos: expectedPos,
    exact_pos_match_count: exactPosMatches.length,
    exact_pos_unique_term_count: exactPosTerms.length,
    exact_pos_terms: exactPosTerms,
    internally_consistent_match_count: internallyConsistentMatches.length,
    sense_binding: exactPosMatches.length > 0
      ? exactPosTerms.length === 1 ? 'exact_pos_single_term' : 'exact_pos_multiple_terms'
      : internallyConsistentMatches.length > 0
        ? 'internal_pos_only'
        : matches.length > 0 ? 'pos_conflict' : 'unmatched',
    unique_term_count: terms.length,
    ambiguity: terms.length === 0 ? 'unmatched' : terms.length === 1 ? 'single_term' : 'multiple_terms',
    terms,
    concepts: boundMatches
  };
});
db.close();

const matched = probes.filter((row) => row.exact_match);
const researchCandidates = probes
  .filter((row) => row.sense_binding === 'exact_pos_single_term')
  .map((row) => ({
    candidate_key: row.candidate_key,
    word: row.word,
    source_lang: row.source_lang,
    english_anchor: row.english_anchor,
    expected_pos: row.expected_pos,
    zh_term: row.exact_pos_terms[0],
    sememe_definitions: unique(row.concepts
      .filter((concept) => concept.pos_binding === 'exact')
      .map((concept) => concept.sememe_definition)),
    status: 'license_blocked_semantic_review',
    generation_allowed: false,
    publication_evidence: false
  }));
const selectionCandidates = probes
  .filter((row) => row.sense_binding === 'exact_pos_multiple_terms')
  .map((row) => ({
    candidate_key: row.candidate_key,
    word: row.word,
    source_lang: row.source_lang,
    english_anchor: row.english_anchor,
    expected_pos: row.expected_pos,
    zh_terms: row.exact_pos_terms,
    term_evidence: row.exact_pos_terms.map((term) => ({
      term,
      sememe_definitions: unique(row.concepts
        .filter((concept) => concept.pos_binding === 'exact' && concept.term === term)
        .map((concept) => concept.sememe_definition))
    })),
    status: 'license_blocked_term_selection_review',
    generation_allowed: false,
    publication_evidence: false
  }));
const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  policy: {
    scope,
    research_only: true,
    production_publishable: false,
    source_provenance_publishable: metadata.production_publishable === true,
    exact_english_anchor_only: true,
    publication_evidence: false,
    generation_allowed: false,
    historical_candidate_keys_excluded: excludedCandidateKeys.size,
    exclude_review_dir: excludeReviewDir ? relative(excludeReviewDir) : null,
    exclude_review_pattern: excludeReviewDir ? excludeReviewPattern : null,
    reason: metadata.reason || 'OpenHowNet data-license boundary is not cleared.'
  },
  source: {
    source_key: source.source_key,
    source_family: source.source_family,
    license: source.license,
    metadata
  },
  source_reports: reportPaths.map(relative),
  excluded_probes: excludeProbePaths.map(relative),
  evidence_db: relative(evidenceDbPath),
  summary: {
    target_rows: probes.length,
    exact_anchor_matches: matched.length,
    exact_anchor_match_rate: probes.length ? matched.length / probes.length : 0,
    single_term_matches: matched.filter((row) => row.unique_term_count === 1).length,
    multiple_term_matches: matched.filter((row) => row.unique_term_count > 1).length,
    exact_pos_bound_rows: matched.filter((row) => row.sense_binding.startsWith('exact_pos_')).length,
    exact_pos_single_term_rows: matched.filter((row) => row.sense_binding === 'exact_pos_single_term').length,
    exact_pos_multiple_term_rows: matched.filter((row) => row.sense_binding === 'exact_pos_multiple_terms').length,
    internal_pos_only_rows: matched.filter((row) => row.sense_binding === 'internal_pos_only').length,
    pos_conflict_rows: matched.filter((row) => row.sense_binding === 'pos_conflict').length,
    unmatched: probes.filter((row) => !row.exact_match).length
  },
  research_candidates: researchCandidates,
  selection_candidates: selectionCandidates,
  probes
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out: relative(outPath), ...output.summary }, null, 2));

function normalize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en').trim().replace(/\s+/gu, ' ');
}

function inferExpectedPos(row) {
  const explicit = normalizePos(row.part_of_speech || row.evidence?.part_of_speech);
  if (explicit) return explicit;
  const inferred = unique((row.evidence?.aligned_omw_synsets || [])
    .map((synset) => String(synset).match(/-([nvar])$/iu)?.[1])
    .map((suffix) => ({ n: 'noun', v: 'verb', a: 'adjective', r: 'adverb' })[suffix])
    .filter(Boolean));
  return inferred.length === 1 ? inferred[0] : null;
}

function englishAnchor(row) {
  const explicit = String(row.evidence?.anchor || row.source_meaning_anchor || '').trim();
  if (explicit) return explicit;
  const english = (row.first_sense_localizations || []).find((localization) => localization?.lang === 'en');
  return String(english?.term || english?.definition || '').trim();
}

function normalizePos(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ({
    n: 'noun', noun: 'noun',
    v: 'verb', verb: 'verb',
    a: 'adjective', adj: 'adjective', adjective: 'adjective',
    r: 'adverb', adv: 'adverb', adverb: 'adverb'
  })[normalized] || null;
}

function classifyPosBinding(expected, enPos, zhPos) {
  const en = normalizePos(enPos);
  const zh = normalizePos(zhPos);
  if (expected && en === expected && zh === expected) return 'exact';
  if (en && zh && en === zh) return expected ? 'conflict' : 'internal_consistent';
  return expected ? 'conflict' : 'unknown';
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function candidateKey(row) {
  return String(row?.candidate_key || `${row?.source_entry_id || ''}:${row?.first_sense_id || ''}`).trim();
}

function safeJson(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function required(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return String(value);
}

function requiredPath(value) {
  const resolved = path.resolve(required(value, 'path'));
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  return resolved;
}

function requiredDirectory(value) {
  const directoryPath = path.resolve(value);
  if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
    throw new Error(`Required directory not found: ${directoryPath}`);
  }
  return directoryPath;
}

function readReportOrNull(filePath) {
  let report;
  try {
    report = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
  return report;
}

function loadExcludedProbeCandidateKeys(filePath) {
  const report = readReportOrNull(filePath);
  if (!report) return [];
  return ['probes', 'research_candidates', 'selection_candidates']
    .flatMap((key) => Array.isArray(report[key]) ? report[key] : [])
    .map(candidateKey)
    .filter(Boolean);
}

function loadExcludedReviewCandidateKeys(filePath) {
  const report = readReportOrNull(filePath);
  return (Array.isArray(report?.reviews) ? report.reviews : [])
    .map(candidateKey)
    .filter(Boolean);
}

function integer(value, fallback, minimum) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
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
