#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const englishPath = requiredPath(args.english, 'english');
const targetPath = requiredPath(args.target, 'target');
const outPath = path.resolve(required(args.out, 'out'));
const lang = String(args.lang || 'ja');
const sourceFamily = String(args['source-family'] || 'omw');
const license = String(args.license || 'WordNet license');
const uniqueEnglishPos = args['unique-english-pos'] === 'true';
const bidirectionalUnique = args['bidirectional-unique'] === 'true';
const reportPath = args.report ? requiredPath(args.report, 'report') : null;
const candidateBindings = reportPath ? loadCandidateBindings(reportPath, lang) : null;
const english = parseTab(englishPath, 'en');
const target = parseTab(targetPath, lang);
const sourceHash = sha256(fs.readFileSync(targetPath));
const sourceKey = String(
  args['source-key'] || `${target.header.name.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}-${sourceHash.slice(0, 12)}`
).replace(/^-+|-+$/gu, '');

fs.mkdirSync(path.dirname(outPath), { recursive: true });
if (fs.existsSync(outPath)) fs.rmSync(outPath);
const db = new Database(outPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE evidence_sources (
    source_key TEXT PRIMARY KEY,
    source_family TEXT NOT NULL,
    lang TEXT NOT NULL,
    lexicon_spec TEXT NOT NULL,
    license TEXT NOT NULL,
    metadata_json TEXT NOT NULL
  );
  CREATE TABLE lexical_evidence (
    id INTEGER PRIMARY KEY,
    source_key TEXT NOT NULL,
    source_family TEXT NOT NULL,
    lang TEXT NOT NULL,
    term TEXT NOT NULL,
    normalized_key TEXT NOT NULL,
    english_gloss TEXT NOT NULL,
    english_normalized_key TEXT NOT NULL,
    concept_id TEXT NOT NULL,
    UNIQUE(source_key, lang, normalized_key, english_gloss, concept_id)
  );
  CREATE INDEX idx_lexical_evidence_lookup ON lexical_evidence(lang, normalized_key);
  CREATE INDEX idx_lexical_evidence_english ON lexical_evidence(lang, english_normalized_key);
`);

const metadata = {
  production_publishable: true,
  extraction_policy: 'exact OMW synset alignment between target and Princeton WordNet lemma tables',
  source_name: target.header.name,
  source_url: target.header.url,
  source_file: path.relative(process.cwd(), targetPath),
  source_sha256: sourceHash,
  english_source_name: english.header.name,
  english_source_url: english.header.url,
  english_file: path.relative(process.cwd(), englishPath),
  english_sha256: sha256(fs.readFileSync(englishPath)),
  candidate_report: reportPath ? path.relative(process.cwd(), reportPath) : null,
  candidate_report_sha256: reportPath ? sha256(fs.readFileSync(reportPath)) : null,
  candidate_bound: Boolean(candidateBindings),
  generated_at: new Date().toISOString()
};
db.prepare('INSERT INTO evidence_sources VALUES (?, ?, ?, ?, ?, ?)').run(
  sourceKey,
  sourceFamily,
  lang,
  `${target.header.name} OMW tab aligned to ${english.header.name}`,
  license,
  JSON.stringify(metadata)
);

const insert = db.prepare(`
  INSERT OR IGNORE INTO lexical_evidence
    (source_key, source_family, lang, term, normalized_key,
     english_gloss, english_normalized_key, concept_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
let alignedSynsets = 0;
let candidateRows = 0;
let ambiguityFilteredRows = 0;
let candidateFilteredRows = 0;
const termsByEnglishPos = new Map();
const englishByTargetPos = new Map();
if (uniqueEnglishPos || bidirectionalUnique) {
  for (const [synset, terms] of target.synsets) {
    const englishTerms = english.synsets.get(synset);
    if (!englishTerms?.size) continue;
    const pos = synsetPos(synset);
    for (const englishTerm of englishTerms) {
      const key = `${normalize(englishTerm)}\u0000${pos}`;
      if (!termsByEnglishPos.has(key)) termsByEnglishPos.set(key, new Set());
      for (const term of terms) termsByEnglishPos.get(key).add(normalize(term));
      for (const term of terms) {
        const reverseKey = `${normalize(term)}\u0000${pos}`;
        if (!englishByTargetPos.has(reverseKey)) englishByTargetPos.set(reverseKey, new Set());
        englishByTargetPos.get(reverseKey).add(normalize(englishTerm));
      }
    }
  }
}
db.transaction(() => {
  for (const [synset, terms] of target.synsets) {
    const englishTerms = english.synsets.get(synset);
    if (!englishTerms?.size) continue;
    alignedSynsets += 1;
    for (const term of terms) {
      for (const englishTerm of englishTerms) {
        candidateRows += 1;
        if (uniqueEnglishPos) {
          const key = `${normalize(englishTerm)}\u0000${synsetPos(synset)}`;
          if (termsByEnglishPos.get(key)?.size !== 1) {
            ambiguityFilteredRows += 1;
            continue;
          }
        }
        if (bidirectionalUnique) {
          const reverseKey = `${normalize(term)}\u0000${synsetPos(synset)}`;
          if (englishByTargetPos.get(reverseKey)?.size !== 1) {
            ambiguityFilteredRows += 1;
            continue;
          }
        }
        if (candidateBindings) {
          const key = bindingKey(englishTerm, term, synsetPos(synset));
          if (!candidateBindings.has(key)) {
            candidateFilteredRows += 1;
            continue;
          }
        }
        insert.run(
          sourceKey,
          sourceFamily,
          lang,
          term,
          normalize(term),
          englishTerm,
          normalize(englishTerm),
          synset
        );
      }
    }
  }
})();
db.pragma('journal_mode = DELETE');
const integrity = db.pragma('integrity_check', { simple: true });
const rows = db.prepare('SELECT COUNT(*) AS n FROM lexical_evidence').get().n;
const terms = db.prepare('SELECT COUNT(DISTINCT normalized_key) AS n FROM lexical_evidence').get().n;
db.close();

console.log(JSON.stringify({
  ok: integrity === 'ok',
  out: path.relative(process.cwd(), outPath),
  source_key: sourceKey,
  lang,
  target_synsets: target.synsets.size,
  aligned_synsets: alignedSynsets,
  candidate_rows: candidateRows,
  unique_english_pos: uniqueEnglishPos,
  bidirectional_unique: bidirectionalUnique,
  ambiguity_filtered_rows: ambiguityFilteredRows,
  candidate_bound: Boolean(candidateBindings),
  candidate_bindings: candidateBindings?.size || 0,
  candidate_filtered_rows: candidateFilteredRows,
  lexical_evidence: rows,
  distinct_terms: terms,
  integrity
}, null, 2));

function parseTab(filePath, fileLang) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/u);
  const headerParts = String(lines.find((line) => line.startsWith('#')) || '')
    .replace(/^#\s*/u, '')
    .split('\t');
  const synsets = new Map();
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length < 3 || !String(parts[1]).endsWith('lemma')) continue;
    const synset = String(parts[0]).trim();
    const term = cleanLemma(parts.slice(2).join('\t'), fileLang);
    if (!synset || !term) continue;
    if (!synsets.has(synset)) synsets.set(synset, new Set());
    synsets.get(synset).add(term);
  }
  return {
    header: {
      name: headerParts[0] || path.basename(filePath),
      language: headerParts[1] || fileLang,
      url: headerParts[2] || null,
      license: headerParts[3]?.trim() || null
    },
    synsets
  };
}

