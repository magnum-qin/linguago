import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const triplesPath = requiredPath(args.triples);
const reportPath = requiredPath(args.report);
const sourceDbPath = requiredPath(args['source-db']);
const outPath = path.resolve(args.out || '.tmp/ontopt/dicionario-aberto-synonym-evidence.db');
const minFamilies = Math.max(2, Number(args['min-anchor-families'] || 2));

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const candidates = (report.selected || []).filter((row) => row.source_lang === 'pt-BR');
const candidateByTerm = new Map();
for (const row of candidates) {
  const key = normalize(row.word);
  if (!candidateByTerm.has(key)) candidateByTerm.set(key, []);
  candidateByTerm.get(key).push(row);
}

const relations = [];
for (const line of fs.readFileSync(triplesPath, 'utf8').split(/\r?\n/u)) {
  const match = line.trim().match(/^(.*?)\s+(SINONIMO_[NV]_DE)\s+(.*?)$/u);
  if (!match) continue;
  const left = cleanTerm(match[1]);
  const right = cleanTerm(match[3]);
  if (!left || !right || normalize(left) === normalize(right)) continue;
  const pos = match[2] === 'SINONIMO_N_DE' ? 'noun' : 'verb';
  if (candidateByTerm.has(normalize(left))) relations.push({ term: left, bridge: right, relation: match[2], pos });
  if (candidateByTerm.has(normalize(right))) relations.push({ term: right, bridge: left, relation: match[2], pos });
}

const sourceDb = new Database(sourceDbPath, { readonly: true, fileMustExist: true });
sourceDb.pragma('query_only = ON');
const findBridgeSenses = sourceDb.prepare(`
  SELECT ds.source_key, se.word, ss.part_of_speech, ss.gloss, ss.raw_json
  FROM source_entries se
  JOIN dictionary_sources ds ON ds.id = se.source_id
  JOIN source_senses ss ON ss.source_entry_id = se.id
  WHERE se.lang = 'pt-BR' AND se.normalized_key = ?
`);

