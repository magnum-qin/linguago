#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import csv from 'csv-parser';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report);
const csvPath = requiredPath(args.csv || '.tmp/ecdict/ecdict-official.csv');
const outPath = path.resolve(args.out || 'logs/product-source-gap-ecdict-exact-hint-gate.json');
const historyPath = args.history ? requiredPath(args.history) : null;
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const rows = Array.isArray(report.selected) ? report.selected : [];
const historyByEntry = historyPath
  ? new Map((JSON.parse(fs.readFileSync(historyPath, 'utf8')).selected || [])
      .map((row) => [String(row.source_entry_id), row]))
  : new Map();
const anchors = new Set(rows.flatMap((row) => hintTerms(row, 'en').map(normalizeEnglish)));
const ecdictByAnchor = new Map();

await new Promise((resolve, reject) => {
  fs.createReadStream(csvPath)
    .pipe(csv())
    .on('data', (row) => {
      const anchor = normalizeEnglish(row.word);
      if (!anchors.has(anchor)) return;
      ecdictByAnchor.set(anchor, {
        word: String(row.word || '').trim(),
        translation: String(row.translation || '').normalize('NFKC').trim(),
        definition: String(row.definition || '').normalize('NFKC').trim(),
        chinese_terms: extractChineseTerms(row.translation)
      });
    })
    .on('end', resolve)
    .on('error', reject);
});

const assessed = rows.map((row) => {
  const englishHints = hintTerms(row, 'en');
  const chineseHints = hintTerms(row, 'zh');
  const chineseHintKeys = new Map(chineseHints.map((term) => [normalizeTarget(term), term]));
  const anchorChecks = englishHints.map((anchor) => {
    const record = ecdictByAnchor.get(normalizeEnglish(anchor));
    const intersections = record
      ? record.chinese_terms.filter((term) => chineseHintKeys.has(normalizeTarget(term)))
      : [];
    return {
      anchor,
      matched: Boolean(record),
      chinese_terms: record?.chinese_terms || [],
      exact_hint_intersections: unique(intersections),
      translation: record?.translation || null,
      definition: record?.definition || null
    };
  });
  const sharedKeys = intersect(anchorChecks.map((check) =>
    check.exact_hint_intersections.map(normalizeTarget)
  ));
  const sharedTerms = sharedKeys.map((key) => chineseHintKeys.get(key) || key);
  const status = anchorChecks.length === 0
    ? 'no_english_anchor'
    : anchorChecks.some((check) => !check.matched)
      ? 'missing_ecdict_anchor'
      : anchorChecks.some((check) => check.exact_hint_intersections.length === 0)
        ? 'anchor_without_exact_zh_hint'
        : sharedTerms.length !== 1
          ? sharedTerms.length === 0 ? 'no_shared_zh_hint' : 'multiple_shared_zh_hints'
          : 'qualified';
  const history = historyByEntry.get(String(row.source_entry_id));
  const historicalEvidence = history?.evidence || [];
  const reviewCohort = historicalEvidence.includes('review_reject')
    ? 'blocked_historical_review_reject'
    : history
      ? 'evidence_upgrade_revalidation'
      : 'fresh';
  return {
    candidate_key: row.candidate_key || `${row.source_entry_id}:${row.first_sense_id}`,
    word: row.word,
    source_lang: row.source_lang,
    frequency_rank: row.frequency_rank,
    part_of_speech: row.part_of_speech,
    english_hints: englishHints,
    chinese_hints: chineseHints,
    shared_exact_chinese_terms: sharedTerms,
    status,
    review_cohort: reviewCohort,
    historical_evidence: historicalEvidence,
    historical_attempts: history?.attempts || 0,
    anchor_checks: anchorChecks,
    candidate: row
  };
});

const qualified = assessed.filter((row) =>
  row.status === 'qualified' && row.review_cohort !== 'blocked_historical_review_reject'
);
const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  policy: {
    exact_english_anchor: true,
    exact_chinese_hint_intersection: true,
    every_english_hint_must_support_same_single_chinese_hint: true,
    model_review_required_after_gate: true,
    product_database_write: false
  },
  source_report: relative(reportPath),
  history_report: historyPath ? relative(historyPath) : null,
  ecdict_csv: relative(csvPath),
  summary: {
    input_rows: rows.length,
    qualified_rows: qualified.length,
    qualified_fresh_rows: qualified.filter((row) => row.review_cohort === 'fresh').length,
    qualified_revalidation_rows: qualified.filter((row) => row.review_cohort === 'evidence_upgrade_revalidation').length,
    blocked_historical_review_rejects: assessed.filter((row) =>
      row.status === 'qualified' && row.review_cohort === 'blocked_historical_review_reject'
    ).length,
    statuses: countBy(assessed, (row) => row.status)
  },
  selected: qualified,
  assessed
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out: relative(outPath), ...output.summary }, null, 2));

function hintTerms(row, lang) {
  return unique((row.generation_hints?.[lang]?.terms || []).map((value) => String(value).trim()).filter(Boolean));
}

function extractChineseTerms(value) {
  const terms = new Set();
  const segments = String(value || '').normalize('NFKC').split(/[\n,，;；、|/]+/u);
  for (const segment of segments) {
    const cleaned = segment
      .replace(/\[[^\]]*\]/gu, ' ')
      .replace(/\([^)]*\)/gu, ' ')
      .replace(/(?:^|\s)(?:n|v|vt|vi|a|adj|adv|prep|pron|conj|num|int)\./giu, ' ');
    for (const match of cleaned.matchAll(/(?<![\p{Script=Han}\p{Letter}\p{Number}])[\p{Script=Han}]{2,12}(?![\p{Script=Han}\p{Letter}\p{Number}])/gu)) {
      terms.add(match[0]);
    }
  }
  return [...terms];
}

function intersect(groups) {
  if (groups.length === 0) return [];
  let values = new Set(groups[0]);
  for (const group of groups.slice(1)) {
    const current = new Set(group);
    values = new Set([...values].filter((value) => current.has(value)));
  }
  return [...values];
}

function normalizeEnglish(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en').replace(/\s+/gu, ' ');
}

function normalizeTarget(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('zh');
}

function unique(values) {
  return [...new Set(values)];
}

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

function relative(value) {
  return path.relative(process.cwd(), value);
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      index += 1;
    } else out[key] = true;
  }
  return out;
}