function cleanLemma(value, valueLang) {
  const text = String(value || '').normalize('NFKC').trim().replace(/_/gu, ' ');
  return (valueLang === 'ja' || valueLang === 'zh' ? text.replace(/\+/gu, '') : text.replace(/\+/gu, ' '))
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalize(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/gu, ' ');
}

function synsetPos(value) {
  return String(value || '').match(/-([nvars])$/u)?.[1] || 'unknown';
}

function loadCandidateBindings(filePath, targetLang) {
  const report = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const bindings = new Set();
  for (const row of report.selected || []) {
    const pos = candidatePos(row.part_of_speech);
    if (!pos) continue;
    const englishTerms = candidateTerms(row, 'en');
    const targetTerms = candidateTerms(row, targetLang);
    for (const englishTerm of englishTerms) {
      for (const targetTerm of targetTerms) bindings.add(bindingKey(englishTerm, targetTerm, pos));
    }
  }
  return bindings;
}

function candidateTerms(row, valueLang) {
  const values = [];
  if (row.source_lang === valueLang) values.push(row.word);
  for (const localization of row.first_sense_localizations || []) {
    if (localization?.lang === valueLang) values.push(localization.term);
  }
  if (valueLang === 'en' && !values.length) values.push(row.gloss_key, row.gloss_preview);
  return [...new Set(values.flatMap(splitCandidateTerms).map((term) => cleanLemma(term, valueLang)).filter(Boolean))];
}

function splitCandidateTerms(value) {
  return String(value || '')
    .split(/[;,|/]/u)
    .map((term) => term.replace(/^(?:en|pt-BR|zh|ja):\s*/iu, '').trim())
    .filter((term) => term.length >= 2 && term.length <= 80);
}

function candidatePos(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['noun', 'n'].includes(normalized)) return 'n';
  if (['verb', 'v'].includes(normalized)) return 'v';
  if (['adjective', 'adj', 'a'].includes(normalized)) return 'a';
  if (['adverb', 'adv', 'r'].includes(normalized)) return 'r';
  return null;
}

function bindingKey(englishTerm, targetTerm, pos) {
  return `${normalize(englishTerm)}\u0000${normalize(targetTerm)}\u0000${pos}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function required(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return String(value);
}

function requiredPath(value, name) {
  const result = path.resolve(required(value, name));
  if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`);
  return result;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return parsed;
}
