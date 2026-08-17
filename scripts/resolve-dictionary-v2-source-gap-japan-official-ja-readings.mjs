#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const unresolvedPath = requiredPath(args.unresolved, 'unresolved');
const candidatesPath = requiredPath(args.candidates, 'candidates');
const evidencePath = requiredPath(
  args.evidence || 'config/dictionary-overrides/japan-official-reading-evidence-v98.json',
  'evidence'
);
const outPath = requiredPath(args.out, 'out', false);

const unresolvedReport = readJson(unresolvedPath);
const candidateReport = readJson(candidatesPath);
const evidenceReport = readJson(evidencePath);
const candidates = new Map((candidateReport.selected || []).map((row) => [candidateKey(row), row]));
const evidence = new Map((evidenceReport.entries || []).map((row) => [candidateKey(row), row]));
const selected = [];
const remaining = [];

for (const row of unresolvedReport.unresolved || []) {
  const key = candidateKey(row);
  const candidate = candidates.get(key);
  const locked = evidence.get(key);
  const jaTerm = String(row.ja_term || candidate?.candidate_evidence_review?.preferred_terms?.ja || '').trim();
  const englishAnchor = normalizeEnglish(candidate?.candidate_evidence_review?.english_anchor);
  if (!candidate || !locked || !exactMatch(row, jaTerm, englishAnchor, locked)) {
    remaining.push({ ...row, official_reading_match: locked || null });
    continue;
  }
  const variants = unique([locked.primary_reading, ...(locked.reading_variants || [])]);
  selected.push({
    ...candidate,
    generation_contract: {
      ...(candidate.generation_contract || {}),
      ja_term: locked.ja_term,
      ja_reading: locked.primary_reading,
      ja_reading_variants: variants,
      ja_reading_source: 'deterministic:japan-official-reading-evidence',
      ja_reading_evidence: [{
        authority: locked.authority,
        source_title: locked.source_title,
        source_url: locked.source_url,
        evidence_text: locked.evidence_text,
        match_rule: locked.match_rule,
        primary_reading: locked.primary_reading,
        reading_variants: variants
      }]
    }
  });
}

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  derived_from: {
    unresolved_report: relative(unresolvedPath),
    candidate_report: relative(candidatesPath),
    evidence: relative(evidencePath),
    evidence_sha256: sha256(evidencePath)
  },
  policy: {
    exact_candidate_id: true,
    exact_source_word: true,
    exact_japanese_term: true,
    exact_english_anchor: true,
    preserve_official_reading_variants: true,
    automatic_expansion: false,
    product_database_write: false
  },
  summary: {
    input_unresolved: (unresolvedReport.unresolved || []).length,
    configured_evidence: evidence.size,
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

function exactMatch(row, jaTerm, englishAnchor, locked) {
  return Number(row.source_entry_id) === Number(locked.source_entry_id) &&
    Number(row.source_sense_id) === Number(locked.source_sense_id) &&
    normalize(row.word) === normalize(locked.source_word) &&
    normalize(jaTerm) === normalize(locked.ja_term) &&
    englishAnchor === normalizeEnglish(locked.english_anchor) &&
    nonEmpty(locked.primary_reading);
}

function candidateKey(row) {
  return `${Number(row?.source_entry_id ?? row?.output?.source_entry_id)}:${Number(
    row?.first_sense_id ?? row?.source_sense_id ?? row?.output?.source_sense_id
  )}`;
}

function normalize(value) {
  return String(value || '').normalize('NFKC').trim();
}

function normalizeEnglish(value) {
  return normalize(value).toLocaleLowerCase('en').replace(/\s+/gu, ' ');
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function unique(values) {
  return [...new Set(values.map(normalize).filter(Boolean))];
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
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
