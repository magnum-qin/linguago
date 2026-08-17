#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import csv from 'csv-parser';
import * as OpenCC from 'opencc-js';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report || 'logs/product-source-gap-v97-evidence-acquisition-all.json');
const inputDir = path.resolve(args['input-dir'] || 'data/raw/northeuralex-cldf');
const outPath = path.resolve(args.out || '.tmp/northeuralex/northeuralex-v97-evidence.db');
const languagePath = requiredPath(path.join(inputDir, 'languages.csv'));
const parameterPath = requiredPath(path.join(inputDir, 'parameters.csv'));
const formPath = requiredPath(path.join(inputDir, 'forms.csv'));
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const candidates = (report.selected || []).filter(validCandidate);
const includeGenericPortuguese = args['include-generic-portuguese'] === 'true';
const evidenceLanguages = new Set([
  'en',
  'zh',
  'ja',
  ...(includeGenericPortuguese ? ['pt-BR'] : [])
]);
const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });
const languageById = new Map();
const parameterById = new Map();
const formsByConcept = new Map();

for (const row of await readCsv(languagePath)) {
  const lang = languageFromIso(row.ISO639P3code, row.Name);
  if (lang) languageById.set(row.ID, lang);
}
for (const row of await readCsv(parameterPath)) {
  parameterById.set(row.ID, {
    id: row.ID,
    concepticon_id: row.Concepticon_ID || null,
    gloss: row.Concepticon_Gloss || row.NorthEuralex_Gloss || row.Name || ''
  });
}
for (const row of await readCsv(formPath)) {
  const lang = languageById.get(row.Language_ID);
  if (!lang) continue;
  // CLDF Value is the source orthography; Form is the normalized IPA form in
  // NorthEuraLex and must not be used for headword matching.
  const term = cleanTerm(row.Value || row.Form, lang);
  if (!term) continue;
  if (!formsByConcept.has(row.Parameter_ID)) formsByConcept.set(row.Parameter_ID, new Map());
  const byLang = formsByConcept.get(row.Parameter_ID);
  if (!byLang.has(lang)) byLang.set(lang, new Set());
  byLang.get(lang).add(term);
}

