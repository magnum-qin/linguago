#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';

const args = parseArgs(process.argv.slice(2));
const candidatesPath = requiredPath(
  args.candidates || 'logs/product-coverage-gaps-v95-naer141-moj-mainland-first-aligned.json'
);
const evidencePath = requiredPath(
  args.evidence || 'logs/product-coverage-gaps-v97-northeuralex-mainland-first-strict-evidence.json'
);
const cfdictPath = requiredPath(args.cfdict || 'data/raw/cfdict/CFDICT.txt');
const freedictPath = requiredPath(
  args.freedict || 'data/raw/freedict-eng-fra/eng-fra/eng-fra.tei'
);
const outPath = path.resolve(
  args.out || 'logs/product-source-gap-v97-cfdict-freedict-fr-pivot-probe.json'
);

const candidateReport = readJson(candidatesPath);
const evidenceReport = readJson(evidencePath);
const candidates = Array.isArray(candidateReport.selected) ? candidateReport.selected : [];
const evidenceByKey = new Map(
  (evidenceReport.validations || []).map((row) => [String(row.candidate_key), row])
);

const englishToFrench = parseFreeDictEnglishFrench(freedictPath);
const frenchToChinese = parseCfDict(cfdictPath);
const matches = [];

for (const candidate of candidates) {
  const candidateKey = String(candidate.candidate_key || `${candidate.source_entry_id}:${candidate.first_sense_id}`);
  const evidence = evidenceByKey.get(candidateKey);
  if (!evidence || evidence.decision === 'supported') continue;

  const anchor = normalizeEnglishAnchor(evidence?.evidence?.anchor || candidate.gloss_key);
  if (!anchor) continue;
  const frenchTerms = englishToFrench.get(anchor);
  if (!frenchTerms?.size) continue;

  const chinese = new Map();
  for (const french of frenchTerms) {
    for (const row of frenchToChinese.get(french) || []) {
      const key = normalizeHan(row.simplified);
      if (!key) continue;
      const current = chinese.get(key) || {
        simplified: row.simplified,
        traditional: row.traditional,
        pinyin: row.pinyin,
        french_matches: new Set()
      };
      current.french_matches.add(french);
      chinese.set(key, current);
    }
  }
  if (!chinese.size) continue;

  const terms = [...chinese.values()]
    .map((row) => ({ ...row, french_matches: [...row.french_matches].sort() }))
    .sort((left, right) => left.simplified.localeCompare(right.simplified, 'zh-Hans'));
  const sourceMatches = candidate.source_lang === 'zh'
    ? terms.filter((row) => normalizeHan(row.simplified) === normalizeHan(candidate.word) ||
        normalizeHan(row.traditional) === normalizeHan(candidate.word))
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
    existingFamilies.length >= 1 &&
    eligibleReason;

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
    source_family: 'cfdict-freedict-fr-pivot',
    publication_evidence: secondFamilyCandidate,
    second_family_candidate: secondFamilyCandidate,
    french_terms: [...frenchTerms].sort(),
    terms,
    source_matches: sourceMatches
  });
}

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  inputs: {
    candidates: relative(candidatesPath),
    evidence: relative(evidencePath),
    cfdict: relative(cfdictPath),
    freedict: relative(freedictPath)
  },
  provenance: {
    cfdict: {
      family: 'cfdict',
      source: 'Chine Informations CFDICT',
      license: 'CC-BY-SA-3.0',
      version: '2018-11-12'
    },
    freedict: {
      family: 'freedict-travlang',
      source: 'FreeDict eng-fra 0.1.6, originally Ergane/TravLang',
      license: 'GPL-2.0-or-later'
    },
    pivot_family: 'cfdict-freedict-fr-pivot',
    policy: 'exact normalized English headword and French translation equality; no model evidence'
  },
  summary: {
    input_candidates: candidates.length,
    english_headwords: englishToFrench.size,
    french_translation_keys: frenchToChinese.size,
    matched_candidates: matches.length,
    by_decision: countBy(matches, (row) => row.decision),
    publication_evidence_candidates: matches.filter((row) => row.publication_evidence).length,
    by_previous_reason: countBy(matches, (row) => row.previous_reason),
    by_source_lang: countBy(matches, (row) => row.source_lang)
  },
  matches
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary: output.summary }, null, 2));

function parseFreeDictEnglishFrench(filePath) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true
  });
  const document = parser.parse(fs.readFileSync(filePath, 'utf8'));
  const entries = asArray(document?.TEI?.text?.body?.entry);
  const result = new Map();
  for (const entry of entries) {
    const English = normalizeEnglishAnchor(textValue(entry?.form?.orth));
    if (!English) continue;
    const translations = new Set();
    for (const sense of asArray(entry.sense)) {
      for (const citation of asArray(sense?.cit)) {
        if (citation?.['@_type'] !== 'trans') continue;
        const normalized = normalizeFrench(textValue(citation.quote));
        if (normalized) translations.add(normalized);
      }
    }
    if (!translations.size) continue;
    const current = result.get(English) || new Set();
    for (const value of translations) current.add(value);
    result.set(English, current);
  }
  return result;
}

function parseCfDict(filePath) {
  const result = new Map();
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/u);
  const pattern = /^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/$/u;
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const match = pattern.exec(line);
    if (!match) continue;
    const [, traditional, simplified, pinyin, rawDefinitions] = match;
    for (const raw of rawDefinitions.split('/')) {
      const french = normalizeFrench(raw);
      if (!french || french.length < 2) continue;
      const rows = result.get(french) || [];
      rows.push({ traditional, simplified, pinyin });
      result.set(french, rows);
    }
  }
  return result;
}

function normalizeEnglishAnchor(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .split(/[;|]/u)[0]
    .replace(/^en:\s*/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeFrench(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('fr')
    .replace(/\([^)]*\)/gu, ' ')
    .replace(/[’']/gu, "'")
    .replace(/^((un|une|le|la|les|des|du|de la|de l')\s+)/u, '')
    .replace(/[^\p{L}\p{N}' -]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeHan(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/gu, '').trim();
}

function textValue(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && '#text' in value) return String(value['#text']);
  return '';
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = String(selector(row));
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    const next = argv[index + 1];
    result[name] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return result;
}

function requiredPath(value) {
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  return resolved;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function relative(filePath) {
  return path.relative(process.cwd(), filePath);
}
