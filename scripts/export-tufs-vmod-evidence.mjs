#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as OpenCC from 'opencc-js';

const args = parseArgs(process.argv.slice(2));
const conceptsPath = requiredPath(args.concepts || '.tmp/tufs-vmod/tufs-vmod-concepts.jsonl');
const reportPath = requiredPath(args.report);
const outPath = path.resolve(args.out || '.tmp/tufs-vmod/tufs-vmod-candidate-evidence.db');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const validations = report.validations || report.selected || [];
const concepts = fs.readFileSync(conceptsPath, 'utf8').split(/\r?\n/u).filter(Boolean).map(JSON.parse);
const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });
const conceptsBySourceTerm = new Map();

for (const concept of concepts) {
  for (const [lang, terms] of Object.entries(concept.terms || {})) {
    for (const term of terms) {
      const key = `${lang}\0${normalizeTerm(term, lang)}`;
      if (!conceptsBySourceTerm.has(key)) conceptsBySourceTerm.set(key, []);
      conceptsBySourceTerm.get(key).push(concept);
    }
  }
}

const matches = [];
const ambiguous = [];
for (const candidate of validations) {
  const anchor = candidate.evidence?.anchor || candidate.english_anchor || candidate.gloss || '';
  const sourceKey = `${candidate.source_lang}\0${normalizeTerm(candidate.word, candidate.source_lang)}`;
  const sourceMatches = conceptsBySourceTerm.get(sourceKey) || [];
  const aligned = uniqueBy(
    sourceMatches.filter((concept) => englishMatches(anchor, concept.terms?.en || [])),
    (concept) => concept.concept_id
  );
  if (aligned.length !== 1) {
    if (sourceMatches.length) ambiguous.push({
      candidate_key: candidate.candidate_key,
      word: candidate.word,
      source_lang: candidate.source_lang,
      english_anchor: anchor,
      source_concepts: sourceMatches.map((concept) => concept.concept_id),
      aligned_concepts: aligned.map((concept) => concept.concept_id)
    });
    continue;
  }
  matches.push({ candidate, anchor, concept: aligned[0] });
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.rmSync(outPath, { force: true });
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
  CREATE TABLE tufs_vmod_candidate_provenance (
    candidate_key TEXT NOT NULL, source_key TEXT NOT NULL,
    source_entry_id INTEGER NOT NULL, source_sense_id INTEGER NOT NULL,
    source_lang TEXT NOT NULL, source_term TEXT NOT NULL,
    tufs_concept_id TEXT NOT NULL, english_anchor TEXT NOT NULL,
    target_lang TEXT NOT NULL, target_term TEXT NOT NULL,
    PRIMARY KEY(candidate_key, tufs_concept_id, target_lang, target_term)
  );
`);

const sourceHash = sha256Files([conceptsPath, reportPath]);
const sourceKey = `tufs-vmod-ccby4-${sourceHash.slice(0, 12)}`;
db.prepare('INSERT INTO evidence_sources VALUES (?, ?, ?, ?, ?, ?)').run(
  sourceKey,
  'tufs-vmod',
  'multi',
  'TUFS Language Modules basic vocabulary, exact classified_id alignment and candidate-bound English sense match',
  'CC-BY-4.0',
  JSON.stringify({
    authority: 'Tokyo University of Foreign Studies',
    source_url: 'https://www.coelang.tufs.ac.jp/mt/vmod/',
    license_url: 'https://malindo.aa-ken.jp/TUFSOpenLgResources.html',
    source_sha256: sha256File(conceptsPath),
    report_sha256: sha256File(reportPath),
    alignment: 'exact shared classified_id plus exact normalized source term and English sense overlap',
    candidate_bound: true,
    production_publishable: true,
    chinese_policy: 'official Mandarin module; Simplified Chinese normalization for matching',
    portuguese_policy: 'official Brazilian Portuguese module'
  })
);

const insertEvidence = db.prepare(`
  INSERT OR IGNORE INTO lexical_evidence
    (source_key, source_family, lang, term, normalized_key,
     english_gloss, english_normalized_key, concept_id)
  VALUES (?, 'tufs-vmod', ?, ?, ?, ?, ?, ?)
`);
const insertProvenance = db.prepare(`
  INSERT OR IGNORE INTO tufs_vmod_candidate_provenance
    (candidate_key, source_key, source_entry_id, source_sense_id,
     source_lang, source_term, tufs_concept_id, english_anchor,
     target_lang, target_term)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

db.transaction(() => {
  for (const { candidate, anchor, concept } of matches) {
    const candidateConceptId = `candidate:${candidate.candidate_key}`;
    for (const [lang, terms] of Object.entries(concept.terms || {})) {
      for (const term of terms) {
        insertEvidence.run(
          sourceKey,
          lang,
          term,
          normalizeTerm(term, lang),
          anchor,
          normalizeEnglish(anchor),
          candidateConceptId
        );
        insertProvenance.run(
          candidate.candidate_key,
          sourceKey,
          Number(candidate.source_entry_id),
          Number(candidate.source_sense_id),
          candidate.source_lang,
          candidate.word,
          concept.concept_id,
          anchor,
          lang,
          term
        );
      }
    }
  }
})();

db.pragma('journal_mode = DELETE');
const integrity = db.pragma('integrity_check', { simple: true });
const counts = {
  input_candidates: validations.length,
  tufs_concepts: concepts.length,
  exact_unique_candidate_matches: matches.length,
  ambiguous_or_unaligned_source_matches: ambiguous.length,
  lexical_evidence: db.prepare('SELECT COUNT(*) count FROM lexical_evidence').get().count,
  candidates_with_evidence: db.prepare('SELECT COUNT(DISTINCT candidate_key) count FROM tufs_vmod_candidate_provenance').get().count,
  by_lang: db.prepare('SELECT lang, COUNT(*) rows FROM lexical_evidence GROUP BY lang ORDER BY lang').all()
};
db.close();

const auditPath = outPath.replace(/\.db$/iu, '.audit.json');
fs.writeFileSync(auditPath, `${JSON.stringify({
  ok: integrity === 'ok', integrity, source_key: sourceKey, counts, ambiguous
}, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: integrity === 'ok', integrity, out: relative(outPath), audit: relative(auditPath), counts }, null, 2));

function englishMatches(anchor, terms) {
  const anchors = splitEnglish(anchor);
  const normalizedTerms = terms.flatMap(splitEnglish);
  return anchors.some((left) => normalizedTerms.some((right) => left === right));
}
function splitEnglish(value) {
  return String(value || '').split(/[;|/]/u).map(normalizeEnglish).filter(Boolean);
}
function normalizeEnglish(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function normalizeTerm(value, lang) {
  const text = lang === 'zh' ? toSimplified(String(value || '')) : String(value || '');
  return text.normalize('NFKC').toLowerCase().trim().replace(/\s+/gu, ' ');
}
function uniqueBy(values, keyOf) {
  const seen = new Set();
  return values.filter((value) => {
    const key = keyOf(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
function sha256Files(files) {
  const hash = crypto.createHash('sha256');
  for (const file of files) hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}
function requiredPath(value) {
  const resolved = path.resolve(String(value || ''));
  if (!value || !fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  return resolved;
}
function relative(filePath) { return path.relative(process.cwd(), filePath); }
function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) { parsed[key] = next; index += 1; }
    else parsed[key] = true;
  }
  return parsed;
}
