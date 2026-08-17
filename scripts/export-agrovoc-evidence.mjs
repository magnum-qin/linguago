#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as OpenCC from 'opencc-js';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(
  args.report || 'logs/product-source-gap-v97-agrovoc-top3000-probe.json'
);
const outPath = path.resolve(args.out || '.tmp/agrovoc/agrovoc-v97-evidence.db');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const reportHash = sha256File(reportPath);
const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });

fs.mkdirSync(path.dirname(outPath), { recursive: true });
if (fs.existsSync(outPath)) fs.rmSync(outPath);
const db = new Database(outPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE evidence_sources (
    source_key TEXT PRIMARY KEY, source_family TEXT NOT NULL, lang TEXT NOT NULL,
    lexicon_spec TEXT NOT NULL, license TEXT NOT NULL, metadata_json TEXT NOT NULL
  );
  CREATE TABLE lexical_evidence (
    id INTEGER PRIMARY KEY, source_key TEXT NOT NULL, source_family TEXT NOT NULL,
    lang TEXT NOT NULL, term TEXT NOT NULL, normalized_key TEXT NOT NULL,
    english_gloss TEXT NOT NULL, english_normalized_key TEXT NOT NULL,
    concept_id TEXT NOT NULL,
    UNIQUE(source_key, lang, normalized_key, english_gloss, concept_id)
  );
  CREATE INDEX idx_lexical_evidence_lookup ON lexical_evidence(lang, normalized_key);
  CREATE INDEX idx_lexical_evidence_english ON lexical_evidence(lang, english_normalized_key);
  CREATE TABLE agrovoc_candidate_provenance (
    candidate_key TEXT NOT NULL, source_key TEXT NOT NULL, lang TEXT NOT NULL,
    normalized_key TEXT NOT NULL, english_normalized_key TEXT NOT NULL,
    concept_id TEXT NOT NULL, original_term TEXT NOT NULL,
    simplified_term TEXT NOT NULL, target_bound INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(candidate_key, source_key, lang, normalized_key, english_normalized_key, concept_id)
  );
`);

const sourceKey = `agrovoc-fao-current-${reportHash.slice(0, 12)}`;
const metadata = {
  authority: 'Food and Agriculture Organization of the United Nations',
  dataset_url: 'https://agrovoc.fao.org/',
  endpoint: report.source?.endpoint || 'https://agrovoc.fao.org/sparql',
  domain: report.source?.domain || 'agriculture, food, environment, and related sciences',
  candidate_bound: true,
  concept_bound_multilingual_labels: true,
  production_publishable: true,
  mainland_policy: 'official_fao_chinese_then_opencc_tw_to_cn',
  scientific_name_filter: 'conservative_binomial_and_ascii_target_filter',
  report_sha256: reportHash
};
db.prepare('INSERT INTO evidence_sources VALUES (?, ?, ?, ?, ?, ?)').run(
  sourceKey,
  'agrovoc',
  'multi',
  'FAO AGROVOC exact-English-label, concept-bound candidate subset',
  report.source?.license || 'CC BY IGO 3.0',
  JSON.stringify(metadata)
);

const insertEvidence = db.prepare(`
  INSERT OR IGNORE INTO lexical_evidence
    (source_key, source_family, lang, term, normalized_key,
     english_gloss, english_normalized_key, concept_id)
  VALUES (?, 'agrovoc', ?, ?, ?, ?, ?, ?)
`);
const insertProvenance = db.prepare(`
  INSERT OR IGNORE INTO agrovoc_candidate_provenance
    (candidate_key, source_key, lang, normalized_key, english_normalized_key,
     concept_id, original_term, simplified_term, target_bound)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
`);

const rejected = new Map();
let convertedChineseTerms = 0;
let candidateBindings = 0;
const acceptedCandidates = new Set();

db.transaction(() => {
  for (const match of report.selected || []) {
    const lang = match.target_lang;
    if (!['zh', 'ja', 'pt-BR'].includes(lang)) continue;
    const english = String(match.matched_english_anchor || match.english_anchor || '').trim();
    const englishNormalized = normalize(english);
    const conceptId = String(match.agrovoc_concept || '').trim();
    if (!englishNormalized || !conceptId || looksScientificName(english)) {
      reject('scientific_or_invalid_english_anchor');
      continue;
    }

    for (const original of match.target_terms || []) {
      const cleaned = cleanTargetTerm(original, lang);
      if (!cleaned.ok) {
        reject(cleaned.reason);
        continue;
      }
      if (lang === 'zh' && cleaned.term !== String(original).trim()) convertedChineseTerms += 1;
      const normalizedTerm = normalize(cleaned.term);
      const result = insertEvidence.run(
        sourceKey,
        lang,
        cleaned.term,
        normalizedTerm,
        english,
        englishNormalized,
        conceptId
      );
      insertProvenance.run(
        match.candidate_key,
        sourceKey,
        lang,
        normalizedTerm,
        englishNormalized,
        conceptId,
        String(original).trim(),
        cleaned.term
      );
      if (result.changes) candidateBindings += 1;
      acceptedCandidates.add(match.candidate_key);
    }
  }
})();

db.pragma('journal_mode = DELETE');
const integrity = db.pragma('integrity_check', { simple: true });
const counts = {
  lexical_evidence: db.prepare('SELECT COUNT(*) count FROM lexical_evidence').get().count,
  candidate_bindings: db.prepare('SELECT COUNT(*) count FROM agrovoc_candidate_provenance').get().count,
  accepted_candidates: acceptedCandidates.size,
  converted_chinese_terms: convertedChineseTerms,
  by_lang: db.prepare('SELECT lang, COUNT(*) rows FROM lexical_evidence GROUP BY lang ORDER BY lang').all(),
  rejected: Object.fromEntries([...rejected].sort())
};
db.close();
console.log(JSON.stringify({ ok: integrity === 'ok', integrity, out: relative(outPath), source_key: sourceKey, counts }, null, 2));

function cleanTargetTerm(value, lang) {
  let term = String(value || '').normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!term || /<[^>]+>|&(?:#\d+|#x[\da-f]+|\w+);/iu.test(term)) {
    return { ok: false, reason: 'empty_or_html' };
  }
  if (lang === 'zh') {
    if (!/\p{Script=Han}/u.test(term)) return { ok: false, reason: 'zh_without_han' };
    term = toSimplified(term);
  } else if (lang === 'ja') {
    if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(term)) {
      return { ok: false, reason: 'ja_without_japanese_script' };
    }
  } else if (/^[\p{Script=Latin}\s.'’-]+$/u.test(term) && looksScientificName(term)) {
    return { ok: false, reason: 'pt_scientific_name' };
  }
  if (/^[\x00-\x7F]+$/.test(term)) return { ok: false, reason: 'ascii_target' };
  return { ok: true, term };
}

function looksScientificName(value) {
  const text = String(value || '').trim();
  return /^[A-Z][a-z]{2,}(?:\s+[a-z][a-z-]{2,}){1,2}$/.test(text) ||
    /\b(?:sp\.|spp\.|subsp\.|var\.)\b/i.test(text);
}

function reject(reason) {
  rejected.set(reason, (rejected.get(reason) || 0) + 1);
}
function normalize(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ');
}
function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
function requiredPath(value) {
  const resolved = path.resolve(String(value || ''));
  if (!value || !fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  return resolved;
}
function relative(filePath) {
  return path.relative(process.cwd(), filePath);
}
function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const value = argv[index + 1];
    if (value && !value.startsWith('--')) {
      parsed[key] = value;
      index += 1;
    } else parsed[key] = true;
  }
  return parsed;
}