const evidence = [];
const globalEvidence = [];
const diagnostics = {
  source_term_matches: 0,
  source_and_target_concepts: 0,
  anchor_aligned_concepts: 0,
  matched_candidates: new Set()
};
for (const [parameterId, byLang] of formsByConcept) {
  const parameter = parameterById.get(parameterId);
  const englishTerms = byLang.get('en');
  if (!parameter || !englishTerms?.size) continue;
  for (const [lang, terms] of byLang) {
    if (!evidenceLanguages.has(lang)) continue;
    for (const term of terms) {
      for (const englishTerm of englishTerms) {
        globalEvidence.push({ lang, term, englishTerm, parameter });
      }
    }
  }
}
for (const candidate of candidates) {
  for (const [conceptId, byLang] of formsByConcept) {
    const sourceTerms = byLang.get(candidate.source_lang);
    const targetTerms = byLang.get(candidate.target_lang);
    if (!sourceTerms) continue;
    if (![...sourceTerms].some((term) => equivalentTerm(term, candidate.word, candidate.source_lang))) continue;
    diagnostics.source_term_matches += 1;
    if (!targetTerms) continue;
    diagnostics.source_and_target_concepts += 1;
    const parameter = parameterById.get(conceptId);
    if (!parameter?.gloss || !semanticMatch(candidate.english_anchor, parameter.gloss)) continue;
    diagnostics.anchor_aligned_concepts += 1;
    diagnostics.matched_candidates.add(candidate.candidate_key);
    for (const targetTerm of targetTerms) {
      evidence.push({ candidate, targetTerm, parameter });
    }
  }
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
  CREATE TABLE northeuralex_candidate_provenance (
    candidate_key TEXT NOT NULL, source_key TEXT NOT NULL,
    source_entry_id INTEGER NOT NULL, source_sense_id INTEGER NOT NULL,
    parameter_id TEXT NOT NULL, concepticon_id TEXT,
    source_lang TEXT NOT NULL, source_term TEXT NOT NULL,
    target_lang TEXT NOT NULL, target_term TEXT NOT NULL,
    PRIMARY KEY(candidate_key, parameter_id, target_lang, target_term)
  );
`);
const sourceHash = combinedHash([languagePath, parameterPath, formPath]);
const sourceKey = `northeuralex-cldf-${sourceHash.slice(0, 12)}`;
db.prepare('INSERT INTO evidence_sources VALUES (?, ?, ?, ?, ?, ?)').run(
  sourceKey,
  'northeuralex',
  'multi',
  'NorthEuraLex CLDF concept-bound multilingual wordlist',
  'CC-BY-4.0',
  JSON.stringify({
    repository: 'https://github.com/lexibank/northeuralex',
    citation: 'Dellert et al. (2020), NorthEuraLex Version 0.9',
    source_sha256: sourceHash,
    report_sha256: hashFile(reportPath),
    mainland_policy: 'Mandarin form normalized to Simplified Chinese',
    concept_alignment_required: true,
    exported_languages: [...evidenceLanguages],
    generic_portuguese_included: includeGenericPortuguese,
    portuguese_policy: includeGenericPortuguese
      ? 'generic Portuguese validation evidence; downstream must not treat it as specifically Brazilian'
      : 'generic Portuguese excluded by default because the product contract requires pt-BR'
  })
);
const insertEvidence = db.prepare(`
  INSERT OR IGNORE INTO lexical_evidence
    (source_key, source_family, lang, term, normalized_key,
     english_gloss, english_normalized_key, concept_id)
  VALUES (?, 'northeuralex', ?, ?, ?, ?, ?, ?)
`);
const insertProvenance = db.prepare(`
  INSERT OR IGNORE INTO northeuralex_candidate_provenance
    (candidate_key, source_key, source_entry_id, source_sense_id,
     parameter_id, concepticon_id, source_lang, source_term,
     target_lang, target_term)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
db.transaction(() => {
  for (const row of globalEvidence) {
    const conceptId = row.parameter.concepticon_id
      ? `concepticon:${row.parameter.concepticon_id}`
      : `northeuralex:${row.parameter.id}`;
    insertEvidence.run(
      sourceKey,
      row.lang,
      row.term,
      normalize(row.term),
      row.englishTerm,
      normalize(row.englishTerm),
      conceptId
    );
  }
  for (const row of evidence) {
    const conceptId = row.parameter.concepticon_id
      ? `concepticon:${row.parameter.concepticon_id}`
      : `northeuralex:${row.parameter.id}`;
    insertProvenance.run(
      row.candidate.candidate_key,
      sourceKey,
      Number(row.candidate.source_entry_id),
      Number(row.candidate.source_sense_id),
      row.parameter.id,
      row.parameter.concepticon_id,
      row.candidate.source_lang,
      row.candidate.word,
      row.candidate.target_lang,
      row.targetTerm
    );
  }
})();
db.pragma('journal_mode = DELETE');
const integrity = db.pragma('integrity_check', { simple: true });
const counts = {
  input_candidates: candidates.length,
  source_term_matches: diagnostics.source_term_matches,
  source_and_target_concepts: diagnostics.source_and_target_concepts,
  anchor_aligned_concepts: diagnostics.anchor_aligned_concepts,
  matched_candidates: diagnostics.matched_candidates.size,
  include_generic_portuguese: includeGenericPortuguese,
  exported_languages: [...evidenceLanguages],
  global_evidence_candidates: globalEvidence.length,
  relevant_languages: Object.fromEntries([...languageById].map(([id, lang]) => [id, lang])),
  concepts: formsByConcept.size,
  lexical_evidence: db.prepare('SELECT COUNT(*) count FROM lexical_evidence').get().count,
  candidate_bindings: db.prepare('SELECT COUNT(*) count FROM northeuralex_candidate_provenance').get().count,
  candidates_with_evidence: db.prepare('SELECT COUNT(DISTINCT candidate_key) count FROM northeuralex_candidate_provenance').get().count,
  by_lang: db.prepare('SELECT lang, COUNT(*) rows FROM lexical_evidence GROUP BY lang ORDER BY lang').all()
};
db.close();
console.log(JSON.stringify({ ok: integrity === 'ok', integrity, out: relative(outPath), source_key: sourceKey, counts }, null, 2));

function readCsv(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath).pipe(csv()).on('data', (row) => rows.push(row)).on('end', () => resolve(rows)).on('error', reject);
  });
}
function languageFromIso(iso, name) {
  const code = String(iso || '').toLowerCase();
  const label = String(name || '').toLowerCase();
  if (code === 'eng') return 'en';
  if (code === 'por') return 'pt-BR';
  if (code === 'jpn') return 'ja';
  if (code === 'cmn' || label.includes('mandarin')) return 'zh';
  return null;
}
function cleanTerm(value, lang) {
  let term = String(value || '').normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!term || term === '-' || /<[^>]+>/u.test(term)) return null;
  if (lang === 'zh') {
    if (!/\p{Script=Han}/u.test(term)) return null;
    term = toSimplified(term);
  } else if (lang === 'ja' && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(term)) {
    return null;
  }
  return term;
}
function equivalentTerm(left, right, lang) {
  if (lang === 'zh') return normalize(toSimplified(left)) === normalize(toSimplified(right));
  return normalize(left) === normalize(right);
}
function semanticMatch(anchor, gloss) {
  const left = lexicalTokens(anchor);
  const right = lexicalTokens(gloss);
  if (!left.length || !right.length) return false;
  return left.some((token) => right.some((other) => token === other || stem(token) === stem(other)));
}
function lexicalTokens(value) {
  return normalize(value).match(/[\p{L}\p{N}]+/gu) || [];
}
function stem(value) {
  return value.length >= 5 ? value.replace(/(?:ing|ed|es|s)$/u, '') : value;
}
function validCandidate(row) {
  return row?.candidate_key && row?.word && row?.source_lang && row?.target_lang && row?.english_anchor;
}
function normalize(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ');
}
function combinedHash(files) {
  const hash = crypto.createHash('sha256');
  for (const file of files) hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}
function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function requiredPath(value) {
  const resolved = path.resolve(String(value || ''));
  if (!value || !fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  return resolved;
}
function relative(file) {
  return path.relative(process.cwd(), file);
}
function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith('--') ? argv[++index] : true;
  }
  return parsed;
}
