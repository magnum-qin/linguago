import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const sourceDir = requiredPath(args['source-dir']);
const reportPath = requiredPath(args.report);
const outPath = path.resolve(args.out || '.tmp/ejdict/ejdict-supplemental-evidence.db');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const candidates = report.selected || [];

const rowsByEnglish = new Map();
for (const filePath of fs.readdirSync(sourceDir).filter((name) => name.endsWith('.txt')).map((name) => path.join(sourceDir, name))) {
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/u)) {
    const tab = line.indexOf('\t');
    if (tab <= 0) continue;
    const headwords = line.slice(0, tab).split(',').map(cleanEnglish).filter(Boolean);
    const japanese = line.slice(tab + 1).trim();
    const terms = extractJapaneseTerms(japanese);
    if (!terms.size) continue;
    for (const headword of headwords) {
      const key = normalizeEnglish(headword);
      if (!rowsByEnglish.has(key)) rowsByEnglish.set(key, []);
      rowsByEnglish.get(key).push({ headword, japanese, terms });
    }
  }
}

const evidence = [];
let candidatesWithJapaneseTerms = 0;
let candidatesWithEnglishRows = 0;
let candidateEnglishRowPairs = 0;
for (const candidate of candidates) {
  const japaneseTerms = candidateJapaneseTerms(candidate);
  if (!japaneseTerms.length) continue;
  candidatesWithJapaneseTerms += 1;
  const anchors = englishAnchors(candidate);
  for (const anchor of anchors) {
    const englishRows = rowsByEnglish.get(normalizeEnglish(anchor)) || [];
    if (englishRows.length) candidatesWithEnglishRows += 1;
    candidateEnglishRowPairs += englishRows.length;
    for (const row of englishRows) {
      const matchedTerms = japaneseTerms.filter((term) => row.terms.has(normalizeJapanese(term)));
      for (const term of matchedTerms) {
        evidence.push({
          term,
          normalized_key: normalizeJapanese(term),
          english_gloss: row.headword,
          english_normalized_key: normalizeEnglish(row.headword),
          concept_id: `ejdict:${sha256(`${normalizeEnglish(row.headword)}\0${normalizeJapanese(term)}`).slice(0, 24)}`,
          candidate_key: candidate.candidate_key || `${candidate.source_entry_id}:${candidate.first_sense_id}`,
          raw_definition: row.japanese
        });
      }
    }
  }
}

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
  CREATE TABLE ejdict_evidence_provenance (
    concept_id TEXT PRIMARY KEY, candidate_keys_json TEXT NOT NULL,
    raw_definitions_json TEXT NOT NULL
  );
