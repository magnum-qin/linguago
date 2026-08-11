import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const probePath = requiredPath(args.probe);
const qwenPath = requiredPath(args.qwen);
const gemmaPath = requiredPath(args.gemma);
const outPath = path.resolve(args.out || '.tmp/ontopt/dicionario-aberto-reviewed-evidence.db');
const probe = JSON.parse(fs.readFileSync(probePath, 'utf8'));
const qwen = JSON.parse(fs.readFileSync(qwenPath, 'utf8'));
const gemma = JSON.parse(fs.readFileSync(gemmaPath, 'utf8'));
if (probe.research_only !== true || probe.production_publishable !== false) throw new Error('Expected research-only probe');
if (qwen.research_only !== true || gemma.research_only !== true) throw new Error('Expected research-only reviews');
if (qwen.model === gemma.model) throw new Error('Review models must be independent model families');
if (!/qwen/iu.test(qwen.model) || !/gemma/iu.test(gemma.model)) throw new Error('Expected Qwen and Gemma review reports');

const candidates = new Map((probe.review_candidates || []).map((row) => [row.candidate_key, row]));
const gemmaReviews = new Map((gemma.reviews || []).map((row) => [row.candidate_key, row]));
const accepted = [];
for (const qwenReview of qwen.reviews || []) {
  const gemmaReview = gemmaReviews.get(qwenReview.candidate_key);
  const candidate = candidates.get(qwenReview.candidate_key);
  if (!candidate || !qwenReview.approved || !gemmaReview?.approved) continue;
  const definitionOrders = (qwenReview.supporting_definition_orders || [])
    .filter((order) => (gemmaReview.supporting_definition_orders || []).includes(order));
  if (!definitionOrders.length) continue;
  accepted.push({ candidate, qwenReview, gemmaReview, definitionOrders });
}
if (!accepted.length) throw new Error('No dual-model consensus candidates');

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
  CREATE TABLE reviewed_definition_provenance (
    candidate_key TEXT PRIMARY KEY, concept_id TEXT NOT NULL,
    definition_orders_json TEXT NOT NULL, definitions_json TEXT NOT NULL,
    qwen_review_sha256 TEXT NOT NULL, gemma_review_sha256 TEXT NOT NULL
  );
`);
const qwenSha = sha256(fs.readFileSync(qwenPath));
const gemmaSha = sha256(fs.readFileSync(gemmaPath));
const sourceKey = `dicionario-aberto-definitions-reviewed-${sha256(`${qwenSha}:${gemmaSha}`).slice(0, 12)}`;
const metadata = {
  production_publishable: true,
  research_only: false,
  source_resource: probe.source_resource,
  source_url: probe.source_url,
  source_license: probe.license,
  semantic_review: 'independent_qwen_and_gemma_confidence_gte_0.9_with_definition_order_intersection',
  probe_sha256: sha256(fs.readFileSync(probePath)),
  qwen_review_sha256: qwenSha,
  gemma_review_sha256: gemmaSha,
  reviewed_candidate_count: accepted.length
};
const insertSource = out.prepare('INSERT INTO evidence_sources VALUES (?, ?, ?, ?, ?, ?)');
const insertEvidence = out.prepare('INSERT INTO lexical_evidence (source_key, source_family, lang, term, normalized_key, english_gloss, english_normalized_key, concept_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const insertProvenance = out.prepare('INSERT INTO reviewed_definition_provenance VALUES (?, ?, ?, ?, ?, ?)');
out.transaction(() => {
  insertSource.run(sourceKey, 'dicionario-aberto', 'pt-BR', 'Dicionario Aberto TEI definitions; dual-model reviewed subset', 'CC-BY-SA-2.5-PT', JSON.stringify(metadata));
  for (const row of accepted) {
    const conceptId = `dicionario-aberto-definition:${row.candidate.candidate_key}`;
    const selectedDefinitions = row.definitionOrders.map((order) => row.candidate.dicionario_aberto_definitions[order - 1]).filter(Boolean);
    insertEvidence.run(sourceKey, 'dicionario-aberto', 'pt-BR', row.candidate.term, normalize(row.candidate.term), row.candidate.english_anchor, normalize(row.candidate.english_anchor), conceptId);
    insertProvenance.run(row.candidate.candidate_key, conceptId, JSON.stringify(row.definitionOrders), JSON.stringify(selectedDefinitions), qwenSha, gemmaSha);
  }
})();
const integrity = out.pragma('integrity_check', { simple: true });
const counts = { candidates: accepted.length, lexical_evidence: out.prepare('SELECT COUNT(*) n FROM lexical_evidence').get().n };
out.close();
console.log(JSON.stringify({ ok: integrity === 'ok', out: path.relative(process.cwd(), outPath), integrity, counts, source_key: sourceKey }, null, 2));

function normalize(value) { return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en').replace(/\s+/gu, ' '); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function requiredPath(value) { if (!value) throw new Error('Missing required path argument'); const result = path.resolve(value); if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`); return result; }
function parseArgs(argv) { const out = {}; for (let i = 0; i < argv.length; i += 1) { if (!argv[i].startsWith('--')) continue; const key = argv[i].slice(2); const next = argv[i + 1]; out[key] = next && !next.startsWith('--') ? argv[++i] : true; } return out; }
