#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import csv from 'csv-parser';

const args = parseArgs(process.argv.slice(2));
const unresolvedPath = requiredPath(args.unresolved, 'unresolved');
const candidatesPath = requiredPath(args.candidates, 'candidates');
const lexiconPath = requiredPath(
  args.lexicon || 'data/raw/government-lexicons/japan-legal-terms-v19.csv',
  'lexicon'
);
const outPath = requiredPath(args.out, 'out', false);

const unresolvedReport = readJson(unresolvedPath);
const candidateReport = readJson(candidatesPath);
const candidateByKey = new Map(
  (candidateReport.selected || []).map((row) => [candidateKey(row), row])
);
const unresolved = unresolvedReport.unresolved || unresolvedReport.jmdict_preflight_rejected || [];
const legalTerms = await loadLegalTerms(lexiconPath);
const selected = [];
const remaining = [];

for (const row of unresolved) {
  const candidate = candidateByKey.get(candidateKey(row));
  const jaTerm = String(row.ja_term || candidate?.candidate_evidence_review?.preferred_terms?.ja || '').trim();
  const englishAnchor = String(candidate?.candidate_evidence_review?.english_anchor || '').trim();
  const stem = jaTerm.endsWith('する') ? jaTerm.slice(0, -2) : '';
  const matches = stem
    ? (legalTerms.get(stem) || []).filter((item) => englishDerivationMatches(englishAnchor, item.english))
    : [];
  const readings = unique(matches.map((item) => `${item.reading}する`).filter(Boolean));
  if (candidate && readings.length === 1) {
    selected.push({
      ...candidate,
      generation_contract: {
        ...(candidate.generation_contract || {}),
        ja_term: jaTerm,
        ja_reading: readings[0],
        ja_reading_variants: readings,
        ja_reading_source: 'deterministic:japan-moj-legal-term-suru',
        ja_reading_evidence: matches
      }
    });
  } else {
    remaining.push({ ...row, japan_moj_matches: matches, japan_moj_readings: readings });
  }
}

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  derived_from: {
    unresolved_report: relative(unresolvedPath),
    candidate_report: relative(candidatesPath),
    lexicon: relative(lexiconPath)
  },
  policy: {
    authority: 'Ministry of Justice, Japan',
    license: 'Public Data License 1.0',
    exact_japanese_legal_term_stem: true,
    require_suru_derivation: true,
    english_exact_or_ate_ation_derivation: true,
    product_database_write: false
  },
  summary: {
    input_unresolved: unresolved.length,
    indexed_legal_terms: legalTerms.size,
    selected: selected.length,
    unresolved: remaining.length
  },
  selected_count: selected.length,
  selected,
  unresolved: remaining
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out: relative(outPath), ...output.summary }, null, 2));

async function loadLegalTerms(filePath) {
  const result = new Map();
  const stream = fs.createReadStream(filePath).pipe(csv({ headers: false }));
  for await (const row of stream) {
    const term = String(row[0] || '').normalize('NFKC').trim();
    const reading = String(row[1] || '').normalize('NFKC').trim();
    const english = String(row[3] || '').normalize('NFKC').trim();
    if (!term || !reading || !english) continue;
    if (!result.has(term)) result.set(term, []);
    result.get(term).push({ term, reading, english });
  }
  return result;
}

function englishDerivationMatches(anchor, officialTerm) {
  const left = normalizeEnglish(anchor);
  const right = normalizeEnglish(officialTerm);
  if (!left || !right) return false;
  if (left === right) return true;
  return left.endsWith('ate') && `${left.slice(0, -1)}ion` === right;
}

function normalizeEnglish(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/gu, ' ').trim();
}

function candidateKey(row) {
  return `${Number(row?.source_entry_id ?? row?.output?.source_entry_id)}:${Number(
    row?.first_sense_id ?? row?.source_sense_id ?? row?.output?.source_sense_id
  )}`;
}

function unique(values) {
  return [...new Set(values)];
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function relative(value) {
  return path.relative(process.cwd(), value);
}

function requiredPath(value, name, mustExist = true) {
  if (!value) throw new Error(`Missing --${name}`);
  const result = path.resolve(value);
  if (mustExist && !fs.existsSync(result)) throw new Error(`File not found: ${result}`);
  return result;
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    out[key] = next && !next.startsWith('--') ? argv[++index] : true;
  }
  return out;
}
