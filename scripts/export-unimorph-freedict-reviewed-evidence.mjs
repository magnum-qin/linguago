import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const candidatesPath = requiredPath(args.candidates, 'candidates');
const reviewsPath = requiredPath(args.reviews, 'reviews');
const outPath = path.resolve(args.out || '.tmp/unimorph-freedict-reviewed-evidence.db');
const reportOutPath = path.resolve(args['report-out'] || 'logs/unimorph-freedict-reviewed-evidence.json');
const candidates = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));
const reviews = JSON.parse(fs.readFileSync(reviewsPath, 'utf8'));
const rowsByKey = new Map((candidates.selected || []).map((row) => [candidateKey(row), row]));
const reviewByKey = new Map((reviews.reviews || []).map((row) => [candidateKey(row), row]));

const assessed = [];
for (const [key, row] of rowsByKey) {
  const review = reviewByKey.get(key);
  const reasons = [];
  if (!review?.valid || review.decision !== 'accept' || Number(review.confidence) < 0.9) reasons.push('review_not_approved');
  if ((review?.risk_flags || []).length) reasons.push('review_risk_flags');
  if ((row.morphology || []).length !== 1 || (row.lemma_matches || []).length !== 1) reasons.push('ambiguous_morphology_or_lemma');
  const morphology = row.morphology?.[0];
  if (!String(morphology?.features || '').split(';').includes('V.PTCP')) reasons.push('not_verb_participle');
  const translations = row.lemma_matches?.[0]?.freedict?.translations || [];
  const anchor = normalizeEnglish(row.anchor);
  const matchingTranslation = translations.find((translation) => englishPastParticiple(translation) === anchor) || null;
  if (!matchingTranslation) reasons.push('anchor_not_deterministically_derived');
  assessed.push({
    candidate_key: key,
    source_entry_id: row.source_entry_id,
    source_sense_id: row.source_sense_id,
    word: row.word,
    anchor: row.anchor,
    lemma: row.lemma_matches?.[0]?.lemma || null,
    features: morphology?.features || null,
    freedict_translation: matchingTranslation,
    decision: reasons.length ? 'reject' : 'accept',
    reasons
  });
}
const selected = assessed.filter((row) => row.decision === 'accept');

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.rmSync(outPath, { force: true });
const sourceHash = sha256(`${sha256File(candidatesPath)}:${sha256File(reviewsPath)}:pt-participle-v1`);
const sourceKey = `freedict-unimorph-reviewed-${sourceHash.slice(0, 12)}`;
const db = new Database(outPath);
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
  sourceKey, 'freedict', 'pt-BR',
  'FreeDict lemma translation bridged by UniMorph inflection and reviewed semantic alignment',
  'GPL-2.0-or-later AND CC-BY-SA-3.0',
  JSON.stringify({
    production_publishable: true,
    candidate_bound: true,
    morphology_is_not_an_independent_family: true,
    candidates_sha256: sha256File(candidatesPath),
    reviews_sha256: sha256File(reviewsPath),
    policy_version: 'pt-participle-v1',
    generated_at: new Date().toISOString()
  })
);
const insert = db.prepare(`INSERT OR IGNORE INTO lexical_evidence
  (source_key, source_family, lang, term, normalized_key, english_gloss, english_normalized_key, concept_id)
  VALUES (?, 'freedict', 'pt-BR', ?, ?, ?, ?, ?)`);
db.transaction(() => {
  for (const row of selected) {
    insert.run(sourceKey, row.word, normalizePortuguese(row.word), row.anchor, normalizeEnglish(row.anchor), `freedict-unimorph:${row.candidate_key}`);
  }
})();
db.pragma('journal_mode = DELETE');
const integrity = db.pragma('integrity_check', { simple: true });
db.close();
if (integrity !== 'ok') throw new Error(`Evidence DB integrity check failed: ${integrity}`);

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  policy: {
    qwen_review_min_confidence: 0.9,
    no_risk_flags: true,
    unique_unimorph_analysis: true,
    verb_participle_required: true,
    deterministic_english_participle_required: true
  },
  source_key: sourceKey,
  summary: { input_rows: assessed.length, accepted: selected.length, rejected: assessed.length - selected.length },
  selected,
  assessed
};
fs.mkdirSync(path.dirname(reportOutPath), { recursive: true });
fs.writeFileSync(reportOutPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), report_out: relative(reportOutPath), ...output.summary }, null, 2));

function englishPastParticiple(value) {
  const word = normalizeEnglish(value);
  if (!/^[a-z]+$/u.test(word)) return null;
  if (word.endsWith('e')) return `${word}d`;
  if (/[^aeiou]y$/u.test(word)) return `${word.slice(0, -1)}ied`;
  return `${word}ed`;
}
function candidateKey(row) { return `${Number(row.source_entry_id)}:${Number(row.source_sense_id ?? row.first_sense_id)}`; }
function normalizePortuguese(value) { return String(value || '').normalize('NFKC').toLocaleLowerCase('pt-BR').trim(); }
function normalizeEnglish(value) { return String(value || '').normalize('NFKC').toLowerCase().trim(); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function sha256File(filePath) { return sha256(fs.readFileSync(filePath)); }
function relative(filePath) { return path.relative(process.cwd(), filePath); }
function requiredPath(value, name) { if (!value) throw new Error(`Missing --${name}`); const result = path.resolve(value); if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`); return result; }
function parseArgs(argv) { const out = {}; for (let i = 0; i < argv.length; i += 1) { if (!argv[i].startsWith('--')) continue; const key = argv[i].slice(2); const next = argv[i + 1]; if (next && !next.startsWith('--')) { out[key] = next; i += 1; } else out[key] = true; } return out; }