const evidence = [];
const relationSeen = new Set();
for (const row of relations) {
  const relationKey = `${normalize(row.term)}\0${normalize(row.bridge)}\0${row.pos}`;
  if (relationSeen.has(relationKey)) continue;
  relationSeen.add(relationKey);
  const anchors = collectConsensusAnchors(findBridgeSenses.all(normalize(row.bridge)), row.pos, minFamilies);
  for (const anchor of anchors) {
    const candidateRows = candidateByTerm.get(normalize(row.term)) || [];
    const compatible = candidateRows.filter((candidate) => posCompatible(candidate.part_of_speech, row.pos));
    if (!compatible.length) continue;
    const conceptId = `dicionario-aberto:${sha256(`${normalize(row.term)}\0${row.relation}\0${normalize(row.bridge)}\0${anchor.normalized}`).slice(0, 24)}`;
    evidence.push({
      source_key: 'dicionario-aberto-ontopt-201308',
      source_family: 'dicionario-aberto',
      lang: 'pt-BR',
      term: row.term,
      normalized_key: normalize(row.term),
      english_gloss: anchor.gloss,
      english_normalized_key: anchor.normalized,
      concept_id: conceptId,
      relation: row.relation,
      part_of_speech: row.pos,
      bridge_term: row.bridge,
      supporting_families: anchor.families,
      candidate_keys: compatible.map((candidate) => candidate.candidate_key)
    });
  }
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
  CREATE TABLE dicionario_aberto_synonym_provenance (
    concept_id TEXT PRIMARY KEY, relation TEXT NOT NULL, part_of_speech TEXT NOT NULL,
    term TEXT NOT NULL, bridge_term TEXT NOT NULL, english_gloss TEXT NOT NULL,
    supporting_families_json TEXT NOT NULL, candidate_keys_json TEXT NOT NULL
  );
`);
const metadata = {
  production_publishable: true,
  research_only: false,
  resource: 'Onto.PT Dicionario Aberto relations extracted with PAPEL grammars',
  resource_url: 'https://ontopt.dei.uc.pt/index.php?sec=download_outros',
  archive: path.basename(triplesPath),
  archive_sha256: sha256(fs.readFileSync(triplesPath)),
  relation_policy: ['SINONIMO_N_DE', 'SINONIMO_V_DE'],
  bridge_policy: `English anchor must agree across at least ${minFamilies} independent source families`,
  candidate_report: path.basename(reportPath),
  candidate_report_sha256: sha256(fs.readFileSync(reportPath)),
  generated_at: new Date().toISOString()
};
const insertSource = out.prepare('INSERT INTO evidence_sources VALUES (?, ?, ?, ?, ?, ?)');
const insertEvidence = out.prepare(`INSERT OR IGNORE INTO lexical_evidence
  (source_key, source_family, lang, term, normalized_key, english_gloss, english_normalized_key, concept_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
const insertProvenance = out.prepare('INSERT OR IGNORE INTO dicionario_aberto_synonym_provenance VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
out.transaction(() => {
  insertSource.run(
    'dicionario-aberto-ontopt-201308', 'dicionario-aberto', 'pt-BR',
    'Onto.PT relacoes_da_201308; Dicionario Aberto noun/verb synonym relations',
    'CC-BY-3.0', JSON.stringify(metadata)
  );
  for (const row of evidence) {
    insertEvidence.run(row.source_key, row.source_family, row.lang, row.term, row.normalized_key, row.english_gloss, row.english_normalized_key, row.concept_id);
    insertProvenance.run(row.concept_id, row.relation, row.part_of_speech, row.term, row.bridge_term, row.english_gloss, JSON.stringify(row.supporting_families), JSON.stringify(row.candidate_keys));
  }
})();
const counts = {
  report_candidates: candidates.length,
  matching_relations: relationSeen.size,
  lexical_evidence: out.prepare('SELECT COUNT(*) n FROM lexical_evidence').get().n,
  covered_terms: out.prepare('SELECT COUNT(DISTINCT normalized_key) n FROM lexical_evidence').get().n
};
const integrity = out.pragma('integrity_check', { simple: true });
out.close();
console.log(JSON.stringify({ ok: integrity === 'ok', out: path.relative(process.cwd(), outPath), integrity, counts }, null, 2));

function collectConsensusAnchors(rows, expectedPos, requiredFamilies) {
  const support = new Map();
  for (const row of rows) {
    if (!posCompatible(row.part_of_speech, expectedPos)) continue;
    const family = sourceFamily(row.source_key);
    if (!family) continue;
    for (const gloss of englishGlosses(row)) {
      const normalized = normalize(gloss);
      if (!isUsefulEnglishAnchor(normalized)) continue;
      if (!support.has(normalized)) support.set(normalized, { gloss: gloss.trim(), normalized, families: new Set() });
      support.get(normalized).families.add(family);
    }
  }
  return [...support.values()]
    .filter((item) => item.families.size >= requiredFamilies)
    .map((item) => ({ ...item, families: [...item.families].sort() }))
    .sort((a, b) => b.families.length - a.families.length || a.gloss.length - b.gloss.length)
    .slice(0, 4);
}

function sourceFamily(sourceKey) {
  if (sourceKey === 'omw-30') return 'omw';
  if (sourceKey.startsWith('freedict-')) return 'freedict';
  if (sourceKey.startsWith('wikdict-') || sourceKey.startsWith('kaikki-')) return 'wiktionary';
  return null;
}

function englishGlosses(row) {
  const raw = safeJson(row.raw_json);
  if (row.source_key === 'omw-30') return strings(raw.localizations?.en);
  if (String(raw.target_lang || '') === 'en') return [...strings(raw.translations), ...splitGloss(row.gloss)];
  return [...strings(raw.glosses), ...splitGloss(row.gloss)];
}

function splitGloss(value) {
  return String(value || '').split(/[;,|]/u).map((part) => part.trim()).filter(Boolean);
}

function isUsefulEnglishAnchor(value) {
  return /^[a-z][a-z '-]{1,60}$/u.test(value) && !/^(?:inflection|form) of\b/u.test(value);
}

function posCompatible(actual, expected) {
  const normalized = normalizePos(actual);
  return !normalized || normalized === expected;
}

function normalizePos(value) {
  const text = normalize(value);
  if (['n', 'noun', 'substantivo'].includes(text)) return 'noun';
  if (['v', 'verb', 'verbo'].includes(text)) return 'verb';
  return text;
}

function cleanTerm(value) { return String(value || '').replaceAll('_', ' ').normalize('NFC').trim().replace(/\s+/gu, ' '); }
function normalize(value) { return cleanTerm(value).toLocaleLowerCase('pt-BR'); }
function strings(value) { return Array.isArray(value) ? value.map(String).filter(Boolean) : []; }
function safeJson(value) { try { return JSON.parse(value || '{}'); } catch { return {}; } }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function requiredPath(value) { if (!value) throw new Error('Missing required path argument'); const result = path.resolve(value); if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`); return result; }
function parseArgs(argv) { const result = {}; for (let i = 0; i < argv.length; i += 1) { const token = argv[i]; if (!token.startsWith('--')) continue; const key = token.slice(2); const next = argv[i + 1]; result[key] = next && !next.startsWith('--') ? argv[++i] : true; } return result; }
