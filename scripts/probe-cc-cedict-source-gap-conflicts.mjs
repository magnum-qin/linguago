import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const cedictPath = requiredPath(args.cedict || 'data/raw/CC-CEDICT.txt.gz', 'cedict');
const outPath = path.resolve(args.out || 'logs/product-source-gap-cc-cedict-conflicts.json');
const evidenceOutPath = args['evidence-out'] ? path.resolve(args['evidence-out']) : null;
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const candidates = (report.near_unlock || report.source_conflicts || report.selected || [])
  .filter((row) => row.source_lang === 'zh')
  .map((row) => ({ ...row, anchor_terms: splitAnchor(row.anchor) }));
const candidatesByTerm = new Map();
for (const candidate of candidates) {
  const term = normalizeChinese(candidate.word);
  if (!term) continue;
  if (!candidatesByTerm.has(term)) candidatesByTerm.set(term, []);
  candidatesByTerm.get(term).push(candidate);
}

const matchesByKey = new Map();
let linesScanned = 0;
const text = zlib.gunzipSync(fs.readFileSync(cedictPath)).toString('utf8');
for (const line of text.split(/\r?\n/u)) {
  if (!line || line.startsWith('#')) continue;
  linesScanned += 1;
  const match = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]*)\]\s+\/(.*)\/$/u);
  if (!match) continue;
  const [, traditional, simplified, pinyin, definitionsText] = match;
  const terms = unique([traditional, simplified].map(normalizeChinese));
  const candidateTerms = terms.filter((term) => candidatesByTerm.has(term));
  if (!candidateTerms.length) continue;
  const definitions = definitionsText.split('/').map((value) => value.trim()).filter(Boolean);
  const normalizedDefinitions = new Map(definitions.map((value) => [normalizeEnglish(value), value]));
  for (const term of candidateTerms) {
    for (const candidate of candidatesByTerm.get(term)) {
      const matchedGlosses = candidate.anchor_terms
        .map((anchor) => normalizedDefinitions.get(normalizeEnglish(anchor)))
        .filter(Boolean);
      if (!matchedGlosses.length) continue;
      if (!matchesByKey.has(candidate.candidate_key)) matchesByKey.set(candidate.candidate_key, []);
      matchesByKey.get(candidate.candidate_key).push({
        traditional,
        simplified,
        pinyin,
        matched_glosses: unique(matchedGlosses),
        all_definitions: definitions
      });
    }
  }
}

const assessed = candidates.map((candidate) => {
  const matches = matchesByKey.get(candidate.candidate_key) || [];
  return {
    ...candidate,
    anchor_terms: undefined,
    status: matches.length ? 'qualified' : 'unmatched',
    matched_glosses: unique(matches.flatMap((item) => item.matched_glosses)),
    matches
  };
});
const selected = assessed.filter((row) => row.status === 'qualified');
const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  policy: {
    source_language: 'zh',
    exact_traditional_or_simplified_headword: true,
    exact_semicolon_anchor_definition: true,
    candidate_bound: true
  },
  source_report: relative(reportPath),
  cedict: relative(cedictPath),
  summary: {
    lines_scanned: linesScanned,
    input_rows: candidates.length,
    qualified_rows: selected.length,
    statuses: countBy(assessed, (row) => row.status)
  },
  selected,
  assessed
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
if (evidenceOutPath) writeEvidenceDb(evidenceOutPath, selected);
console.log(JSON.stringify({
  out: relative(outPath),
  evidence_out: evidenceOutPath ? relative(evidenceOutPath) : null,
  ...output.summary
}, null, 2));

function writeEvidenceDb(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.rmSync(filePath, { force: true });
  const sourceSha256 = sha256File(cedictPath);
  const reportSha256 = sha256File(reportPath);
  const policyVersion = 'exact-headword-definition-v1';
  const keyHash = crypto.createHash('sha256')
    .update(`${sourceSha256}:${reportSha256}:${policyVersion}`)
    .digest('hex').slice(0, 12);
  const sourceKey = `cc-cedict-candidate-${keyHash}`;
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE evidence_sources (
      source_key TEXT PRIMARY KEY, source_family TEXT NOT NULL, lang TEXT NOT NULL,
      lexicon_spec TEXT NOT NULL, license TEXT NOT NULL, metadata_json TEXT NOT NULL
    );
    CREATE TABLE lexical_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT, source_key TEXT NOT NULL, source_family TEXT NOT NULL,
      lang TEXT NOT NULL, term TEXT NOT NULL, normalized_key TEXT NOT NULL,
      english_gloss TEXT NOT NULL, english_normalized_key TEXT NOT NULL, concept_id TEXT
    );
    CREATE UNIQUE INDEX idx_lexical_evidence_unique ON lexical_evidence
      (source_key, lang, normalized_key, english_normalized_key, concept_id);
    CREATE INDEX idx_lexical_evidence_lookup ON lexical_evidence(lang, normalized_key);
    CREATE INDEX idx_lexical_evidence_english ON lexical_evidence(lang, english_normalized_key);
  `);
  db.prepare('INSERT INTO evidence_sources VALUES (?, ?, ?, ?, ?, ?)').run(
    sourceKey, 'cc-cedict', 'zh',
    'CC-CEDICT exact headwords bound to exact English definitions', 'CC BY-SA 4.0',
    JSON.stringify({
      production_publishable: true,
      candidate_bound: true,
      source_file: relative(cedictPath),
      source_sha256: sourceSha256,
      report_sha256: reportSha256,
      policy_version: policyVersion,
      generated_at: new Date().toISOString()
    })
  );
  const insert = db.prepare(`INSERT OR IGNORE INTO lexical_evidence
    (source_key, source_family, lang, term, normalized_key, english_gloss, english_normalized_key, concept_id)
    VALUES (?, 'cc-cedict', 'zh', ?, ?, ?, ?, ?)`);
  db.transaction(() => {
    for (const row of rows) {
      for (const gloss of row.matched_glosses) {
        insert.run(sourceKey, row.word, normalizeChinese(row.word), gloss, normalizeEnglish(gloss), `cc-cedict:${row.candidate_key}`);
      }
    }
  })();
  db.pragma('journal_mode = DELETE');
  const integrity = db.pragma('integrity_check', { simple: true });
  db.close();
  if (integrity !== 'ok') throw new Error(`Evidence DB integrity check failed: ${integrity}`);
}

function splitAnchor(value) { return unique(String(value || '').split(/[;|]/u).map((term) => term.trim()).filter(Boolean)); }
function normalizeChinese(value) { return String(value || '').normalize('NFKC').trim(); }
function normalizeEnglish(value) { return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim(); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function countBy(rows, getKey) { const out = {}; for (const row of rows) { const key = getKey(row); out[key] = (out[key] || 0) + 1; } return out; }
function sha256File(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); }
function relative(filePath) { return path.relative(process.cwd(), filePath); }
function requiredPath(value, name) { if (!value) throw new Error(`Missing --${name}`); const result = path.resolve(value); if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`); return result; }
function parseArgs(argv) { const out = {}; for (let i = 0; i < argv.length; i += 1) { if (!argv[i].startsWith('--')) continue; const key = argv[i].slice(2); const next = argv[i + 1]; if (next && !next.startsWith('--')) { out[key] = next; i += 1; } else out[key] = true; } return out; }
