#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as OpenCC from 'opencc-js';

const args = parseArgs(process.argv.slice(2));
const sourceDbPath = requiredPath(args['source-db'] || '.tmp/combined/v99-daily-evidence-v9.db');
const reportPath = requiredPath(args.report);
const outPath = path.resolve(args.out || '.tmp/word2word/word2word-reciprocal-candidate-evidence.db');
const maxTermsPerLanguage = positiveInteger(args['max-terms-per-language'], 1);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const candidates = candidateRows(report);
const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });
const pairCodes = { zh: 'zh_cn', ja: 'ja', 'pt-BR': 'pt_br' };
const desiredAnchors = new Set(
  candidates.flatMap((candidate) => splitEnglish(candidateAnchor(candidate)))
);

const sourceDb = new Database(sourceDbPath, { readonly: true, fileMustExist: true });
sourceDb.pragma('query_only = ON');
const forwardPairsByAnchor = new Map();
const reversePairs = new Set();
for (const row of sourceDb.prepare(`
  SELECT source_key, lang, term, normalized_key, english_normalized_key
  FROM lexical_evidence
  WHERE source_family = 'corpus_word2word'
`).iterate()) {
  if (!desiredAnchors.has(row.english_normalized_key) || !String(row.normalized_key || '').trim()) continue;
  const pairKey = `${row.lang}\0${row.english_normalized_key}\0${row.normalized_key}`;
  if (/^word2word-en-/u.test(row.source_key)) {
    const anchorKey = `${row.lang}\0${row.english_normalized_key}`;
    if (!forwardPairsByAnchor.has(anchorKey)) forwardPairsByAnchor.set(anchorKey, new Map());
    forwardPairsByAnchor.get(anchorKey).set(row.normalized_key, row.term);
  } else if (/-en$/u.test(row.source_key)) {
    reversePairs.add(pairKey);
  }
}

const accepted = [];
const rejected = [];
for (const candidate of candidates) {
  const anchors = splitEnglish(candidateAnchor(candidate));
  if (!anchors.length || !['en', ...Object.keys(pairCodes)].includes(candidate.source_lang)) continue;
  const concepts = [];
  for (const anchor of anchors) {
    const termsByLang = { en: [anchor] };
    let sourceIdentity = candidate.source_lang === 'en' &&
      normalizeEnglish(candidate.word) === normalizeEnglish(anchor);
    for (const lang of Object.keys(pairCodes)) {
      const terms = reciprocalTerms(lang, anchor);
      if (terms.length >= 1 && terms.length <= maxTermsPerLanguage) termsByLang[lang] = terms;
      if (
        lang === candidate.source_lang &&
        terms.some((term) => normalizeTerm(term, lang) === normalizeTerm(candidate.word, lang))
      ) {
        sourceIdentity = true;
      }
    }
    if (sourceIdentity && Object.keys(termsByLang).length >= 3) {
      concepts.push({ anchor, terms: termsByLang });
    }
  }
  if (concepts.length === 1) {
    accepted.push({ candidate, ...concepts[0] });
  } else {
    rejected.push({
      candidate_key: candidateKey(candidate),
      word: candidate.word,
      source_lang: candidate.source_lang,
      anchors,
      aligned_concepts: concepts
    });
  }
}
sourceDb.close();

fs.mkdirSync(path.dirname(outPath), { recursive: true });
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${outPath}${suffix}`, { force: true });
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
  CREATE TABLE word2word_reciprocal_candidate_provenance (
    candidate_key TEXT NOT NULL, source_key TEXT NOT NULL,
    source_entry_id INTEGER NOT NULL, source_sense_id INTEGER NOT NULL,
    source_lang TEXT NOT NULL, source_term TEXT NOT NULL,
    english_anchor TEXT NOT NULL, target_lang TEXT NOT NULL, target_term TEXT NOT NULL,
    PRIMARY KEY(candidate_key, target_lang, target_term)
  );
`);

const inputHash = crypto.createHash('sha256')
  .update(`${sha256Files([sourceDbPath, reportPath])}:max-terms=${maxTermsPerLanguage}`)
  .digest('hex');
const sourceKey = `word2word-reciprocal-candidate-${inputHash.slice(0, 12)}`;
db.prepare('INSERT INTO evidence_sources VALUES (?, ?, ?, ?, ?, ?)').run(
  sourceKey,
  'corpus_word2word',
  'multi',
  'kakaobrain/word2word OpenSubtitles2018; exact reciprocal top-3 candidate-bound subset',
  'Apache-2.0',
  JSON.stringify({
    derived_from: 'OpenSubtitles2018',
    source_database_sha256: sha256File(sourceDbPath),
    candidate_report_sha256: sha256File(reportPath),
    evidence_strength: 'exact_reciprocal_candidate_bound',
    candidate_bound: true,
    production_publishable: true,
    extraction_rule: `at most ${maxTermsPerLanguage} target terms for an exact English anchor in both translation directions`,
    max_terms_per_language: maxTermsPerLanguage,
    caveat: 'single corpus family; never counts as more than one independent family'
  })
);

