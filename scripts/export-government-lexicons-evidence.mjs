import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(
  args.report || 'logs/product-source-gap-v95-government-lexicons-zero-family-probe.json'
);
const outPath = path.resolve(
  args.out || '.tmp/government-lexicons/government-lexicons-zero-family-evidence.db'
);
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
  CREATE TABLE government_lexicon_candidate_provenance (
    candidate_key TEXT NOT NULL, source_key TEXT NOT NULL, lang TEXT NOT NULL,
    normalized_key TEXT NOT NULL, english_normalized_key TEXT NOT NULL,
    domain_limited INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(candidate_key, source_key, lang, normalized_key, english_normalized_key)
  );
`);

const sourceDefinitions = {
  naer_government_terms: {
    source_key: `naer-computer-terms-${reportHash.slice(0, 12)}`,
    lang: 'zh',
    spec: 'NAER government terminology, Mainland China term preferred with simplified Taiwan fallback, candidate-bound exact English subset',
    license: 'Open Government Data License 1.0',
    metadata: {
      authority: 'National Academy for Educational Research, Taiwan',
      dataset_url: 'https://data.gov.tw/dataset/15275',
      domain: 'academic and government terminology',
      chinese_term_precedence: 'mainland_only_when_available_else_simplified_taiwan_fallback',
      candidate_bound: true,
      production_publishable: true
    }
  },
  japan_moj_legal_terms: {
    source_key: `japan-moj-legal-terms-v19-${reportHash.slice(0, 12)}`,
    lang: 'ja',
    spec: 'Japan MOJ Standard Legal Terms Dictionary v19, candidate-bound exact English subset',
    license: 'Public Data License 1.0',
    metadata: {
      authority: 'Ministry of Justice, Japan',
      dataset_url: 'https://www.japaneselawtranslation.go.jp/en/dicts/download',
      domain: 'legal terminology',
      candidate_bound: true,
      production_publishable: true
    }
  }
};

const insertSource = db.prepare('INSERT INTO evidence_sources VALUES (?, ?, ?, ?, ?, ?)');
for (const [family, source] of Object.entries(sourceDefinitions)) {
  insertSource.run(
    source.source_key,
    family,
    source.lang,
    source.spec,
    source.license,
    JSON.stringify({ ...source.metadata, report_sha256: reportHash })
  );
}

const insertEvidence = db.prepare(`
  INSERT OR IGNORE INTO lexical_evidence
    (source_key, source_family, lang, term, normalized_key,
     english_gloss, english_normalized_key, concept_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertProvenance = db.prepare(`
  INSERT OR IGNORE INTO government_lexicon_candidate_provenance
    (candidate_key, source_key, lang, normalized_key, english_normalized_key, domain_limited)
  VALUES (?, ?, ?, ?, ?, 1)
`);

db.transaction(() => {
  for (const match of report.matches || []) {
    const source = sourceDefinitions[match.source_family];
    if (!source || source.lang !== match.target_lang) continue;
    const english = normalize(match.english_anchor);
    for (const term of match.terms || []) {
      const normalizedTerm = normalize(term);
      if (!normalizedTerm || !english) continue;
      const conceptId = `${match.source_family}:${english}:${sha256(normalizedTerm).slice(0, 12)}`;
      insertEvidence.run(
        source.source_key,
        match.source_family,
        match.target_lang,
        term,
        normalizedTerm,
        match.english_anchor,
        english,
        conceptId
      );
      insertProvenance.run(
        match.candidate_key,
        source.source_key,
        match.target_lang,
        normalizedTerm,
        english
      );
    }
  }
})();

db.pragma('journal_mode = DELETE');
const integrity = db.pragma('integrity_check', { simple: true });
const counts = {
  source_families: db.prepare('SELECT COUNT(DISTINCT source_family) count FROM evidence_sources').get().count,
  lexical_evidence: db.prepare('SELECT COUNT(*) count FROM lexical_evidence').get().count,
  candidate_bindings: db.prepare('SELECT COUNT(*) count FROM government_lexicon_candidate_provenance').get().count,
  by_family: db.prepare('SELECT source_family, COUNT(*) rows FROM lexical_evidence GROUP BY source_family ORDER BY source_family').all()
};
db.close();
console.log(JSON.stringify({ ok: integrity === 'ok', integrity, out: relative(outPath), counts }, null, 2));

function normalize(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ');
}
function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
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
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const value = argv[i + 1];
    if (value && !value.startsWith('--')) {
      parsed[key] = value;
      i += 1;
    } else parsed[key] = true;
  }
  return parsed;
}
