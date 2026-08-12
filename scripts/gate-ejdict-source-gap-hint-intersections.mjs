#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report);
const sourceDir = requiredDirectory(args['source-dir']);
const historyPath = args.history ? requiredPath(args.history) : null;
const outPath = path.resolve(args.out || 'logs/product-source-gap-ejdict-exact-hint-gate.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const rows = Array.isArray(report.selected) ? report.selected : [];
const anchors = new Set(rows.flatMap((row) => hintTerms(row, 'en').map(normalizeEnglish)));
const ejdictByAnchor = new Map();

for (const filePath of fs.readdirSync(sourceDir)
  .filter((name) => name.endsWith('.txt'))
  .map((name) => path.join(sourceDir, name))) {
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/u)) {
    const tab = line.indexOf('\t');
    if (tab <= 0) continue;
    const headwords = line.slice(0, tab).split(',').map(cleanEnglish).filter(Boolean);
    const rawDefinition = line.slice(tab + 1).trim();
    const terms = extractJapaneseTerms(rawDefinition);
    for (const headword of headwords) {
      const anchor = normalizeEnglish(headword);
      if (!anchors.has(anchor)) continue;
      if (!ejdictByAnchor.has(anchor)) ejdictByAnchor.set(anchor, []);
      ejdictByAnchor.get(anchor).push({ headword, raw_definition: rawDefinition, terms });
    }
  }
}

const historyByEntry = historyPath
  ? new Map((JSON.parse(fs.readFileSync(historyPath, 'utf8')).selected || [])
      .map((row) => [String(row.source_entry_id), row]))
  : new Map();
const assessed = rows.map((row) => {
  const englishHints = hintTerms(row, 'en');
  const japaneseHints = hintTerms(row, 'ja');
  const japaneseHintKeys = new Map(japaneseHints.map((term) => [normalizeJapanese(term), term]));
  const anchorChecks = englishHints.map((anchor) => {
    const records = ejdictByAnchor.get(normalizeEnglish(anchor)) || [];
    const intersections = unique(records.flatMap((record) =>
      [...record.terms].filter((term) => japaneseHintKeys.has(normalizeJapanese(term)))
    ));
    return {
      anchor,
      matched: records.length > 0,
      exact_hint_intersections: intersections,
      definitions: unique(records.map((record) => record.raw_definition))
    };
  });
  const sharedKeys = intersect(anchorChecks.map((check) =>
    check.exact_hint_intersections.map(normalizeJapanese)
  ));
  const sharedTerms = sharedKeys.map((key) => japaneseHintKeys.get(key) || key);
  const history = historyByEntry.get(String(row.source_entry_id));
  const historicalEvidence = history?.evidence || [];
  const reviewCohort = historicalEvidence.includes('review_reject')
    ? 'blocked_historical_review_reject'
    : history ? 'evidence_upgrade_revalidation' : 'fresh';
  const status = anchorChecks.length === 0
    ? 'no_english_anchor'
    : anchorChecks.some((check) => !check.matched)
      ? 'missing_ejdict_anchor'
      : anchorChecks.some((check) => check.exact_hint_intersections.length === 0)
        ? 'anchor_without_exact_ja_hint'
        : sharedTerms.length !== 1
          ? sharedTerms.length === 0 ? 'no_shared_ja_hint' : 'multiple_shared_ja_hints'
          : 'qualified';
  return {
    candidate_key: row.candidate_key || `${row.source_entry_id}:${row.first_sense_id}`,
    word: row.word,
    source_lang: row.source_lang,
    frequency_rank: row.frequency_rank,
    english_hints: englishHints,
    japanese_hints: japaneseHints,
    shared_exact_japanese_terms: sharedTerms,
    status,
    review_cohort: reviewCohort,
    historical_evidence: historicalEvidence,
    historical_attempts: history?.attempts || 0,
    anchor_checks: anchorChecks,
    candidate: row
  };
});
const selected = assessed.filter((row) =>
  row.status === 'qualified' && row.review_cohort !== 'blocked_historical_review_reject'
);
const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  policy: {
    exact_english_anchor: true,
    exact_japanese_hint_intersection: true,
    every_english_hint_must_support_same_single_japanese_hint: true,
    historical_review_rejects_excluded: true,
    model_review_required_after_gate: true,
    product_database_write: false
  },
  source_report: relative(reportPath),
  source_dir: relative(sourceDir),
  history_report: historyPath ? relative(historyPath) : null,
  summary: {
    input_rows: rows.length,
    qualified_rows: selected.length,
    qualified_fresh_rows: selected.filter((row) => row.review_cohort === 'fresh').length,
    qualified_revalidation_rows: selected.filter((row) => row.review_cohort === 'evidence_upgrade_revalidation').length,
    blocked_historical_review_rejects: assessed.filter((row) =>
      row.status === 'qualified' && row.review_cohort === 'blocked_historical_review_reject'
    ).length,
    statuses: countBy(assessed, (row) => row.status)
  },
  selected,
  assessed
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out: relative(outPath), ...output.summary }, null, 2));

function extractJapaneseTerms(value) {
  const parts = [];
  const cleaned = String(value || '').normalize('NFKC');
  for (const segment of cleaned.split(/\s*\/\s*/u)) {
    parts.push(...segment
      .replace(/\([^)]*\)/gu, ' ')
      .split(/[;,、，；]/u));
  }
  return new Set(parts.map(cleanJapanese).filter((term) =>
    term.length >= 2 && term.length <= 30 &&
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(term) &&
    !/[A-Za-z]/u.test(term)
  ));
}

function hintTerms(row, lang) {
  return unique((row.generation_hints?.[lang]?.terms || [])
    .map((value) => String(value).trim()).filter(Boolean));
}

function intersect(groups) {
  if (!groups.length) return [];
  let values = new Set(groups[0]);
  for (const group of groups.slice(1)) {
    const current = new Set(group);
    values = new Set([...values].filter((value) => current.has(value)));
  }
  return [...values];
}

function cleanEnglish(value) {
  return String(value || '').replace(/^=+/u, '').replace(/\[[^\]]*\]/gu, '').trim();
}

function cleanJapanese(value) {
  return String(value || '').normalize('NFKC').trim().replace(/^[…・]+|[。?!？！…・]+$/gu, '').replace(/\s+/gu, ' ');
}

function normalizeEnglish(value) {
  return cleanEnglish(value).normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/gu, ' ');
}

function normalizeJapanese(value) {
  return cleanJapanese(value).toLocaleLowerCase('ja');
}

function unique(values) { return [...new Set(values)]; }

function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = selector(row);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function requiredPath(value) {
  if (!value) throw new Error('Missing required path argument');
  const result = path.resolve(value);
  if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`);
  return result;
}

function requiredDirectory(value) {
  const result = requiredPath(value);
  if (!fs.statSync(result).isDirectory()) throw new Error(`Not a directory: ${result}`);
  return result;
}

function relative(value) { return path.relative(process.cwd(), value); }

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) { out[key] = next; index += 1; }
    else out[key] = true;
  }
  return out;
}
