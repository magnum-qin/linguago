#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import csv from 'csv-parser';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const csvPath = requiredPath(args.csv || '.tmp/ecdict/ecdict-official.csv');
const inputPath = requiredPath(args.probe || args['validation-report']);
const outPath = path.resolve(args.out || '.tmp/ecdict/ecdict-chinese-evidence.db');
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const candidateMode = args['validation-report'] ? 'validation_report' : 'probe';
const candidates = candidateMode === 'validation_report'
  ? (input.validations || []).map((row) => ({
      candidate_key: row.candidate_key,
      english_anchor: row.evidence?.anchor
    })).filter((row) => row.candidate_key && row.english_anchor)
  : [...(input.research_candidates || [])].filter((row) => row.zh_term && row.english_anchor);
const byAnchor = new Map();

for (const candidate of candidates) {
  for (const anchor of conservativeEnglishAnchors(candidate.english_anchor)) {
    if (!byAnchor.has(anchor)) byAnchor.set(anchor, []);
    byAnchor.get(anchor).push({ ...candidate, lookup_anchor: anchor });
  }
}

const matched = [];
let rowsScanned = 0;
await new Promise((resolve, reject) => {
  fs.createReadStream(csvPath)
    .pipe(csv())
    .on('data', (row) => {
      rowsScanned += 1;
      const word = normalizeEnglish(row.word);
      const bound = byAnchor.get(word);
      if (!bound?.length) return;
      const translation = normalizeChineseText(row.translation);
      if (!translation) return;
      for (const candidate of bound) {
        const terms = candidateMode === 'validation_report'
          ? extractChineseTerms(translation)
          : [normalizeChineseText(candidate.zh_term)].filter((term) => term.length >= 2 && translation.includes(term));
        for (const term of terms) {
          matched.push({
            candidate_key: candidate.candidate_key,
            term,
            normalized_key: normalizeTerm(term),
            english_gloss: candidate.lookup_anchor,
            english_normalized_key: word,
            // Validation-report exports are sense-bound. Keeping the candidate
            // key in concept_id prevents evidence for one homographic sense
            // from being reused by another candidate with the same anchor.
            concept_id: candidateMode === 'validation_report'
              ? `candidate:${candidate.candidate_key}`
              : `ecdict:${word}:${sha256(term).slice(0, 12)}`,
            translation
          });
        }
      }
    })
    .on('end', resolve)
    .on('error', reject);
});

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
  CREATE TABLE ecdict_candidate_provenance (
    candidate_key TEXT NOT NULL, normalized_key TEXT NOT NULL,
    english_normalized_key TEXT NOT NULL, translation TEXT NOT NULL,
    PRIMARY KEY(candidate_key, normalized_key, english_normalized_key)
  );
`);

const csvSha256 = sha256File(csvPath);
const inputSha256 = sha256File(inputPath);
const sourceKey = `ecdict-official-${csvSha256.slice(0, 12)}-${inputSha256.slice(0, 12)}`;
const metadata = {
  repository: 'https://github.com/skywind3000/ECDICT',
  artifact_url: 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv',
  csv_sha256: csvSha256,
  input_sha256: inputSha256,
  candidate_mode: candidateMode,
  candidate_bound: true,
  evidence_strength: candidateMode === 'validation_report'
    ? 'exact_reciprocal_candidate_bound'
    : 'term_substring_probe',
  match_policy: candidateMode === 'validation_report'
    ? 'exact conservative English anchor variant plus conservative Chinese segments from the ECDICT translation field; downstream reverse evidence remains mandatory'
    : 'exact Chinese substring in the ECDICT translation field; minimum two characters',
  production_publishable: true
};
const insertSource = db.prepare('INSERT INTO evidence_sources VALUES (?, ?, ?, ?, ?, ?)');
const insertEvidence = db.prepare(`INSERT OR IGNORE INTO lexical_evidence
  (source_key, source_family, lang, term, normalized_key, english_gloss, english_normalized_key, concept_id)
  VALUES (?, 'ecdict', 'zh', ?, ?, ?, ?, ?)`);
const insertProvenance = db.prepare('INSERT OR IGNORE INTO ecdict_candidate_provenance VALUES (?, ?, ?, ?)');
db.transaction(() => {
  insertSource.run(sourceKey, 'ecdict', 'zh', 'ECDICT English-Chinese translation field, candidate-bound subset', 'MIT', JSON.stringify(metadata));
  for (const row of matched) {
    insertEvidence.run(sourceKey, row.term, row.normalized_key, row.english_gloss, row.english_normalized_key, row.concept_id);
    insertProvenance.run(row.candidate_key, row.normalized_key, row.english_normalized_key, row.translation);
  }
})();
db.pragma('journal_mode = DELETE');
const integrity = db.pragma('integrity_check', { simple: true });
const counts = {
  rows_scanned: rowsScanned,
  probe_candidates: candidates.length,
  matched_candidates: new Set(matched.map((row) => row.candidate_key)).size,
  lexical_evidence: db.prepare('SELECT COUNT(*) count FROM lexical_evidence').get().count
};
db.close();
console.log(JSON.stringify({ ok: integrity === 'ok', integrity, out: path.relative(process.cwd(), outPath), counts, metadata }, null, 2));

function normalizeEnglish(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en').replace(/\s+/gu, ' ');
}
function conservativeEnglishAnchors(value) {
  const normalized = normalizeEnglish(value);
  if (!normalized) return [];
  const anchors = new Set([normalized]);
  for (const part of normalized.split(/[;|]/u)) {
    const term = part.trim().replace(/^to\s+/u, '');
    if (term && term.length <= 80) anchors.add(term);
  }
  return [...anchors];
}
function normalizeTerm(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en').replace(/\s+/gu, ' ');
}
function normalizeChineseText(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
}
function extractChineseTerms(value) {
  const terms = new Set();
  const segments = String(value || '')
    .replace(/\[[^\]]{1,12}\]/gu, ' ')
    .replace(/(?:^|\s)(?:n|v|vt|vi|a|adj|adv|prep|pron|conj|num|int)\./giu, ' ')
    .split(/[\n,，;；、/|]+/u);
  for (const raw of segments) {
    let term = raw.replace(/^[^\p{Script=Han}]*/u, '').replace(/[^\p{Script=Han}]*(?:\([^)]*\))?$/u, '').trim();
    if (/^[\p{Script=Han}]{2,12}$/u.test(term)) terms.add(term);
    if (term.endsWith('的') && /^[\p{Script=Han}]{3,12}$/u.test(term)) {
      term = term.slice(0, -1);
      if (term.length >= 2) terms.add(term);
    }
  }
  return [...terms];
}
function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}
function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function requiredPath(value) {
  if (!value) throw new Error('Missing required path argument');
  const result = path.resolve(value);
  if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`);
  return result;
}
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
