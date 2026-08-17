import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(
  args.report || 'logs/product-source-gap-v98-cedpane-near-unlock-probe.json'
);
const outPath = path.resolve(
  args.out || '.tmp/cedpane/cedpane-pd-definitions-evidence.db'
);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (report?.policy?.exact_simplified_chinese_term_required !== true) {
  throw new Error('Probe report does not enforce exact simplified Chinese terms');
}
if (
  report?.policy?.minimum_anchor_content_token_coverage !== 0.67 ||
  report?.policy?.minimum_source_content_token_coverage !== 0.67
) {
  throw new Error('Probe report does not enforce bidirectional gloss coverage');
}

const sourceKey = `cedpane-pd-definitions-${String(report.source.sha256 || '').slice(0, 12)}`;
const evidence = new Map();
const provenance = new Map();
for (const match of report.matches || []) {
  const candidateKey = String(match.candidate_key || '').trim();
  if (!candidateKey) continue;
  const conceptId = `candidate:${candidateKey}`;
  if (!provenance.has(conceptId)) {
    provenance.set(conceptId, { candidate_keys: new Set(), raw_terms: new Set() });
  }
  provenance.get(conceptId).candidate_keys.add(candidateKey);
  for (const record of match.records || []) {
    if (Number(record.anchor_coverage) < 0.67 || Number(record.source_coverage) < 0.67) continue;
    const term = String(record.source_term || '').normalize('NFKC').trim();
    const englishGloss = String(record.english_gloss || '').normalize('NFKC').trim();
    if (!term || !englishGloss) continue;
    const key = `${term}\0${normalizeEnglish(englishGloss)}\0${conceptId}`;
    if (!evidence.has(key)) {
      evidence.set(key, {
        term,
        english_gloss: englishGloss,
        english_normalized_key: normalizeEnglish(englishGloss),
        concept_id: conceptId
      });
    }
    if (record.source_term_raw) {
      provenance.get(conceptId).raw_terms.add(record.source_term_raw);
    }
  }
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
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
  CREATE TABLE cedpane_evidence_provenance (
    concept_id TEXT PRIMARY KEY, candidate_keys_json TEXT NOT NULL,
    raw_terms_json TEXT NOT NULL
  );
`);

const metadata = {
  production_publishable: true,
  research_only: false,
  source_url: report.source.source_url,
  source_file: report.source.file,
  source_sha256: report.source.sha256,
  report_sha256: sha256(fs.readFileSync(reportPath)),
  extraction_policy: 'candidate-bound exact simplified Chinese term plus >=0.67 bidirectional English content-token coverage',
  mainland_policy: 'traditional source forms normalized to simplified Chinese; raw forms retained in provenance',
  independent_from_cc_cedict: true,
  final_reverse_evidence_required: true,
  generated_at: new Date().toISOString()
};
const insertSource = db.prepare('INSERT INTO evidence_sources VALUES (?, ?, ?, ?, ?, ?)');
const insertEvidence = db.prepare(`
  INSERT OR IGNORE INTO lexical_evidence
    (source_key, source_family, lang, term, normalized_key,
     english_gloss, english_normalized_key, concept_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertProvenance = db.prepare(
  'INSERT INTO cedpane_evidence_provenance VALUES (?, ?, ?)'
);

db.transaction(() => {
  insertSource.run(
    sourceKey,
    'cedpane-pd-definitions',
    'zh',
    'CedPane public-domain English definitions exact sense-bound subset',
    'PDDL / Unlicense public-domain dedication',
    JSON.stringify(metadata)
  );
  for (const row of evidence.values()) {
    insertEvidence.run(
      sourceKey,
      'cedpane-pd-definitions',
      'zh',
      row.term,
      row.term,
      row.english_gloss,
      row.english_normalized_key,
      row.concept_id
    );
  }
  for (const [conceptId, row] of provenance) {
    insertProvenance.run(
      conceptId,
      JSON.stringify([...row.candidate_keys]),
      JSON.stringify([...row.raw_terms])
    );
  }
})();

const integrity = db.pragma('integrity_check', { simple: true });
const unboundEvidence = db.prepare(`
  SELECT COUNT(*) n
  FROM lexical_evidence
  WHERE concept_id NOT LIKE 'candidate:%'
`).get().n;
if (unboundEvidence !== 0) {
  db.close();
  throw new Error(`CedPane export contains ${unboundEvidence} unbound evidence rows`);
}
const counts = {
  source_rows: report.source.parsed_rows,
  matched_candidates: report.summary.newly_supported_candidates,
  lexical_evidence: db.prepare('SELECT COUNT(*) n FROM lexical_evidence').get().n,
  unique_terms: db.prepare('SELECT COUNT(DISTINCT normalized_key) n FROM lexical_evidence').get().n,
  candidate_bound_evidence: db.prepare(`
    SELECT COUNT(*) n FROM lexical_evidence WHERE concept_id LIKE 'candidate:%'
  `).get().n
};
db.close();
console.log(JSON.stringify({
  ok: integrity === 'ok',
  out: path.relative(process.cwd(), outPath),
  source_key: sourceKey,
  integrity,
  counts
}, null, 2));

function normalizeEnglish(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[“”"']/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function requiredPath(value) {
  const result = path.resolve(value);
  if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`);
  return result;
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    out[key] = next && !next.startsWith('--') ? argv[++index] : true;
  }
  return out;
}
