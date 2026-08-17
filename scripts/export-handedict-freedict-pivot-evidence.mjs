#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report || 'logs/product-source-gap-v97-handedict-freedict-de-pivot-probe.json');
const outPath = path.resolve(args.out || '.tmp/handedict/handedict-freedict-de-pivot-v97-evidence.db');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const reportHash = sha256File(reportPath);

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
  CREATE TABLE handedict_pivot_candidate_provenance (
    candidate_key TEXT NOT NULL, source_key TEXT NOT NULL,
    normalized_key TEXT NOT NULL, english_normalized_key TEXT NOT NULL,
    german_terms_json TEXT NOT NULL, previous_families_json TEXT NOT NULL,
    PRIMARY KEY(candidate_key, source_key, normalized_key, english_normalized_key)
  );
`);

const sourceKey = `handedict-freedict-de-pivot-${reportHash.slice(0, 12)}`;
const metadata = {
  authority: 'HanDeDict Chinese-German plus FreeDict eng-deu',
  handedict_license: 'CC-BY-SA-3.0',
  handedict_snapshot: '2026-08-14',
  freedict_license: 'GPL-2.0-or-later',
  production_publishable: true,
  candidate_bound: true,
  alignment: 'exact normalized English headword and German translation equality',
  mainland_policy: 'HanDeDict simplified form is the publication candidate',
  family_caveat: 'HanDeDict derives some headwords from CEDICT; evidence credit is for independently authored German equivalence joined through FreeDict, not the inherited headword alone',
  report_sha256: reportHash
};
db.prepare('INSERT INTO evidence_sources VALUES (?, ?, ?, ?, ?, ?)').run(
  sourceKey,
  'handedict-freedict-de-pivot',
  'zh',
  'HanDeDict Chinese-German joined to FreeDict eng-deu through exact German translation',
  'CC-BY-SA-3.0 AND GPL-2.0-or-later',
  JSON.stringify(metadata)
);
const insertEvidence = db.prepare(`
  INSERT OR IGNORE INTO lexical_evidence
    (source_key, source_family, lang, term, normalized_key, english_gloss, english_normalized_key, concept_id)
  VALUES (?, 'handedict-freedict-de-pivot', 'zh', ?, ?, ?, ?, ?)
`);
const insertProvenance = db.prepare(`
  INSERT OR IGNORE INTO handedict_pivot_candidate_provenance
    (candidate_key, source_key, normalized_key, english_normalized_key, german_terms_json, previous_families_json)
  VALUES (?, ?, ?, ?, ?, ?)
`);
let acceptedCandidates = 0;
db.transaction(() => {
  for (const row of report.matches || []) {
    if (!row.second_family_candidate) continue;
    acceptedCandidates += 1;
    for (const term of row.terms || []) {
      const normalizedTerm = normalize(term.simplified);
      const normalizedEnglish = normalize(row.english_anchor);
      if (!normalizedTerm || !normalizedEnglish) continue;
      insertEvidence.run(sourceKey, term.simplified, normalizedTerm, row.english_anchor, normalizedEnglish, `candidate:${row.candidate_key}`);
      insertProvenance.run(row.candidate_key, sourceKey, normalizedTerm, normalizedEnglish, JSON.stringify(row.german_terms || []), JSON.stringify(row.existing_source_families || []));
    }
  }
})();
db.pragma('journal_mode = DELETE');
const integrity = db.pragma('integrity_check', { simple: true });
const counts = {
  accepted_candidates: acceptedCandidates,
  lexical_evidence: db.prepare('SELECT COUNT(*) count FROM lexical_evidence').get().count,
  provenance: db.prepare('SELECT COUNT(*) count FROM handedict_pivot_candidate_provenance').get().count
};
db.close();
console.log(JSON.stringify({ ok: integrity === 'ok', integrity, out: relative(outPath), source_key: sourceKey, counts }, null, 2));

function normalize(value) { return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en').replace(/\s+/gu, ' '); }
function sha256File(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); }
function requiredPath(value) { const resolved = path.resolve(String(value || '')); if (!value || !fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`); return resolved; }
function relative(filePath) { return path.relative(process.cwd(), filePath); }
function parseArgs(argv) { const parsed = {}; for (let index = 0; index < argv.length; index++) { if (!argv[index].startsWith('--')) continue; const key = argv[index].slice(2); const next = argv[index + 1]; parsed[key] = next && !next.startsWith('--') ? argv[++index] : 'true'; } return parsed; }
