#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';

const args = parseArgs(process.argv.slice(2));
const candidatesPath = requiredPath(args.candidates || 'logs/product-coverage-gaps-v95-naer141-moj-mainland-first-aligned.json');
const evidencePath = requiredPath(args.evidence || 'logs/product-coverage-gaps-v97-northeuralex-mainland-first-strict-evidence.json');
const handedictPath = requiredPath(args.handedict || 'data/raw/handedict/handedict.u8');
const freedictPath = requiredPath(args.freedict || 'data/raw/freedict-eng-deu/eng-deu/eng-deu.tei');
const outPath = path.resolve(args.out || 'logs/product-source-gap-v97-handedict-freedict-de-pivot-probe.json');

const candidateReport = readJson(candidatesPath);
const evidenceReport = readJson(evidencePath);
const candidates = Array.isArray(candidateReport.selected) ? candidateReport.selected : [];
const evidenceByKey = new Map((evidenceReport.validations || []).map((row) => [String(row.candidate_key), row]));
const englishToGerman = parseFreeDictEnglishGerman(freedictPath);
const germanToChinese = parseHanDeDict(handedictPath);
const matches = [];

for (const candidate of candidates) {
  const candidateKey = String(candidate.candidate_key || `${candidate.source_entry_id}:${candidate.first_sense_id}`);
  const evidence = evidenceByKey.get(candidateKey);
  if (!evidence || evidence.decision === 'supported') continue;
  const anchor = normalizeEnglish(evidence?.evidence?.anchor || candidate.gloss_key);
  const germanTerms = englishToGerman.get(anchor);
  if (!anchor || !germanTerms?.size) continue;
  const chinese = new Map();
  for (const german of germanTerms) {
    for (const row of germanToChinese.get(german) || []) {
      const key = normalizeHan(row.simplified);
      if (!key) continue;
      const current = chinese.get(key) || { ...row, german_matches: new Set() };
      current.german_matches.add(german);
      chinese.set(key, current);
    }
  }
  if (!chinese.size) continue;
  const terms = [...chinese.values()].map((row) => ({
    ...row,
    german_matches: [...row.german_matches].sort()
  }));
  const sourceMatches = candidate.source_lang === 'zh'
    ? terms.filter((row) => normalizeHan(row.simplified) === normalizeHan(candidate.word) || normalizeHan(row.traditional) === normalizeHan(candidate.word))
    : [];
  const decision = candidate.source_lang === 'zh'
    ? (sourceMatches.length ? 'source_term_exact' : 'source_term_mismatch')
    : (terms.length === 1 ? 'unique_target_term' : 'ambiguous_target_terms');
  const existingFamilies = [...new Set(evidence?.evidence?.matching_source_families || [])].sort();
  const eligibleReason = new Set([
    'insufficient_independent_target_evidence',
    'no_strong_reverse_dictionary_evidence',
    'existing_localization_does_not_round_trip'
  ]).has(evidence.reason);
  const secondFamilyCandidate =
    (decision === 'source_term_exact' || decision === 'unique_target_term') &&
    existingFamilies.length >= 1 && eligibleReason;
  matches.push({
    candidate_key: candidateKey,
    source_entry_id: candidate.source_entry_id,
    source_sense_id: candidate.first_sense_id,
    word: candidate.word,
    source_lang: candidate.source_lang,
    frequency_rank: candidate.frequency_rank,
    english_anchor: anchor,
    decision,
    previous_decision: evidence.decision,
    previous_reason: evidence.reason,
    existing_source_families: existingFamilies,
    source_family: 'handedict-freedict-de-pivot',
    publication_evidence: secondFamilyCandidate,
    second_family_candidate: secondFamilyCandidate,
    german_terms: [...germanTerms].sort(),
    terms,
    source_matches: sourceMatches
  });
}

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  inputs: { candidates: relative(candidatesPath), evidence: relative(evidencePath), handedict: relative(handedictPath), freedict: relative(freedictPath) },
  provenance: {
    handedict: { family: 'handedict', license: 'CC-BY-SA-3.0', snapshot: '2026-08-14' },
    freedict: { family: 'freedict-tu-chemnitz', license: 'GPL-2.0-or-later', version: 'eng-deu 1.9' },
    pivot_family: 'handedict-freedict-de-pivot',
    policy: 'exact normalized English headword and German translation equality; probe only; inherited CEDICT provenance requires review before family admission'
  },
  summary: {
    input_candidates: candidates.length,
    english_headwords: englishToGerman.size,
    german_translation_keys: germanToChinese.size,
    matched_candidates: matches.length,
    by_decision: countBy(matches, (row) => row.decision),
    publication_evidence_candidates: matches.filter((row) => row.publication_evidence).length,
    by_source_lang: countBy(matches, (row) => row.source_lang)
  },
  matches
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary: output.summary }, null, 2));

function parseFreeDictEnglishGerman(filePath) {
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, trimValues: true });
  const document = parser.parse(fs.readFileSync(filePath, 'utf8'));
  const result = new Map();
  for (const entry of asArray(document?.TEI?.text?.body?.entry)) {
    const english = normalizeEnglish(textValue(entry?.form?.orth));
    if (!english) continue;
    const translations = new Set();
    for (const sense of asArray(entry.sense)) for (const citation of asArray(sense?.cit)) {
      if (citation?.['@_type'] !== 'trans') continue;
      const term = normalizeGerman(textValue(citation.quote));
      if (term) translations.add(term);
    }
    if (translations.size) result.set(english, translations);
  }
  return result;
}

function parseHanDeDict(filePath) {
  const result = new Map();
  const pattern = /^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/$/u;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/u)) {
    if (!line || line.startsWith('#')) continue;
    const match = pattern.exec(line);
    if (!match) continue;
    const [, traditional, simplified, pinyin, rawDefinitions] = match;
    for (const raw of rawDefinitions.split('/')) {
      const german = normalizeGerman(raw);
      if (!german || german.length < 2) continue;
      const rows = result.get(german) || [];
      rows.push({ traditional, simplified, pinyin });
      result.set(german, rows);
    }
  }
  return result;
}

function normalizeEnglish(value) { return String(value || '').normalize('NFKC').toLocaleLowerCase('en').split(/[;|]/u)[0].replace(/^en:\s*/u, '').replace(/\s+/gu, ' ').trim(); }
function normalizeGerman(value) { return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase('de').replace(/\([^)]*\)/gu, ' ').replace(/^(der|die|das|ein|eine)\s+/u, '').replace(/[^\p{L}\p{N}' -]+/gu, ' ').replace(/\s+/gu, ' ').trim(); }
function normalizeHan(value) { return String(value || '').normalize('NFKC').replace(/\s+/gu, '').trim(); }
function textValue(value) { if (typeof value === 'string' || typeof value === 'number') return String(value); if (value && typeof value === 'object' && '#text' in value) return String(value['#text']); return ''; }
function asArray(value) { return value == null ? [] : Array.isArray(value) ? value : [value]; }
function countBy(rows, selector) { const counts = {}; for (const row of rows) { const key = String(selector(row)); counts[key] = (counts[key] || 0) + 1; } return counts; }
function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
function requiredPath(value) { const resolved = path.resolve(value); if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`); return resolved; }
function relative(filePath) { return path.relative(process.cwd(), filePath); }
function parseArgs(argv) { const parsed = {}; for (let index = 0; index < argv.length; index++) { if (!argv[index].startsWith('--')) continue; const key = argv[index].slice(2); const next = argv[index + 1]; parsed[key] = next && !next.startsWith('--') ? argv[++index] : 'true'; } return parsed; }