const insertEvidence = db.prepare(`
  INSERT OR IGNORE INTO lexical_evidence
    (source_key, source_family, lang, term, normalized_key,
     english_gloss, english_normalized_key, concept_id)
  VALUES (?, 'corpus_word2word', ?, ?, ?, ?, ?, ?)
`);
const insertProvenance = db.prepare(`
  INSERT OR IGNORE INTO word2word_reciprocal_candidate_provenance
    (candidate_key, source_key, source_entry_id, source_sense_id,
     source_lang, source_term, english_anchor, target_lang, target_term)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
db.transaction(() => {
  for (const { candidate, anchor, terms } of accepted) {
    const key = candidateKey(candidate);
    const conceptId = `candidate:${key}`;
    for (const [lang, values] of Object.entries(terms)) {
      for (const term of values) {
        insertEvidence.run(
          sourceKey,
          lang,
          term,
          normalizeTerm(term, lang),
          anchor,
          normalizeEnglish(anchor),
          conceptId
        );
        insertProvenance.run(
          key,
          sourceKey,
          Number(candidate.source_entry_id),
          Number(candidate.first_sense_id ?? candidate.source_sense_id ?? candidate.source_entry_id),
          candidate.source_lang,
          candidate.word,
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
  input_candidates: candidates.length,
  max_terms_per_language: maxTermsPerLanguage,
  accepted_candidates: accepted.length,
  rejected_candidates: rejected.length,
  lexical_evidence: db.prepare('SELECT COUNT(*) count FROM lexical_evidence').get().count,
  by_source_lang: countBy(accepted, (row) => row.candidate.source_lang),
  by_target_lang: Object.fromEntries(
    db.prepare('SELECT lang, COUNT(*) rows FROM lexical_evidence GROUP BY lang ORDER BY lang')
      .all().map((row) => [row.lang, row.rows])
  )
};
db.close();

const auditPath = outPath.replace(/\.db$/iu, '.audit.json');
fs.writeFileSync(auditPath, `${JSON.stringify({
  ok: integrity === 'ok', integrity, source_key: sourceKey, counts,
  accepted: accepted.map(({ candidate, anchor, terms }) => ({
    candidate_key: candidateKey(candidate), word: candidate.word,
    source_lang: candidate.source_lang, english_anchor: anchor, terms
  })),
  rejected
}, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: integrity === 'ok', integrity, out: relative(outPath), audit: relative(auditPath), counts }, null, 2));

function reciprocalTerms(lang, anchor) {
  const normalizedAnchor = normalizeEnglish(anchor);
  const reciprocal = new Map();
  const candidatesForAnchor = forwardPairsByAnchor.get(`${lang}\0${normalizedAnchor}`) || new Map();
  for (const [normalizedTerm, term] of candidatesForAnchor) {
    const pairKey = `${lang}\0${normalizedAnchor}\0${normalizedTerm}`;
    if (!reversePairs.has(pairKey)) continue;
    if (!normalizedTerm || normalizedTerm === normalizedAnchor) continue;
    if (!reciprocal.has(normalizedTerm)) reciprocal.set(normalizedTerm, term);
  }
  return [...reciprocal.values()];
}
function candidateRows(value) {
  for (const key of ['selected', 'validations', 'candidates', 'rows']) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}
function candidateAnchor(candidate) {
  return candidate.evidence?.anchor || candidate.english_anchor || candidate.gloss_key || candidate.gloss_preview || '';
}
function candidateKey(candidate) {
  return String(candidate.candidate_key || `${candidate.source_entry_id}:${candidate.first_sense_id ?? candidate.source_sense_id ?? candidate.source_entry_id}`);
}
function splitEnglish(value) {
  return String(value || '').split(/[;|/]/u).map(normalizeEnglish).filter((item) => item.length >= 2);
}
function normalizeEnglish(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function normalizeTerm(value, lang) {
  const text = lang === 'zh' ? toSimplified(String(value || '')) : String(value || '');
  return text.normalize('NFKC').toLowerCase().trim().replace(/\s+/gu, ' ');
}
function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = selector(row);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}
function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
function sha256Files(files) {
  const hash = crypto.createHash('sha256');
  for (const filePath of files) hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}
function requiredPath(value) {
  const resolved = path.resolve(String(value || ''));
  if (!value || !fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  return resolved;
}
function relative(filePath) { return path.relative(process.cwd(), filePath); }
function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Expected positive integer, got ${value}`);
  return parsed;
}
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