`);
const metadata = {
  production_publishable: true,
  research_only: false,
  source_url: 'https://github.com/kujirahand/EJDict',
  license: 'CC0-1.0',
  source_commit: readGitHead(path.resolve(sourceDir, '..')),
  extraction_policy: 'exact English headword and exact parsed Japanese translation term',
  source_notes: 'Long-running human-maintained public-domain dictionary; 2025-2026 AI-assisted proofreading disclosed upstream',
  report_sha256: sha256(fs.readFileSync(reportPath)),
  generated_at: new Date().toISOString()
};
const sourceKey = `ejdict-hand-${String(metadata.source_commit || 'snapshot').slice(0, 12)}`;
const insertSource = out.prepare('INSERT INTO evidence_sources VALUES (?, ?, ?, ?, ?, ?)');
const insertEvidence = out.prepare('INSERT OR IGNORE INTO lexical_evidence (source_key, source_family, lang, term, normalized_key, english_gloss, english_normalized_key, concept_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const grouped = new Map();
for (const row of evidence) {
  if (!grouped.has(row.concept_id)) grouped.set(row.concept_id, { ...row, candidate_keys: new Set(), definitions: new Set() });
  grouped.get(row.concept_id).candidate_keys.add(row.candidate_key);
  grouped.get(row.concept_id).definitions.add(row.raw_definition);
}
const insertProvenance = out.prepare('INSERT INTO ejdict_evidence_provenance VALUES (?, ?, ?)');
out.transaction(() => {
  insertSource.run(sourceKey, 'ejdict', 'ja', 'EJDict-hand English-Japanese dictionary exact lexical subset', 'CC0-1.0', JSON.stringify(metadata));
  for (const row of grouped.values()) {
    insertEvidence.run(sourceKey, 'ejdict', 'ja', row.term, row.normalized_key, row.english_gloss, row.english_normalized_key, row.concept_id);
    insertProvenance.run(row.concept_id, JSON.stringify([...row.candidate_keys]), JSON.stringify([...row.definitions]));
  }
})();
const integrity = out.pragma('integrity_check', { simple: true });
const counts = { input_candidates: candidates.length, candidates_with_japanese_terms: candidatesWithJapaneseTerms, candidates_with_english_rows: candidatesWithEnglishRows, candidate_english_row_pairs: candidateEnglishRowPairs, indexed_english_headwords: rowsByEnglish.size, lexical_evidence: out.prepare('SELECT COUNT(*) n FROM lexical_evidence').get().n, covered_terms: out.prepare('SELECT COUNT(DISTINCT normalized_key) n FROM lexical_evidence').get().n };
out.close();
console.log(JSON.stringify({ ok: integrity === 'ok', out: path.relative(process.cwd(), outPath), integrity, counts, source_key: sourceKey }, null, 2));

function candidateJapaneseTerms(row) {
  const values = [];
  if (row.source_lang === 'ja') values.push(row.word);
  for (const localization of row.first_sense_localizations || []) if (localization?.lang === 'ja') values.push(localization.term);
  return unique(values.flatMap(splitTerms).map(cleanJapanese).filter((term) => term.length >= 2 && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(term)));
}
function englishAnchors(row) {
  const english = (row.first_sense_localizations || []).find((item) => item?.lang === 'en');
  return unique(splitTerms(english?.term || row.gloss_key || row.gloss_preview || '').map(cleanEnglish).filter((term) => /^[a-z][a-z '-]{1,60}$/iu.test(term)));
}
function extractJapaneseTerms(value) {
  const cleaned = String(value || '').replace(/《[^》]*》/gu, ' ').replace(/〈[^〉]*〉/gu, ' ');
  const parts = [...cleaned.matchAll(/『([^』]+)』/gu)].map((match) => match[1]);
  for (const segment of cleaned.split(/\s*\/\s*/u)) {
    const withoutNotes = segment.replace(/\([^)]*\)/gu, ' ').replace(/（[^）]*）/gu, ' ').replace(/《[^》]*》/gu, ' ').replace(/『|』/gu, ' ');
    parts.push(...withoutNotes.split(/[;,、，；]/u));
  }
  return new Set(parts.map(cleanJapanese).filter((term) => term.length >= 2 && term.length <= 30 && !/[A-Za-z]/u.test(term)));
}
function splitTerms(value) { return String(value || '').split(/[;,|/]/u).map((part) => part.trim()).filter(Boolean); }
function cleanEnglish(value) { return String(value || '').replace(/^=+/u, '').replace(/\[[^\]]*\]/gu, '').trim(); }
function cleanJapanese(value) { return String(value || '').normalize('NFKC').trim().replace(/^[…・]+|[。.!?…・]+$/gu, '').replace(/\s+/gu, ' '); }
function normalizeEnglish(value) { return cleanEnglish(value).normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/gu, ' '); }
function normalizeJapanese(value) { return cleanJapanese(value).toLocaleLowerCase('ja'); }
function unique(values) { return [...new Set(values)]; }
function readGitHead(repoPath) { try { const head = fs.readFileSync(path.join(repoPath, '.git', 'HEAD'), 'utf8').trim(); if (!head.startsWith('ref: ')) return head; return fs.readFileSync(path.join(repoPath, '.git', head.slice(5)), 'utf8').trim(); } catch { return null; } }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function requiredPath(value) { if (!value) throw new Error('Missing required path argument'); const result = path.resolve(value); if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`); return result; }
function parseArgs(argv) { const out = {}; for (let i = 0; i < argv.length; i += 1) { if (!argv[i].startsWith('--')) continue; const key = argv[i].slice(2); const next = argv[i + 1]; out[key] = next && !next.startsWith('--') ? argv[++i] : true; } return out; }
