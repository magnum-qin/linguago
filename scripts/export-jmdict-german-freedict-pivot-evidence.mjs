#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(
  args.report || 'logs/product-source-gap-v97-jmdict-german-freedict-de-pivot-probe.json'
);
const approvedReportPath = args['approved-report']
  ? requiredPath(args['approved-report'])
  : null;
const outPath = path.resolve(args.out || '.tmp/jmdict/jmdict-german-freedict-de-pivot-v97-evidence.db');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const approvedKeys = approvedReportPath
  ? new Set(
      (JSON.parse(fs.readFileSync(approvedReportPath, 'utf8')).selected || [])
        .map((row) => String(row.candidate_key || `${row.source_entry_id}:${row.first_sense_id}`))
    )
  : null;
const reportHash = sha256File(reportPath);
const sourceHash = crypto.createHash('sha256')
  .update(reportHash)
  .update(approvedReportPath ? sha256File(approvedReportPath) : 'unreviewed')
  .digest('hex');

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
  CREATE TABLE jmdict_german_pivot_candidate_provenance (
    candidate_key TEXT NOT NULL, source_key TEXT NOT NULL,
    normalized_key TEXT NOT NULL, english_normalized_key TEXT NOT NULL,
    german_overlap_json TEXT NOT NULL, previous_families_json TEXT NOT NULL,
    PRIMARY KEY(candidate_key, source_key, normalized_key, english_normalized_key)
  );
`);

const sourceKey = `jmdict-german-freedict-de-pivot-${sourceHash.slice(0, 12)}`;
const metadata = {
  authority: 'Full multilingual JMdict plus FreeDict eng-deu from TU Chemnitz Ding',
  jmdict_license: 'EDRDG/JMdict license',
  freedict_license: 'GPL-3.0 and AGPL-3.0 components',
  source_family: 'jmdict',
  production_publishable: approvedKeys !== null,
  reviewed_subset: approvedKeys !== null,
  semantic_review: approvedKeys !== null ? 'independent_qwen_and_gemma_confidence' : null,
  semantic_review_report: approvedReportPath ? relative(approvedReportPath) : null,
  candidate_bound: true,
  alignment: 'exact normalized Japanese form, English anchor, and German translation overlap',
  downstream_review_required: true,
  report_sha256: reportHash
};
db.prepare('INSERT INTO evidence_sources VALUES (?, ?, ?, ?, ?, ?)').run(
  sourceKey,
  'jmdict',
  'ja',
  'Full JMdict German gloss joined to FreeDict eng-deu through exact German translation',
  'EDRDG/JMdict AND (GPL-3.0 AND AGPL-3.0 components)',
  JSON.stringify(metadata)
);

const insertEvidence = db.prepare(`
  INSERT OR IGNORE INTO lexical_evidence
    (source_key, source_family, lang, term, normalized_key,
     english_gloss, english_normalized_key, concept_id)
  VALUES (?, 'jmdict', 'ja', ?, ?, ?, ?, ?)
`);
const insertProvenance = db.prepare(`
  INSERT OR IGNORE INTO jmdict_german_pivot_candidate_provenance
    (candidate_key, source_key, normalized_key, english_normalized_key,
     german_overlap_json, previous_families_json)
  VALUES (?, ?, ?, ?, ?, ?)
`);

let acceptedCandidates = 0;
db.transaction(() => {
  for (const row of report.matches || []) {
    if (!row.production_evidence_candidate) continue;
    if (approvedKeys && !approvedKeys.has(String(row.candidate_key))) continue;
    const term = normalize(row.word);
    const english = normalize(row.english_anchor);
    if (!term || !english) continue;
    acceptedCandidates += 1;
    insertEvidence.run(
      sourceKey,
      row.word,
      term,
      row.english_anchor,
      english,
      `candidate:${row.candidate_key}`
    );
    insertProvenance.run(
      row.candidate_key,
      sourceKey,
      term,
      english,
      JSON.stringify(row.exact_german_overlap || []),
      JSON.stringify(row.existing_source_families || [])
    );
  }
})();

db.pragma('journal_mode = DELETE');
const integrity = db.pragma('integrity_check', { simple: true });
const counts = {
  accepted_candidates: acceptedCandidates,
  lexical_evidence: db.prepare('SELECT COUNT(*) count FROM lexical_evidence').get().count,
  provenance: db.prepare('SELECT COUNT(*) count FROM jmdict_german_pivot_candidate_provenance').get().count
};
db.close();
console.log(JSON.stringify({ ok: integrity === 'ok', integrity, out: relative(outPath), source_key: sourceKey, counts }, null, 2));

function normalize(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en').replace(/\s+/gu, ' ');
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
    if (value && !value.startsWith('--')) parsed[key] = argv[++index];
    else parsed[key] = 'true';
  }
  return parsed;
}
