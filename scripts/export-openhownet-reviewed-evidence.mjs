import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const sourceDbPath = requiredPath(args['source-db']);
const probePath = requiredPath(args.probe);
const consensusPath = requiredPath(args.consensus);
const outPath = path.resolve(args.out || '.tmp/openhownet/openhownet-reviewed-evidence.db');

const probe = JSON.parse(fs.readFileSync(probePath, 'utf8'));
const consensus = JSON.parse(fs.readFileSync(consensusPath, 'utf8'));
if (consensus.research_only !== true || consensus.production_publishable !== false) {
  throw new Error('Expected the isolated dual-model review report');
}
const acceptedKeys = new Set((consensus.decisions || []).filter((row) => row.consensus_accept).map((row) => row.candidate_key));
const candidates = (probe.research_candidates || []).filter((row) => acceptedKeys.has(row.candidate_key));
if (!candidates.length) throw new Error('No dual-model accepted candidates');

const sourceDb = new Database(sourceDbPath, { readonly: true, fileMustExist: true });
sourceDb.pragma('query_only = ON');
const source = sourceDb.prepare('SELECT * FROM evidence_sources WHERE source_family = ?').get('openhownet');
if (!source) throw new Error('Missing OpenHowNet source metadata');
const metadata = JSON.parse(source.metadata_json || '{}');
if (source.license !== 'MIT' || metadata.production_publishable !== true || metadata.research_only !== false) {
  throw new Error('OpenHowNet source DB is not backed by publishable MIT provenance');
}
const findEvidence = sourceDb.prepare(`
  SELECT e.*, m.sense_id, m.zh_term, m.en_term, m.zh_pos, m.en_pos, m.sememe_definition
  FROM lexical_evidence e
  JOIN openhownet_sense_metadata m ON e.concept_id = 'openhownet:' || m.sense_id
  WHERE e.source_family = 'openhownet'
    AND e.lang = 'zh'
    AND e.normalized_key = ?
    AND e.english_normalized_key = ?
`);

const selected = [];
for (const candidate of candidates) {
  const rows = findEvidence.all(normalize(candidate.zh_term), normalize(candidate.english_anchor));
  const exact = rows.filter((row) => posMatches(candidate.expected_pos, row.zh_pos) && posMatches(candidate.expected_pos, row.en_pos));
  if (!exact.length) throw new Error(`Reviewed candidate no longer binds exactly: ${candidate.candidate_key}`);
  for (const row of exact) selected.push({ ...row, candidate_key: candidate.candidate_key });
}
sourceDb.close();

fs.mkdirSync(path.dirname(outPath), { recursive: true });
if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
const out = new Database(outPath);
out.exec(`
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
  CREATE TABLE openhownet_sense_metadata (
    sense_id TEXT PRIMARY KEY, zh_term TEXT NOT NULL, en_term TEXT NOT NULL,
    zh_pos TEXT, en_pos TEXT, sememe_definition TEXT
  );
  CREATE TABLE reviewed_evidence_provenance (
    candidate_key TEXT NOT NULL, concept_id TEXT NOT NULL,
    probe_sha256 TEXT NOT NULL, consensus_sha256 TEXT NOT NULL,
    PRIMARY KEY(candidate_key, concept_id)
  );
`);
const reviewedMetadata = {
  ...metadata,
  reviewed_subset: true,
  reviewed_candidate_count: candidates.length,
  semantic_review: 'independent_qwen35b_and_gemma4_31b_confidence_gte_0.9',
  probe_sha256: sha256File(probePath),
  consensus_sha256: sha256File(consensusPath)
};
const insertSource = out.prepare('INSERT INTO evidence_sources VALUES (?, ?, ?, ?, ?, ?)');
const insertEvidence = out.prepare(`INSERT OR IGNORE INTO lexical_evidence
  (source_key, source_family, lang, term, normalized_key, english_gloss, english_normalized_key, concept_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
const insertMetadata = out.prepare('INSERT OR IGNORE INTO openhownet_sense_metadata VALUES (?, ?, ?, ?, ?, ?)');
const insertProvenance = out.prepare('INSERT OR IGNORE INTO reviewed_evidence_provenance VALUES (?, ?, ?, ?)');
const write = out.transaction(() => {
  insertSource.run(source.source_key, source.source_family, source.lang, `${source.lexicon_spec}; dual-model reviewed subset`, source.license, JSON.stringify(reviewedMetadata));
  for (const row of selected) {
    insertEvidence.run(row.source_key, row.source_family, row.lang, row.term, row.normalized_key, row.english_gloss, row.english_normalized_key, row.concept_id);
    insertMetadata.run(row.sense_id, row.zh_term, row.en_term, row.zh_pos, row.en_pos, row.sememe_definition);
    insertProvenance.run(row.candidate_key, row.concept_id, reviewedMetadata.probe_sha256, reviewedMetadata.consensus_sha256);
  }
});
write();
const integrity = out.pragma('integrity_check', { simple: true });
const counts = {
  candidates: candidates.length,
  lexical_evidence: out.prepare('SELECT COUNT(*) n FROM lexical_evidence').get().n,
  concepts: out.prepare('SELECT COUNT(*) n FROM openhownet_sense_metadata').get().n
};
out.close();
console.log(JSON.stringify({ ok: integrity === 'ok', out: path.relative(process.cwd(), outPath), integrity, counts }, null, 2));

function normalize(value) { return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en').replace(/\s+/gu, ' '); }
function normalizePos(value) { const text = normalize(value); if (['n', 'noun'].includes(text)) return 'noun'; if (['v', 'verb'].includes(text)) return 'verb'; if (['a', 'adj', 'adjective'].includes(text)) return 'adjective'; if (['r', 'adv', 'adverb'].includes(text)) return 'adverb'; return text; }
function posMatches(expected, actual) { return normalizePos(expected) === normalizePos(actual); }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function requiredPath(value) { if (!value) throw new Error('Missing required path argument'); const result = path.resolve(value); if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`); return result; }
function parseArgs(argv) { const out = {}; for (let i = 0; i < argv.length; i++) { if (!argv[i].startsWith('--')) continue; const key = argv[i].slice(2); const next = argv[i + 1]; if (next && !next.startsWith('--')) { out[key] = next; i++; } else out[key] = true; } return out; }
