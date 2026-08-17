import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as OpenCC from 'opencc-js';
import { bidirectionalTokenCoverage } from './lib/source-gap-lexical-contract.mjs';

const traditionalToSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });

const STOP_WORDS = new Set([
  'and', 'the', 'for', 'from', 'into', 'with', 'that', 'this', 'one', 'some',
  'someone', 'something', 'being', 'have', 'make', 'used', 'using', 'very'
]);

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(
  args.report || 'logs/product-source-gap-v98-evidence-acquisition-near-unlock1000.json'
);
const sourcePath = requiredPath(
  args.source || '.tmp/cedpane/PD-English-Definitions.tsv'
);
const outPath = path.resolve(
  args.out || 'logs/product-source-gap-v98-cedpane-near-unlock-probe.json'
);

const report = readJson(reportPath);
const candidates = (report.selected || []).filter((row) => row.target_lang === 'zh');
const source = buildSourceIndex(fs.readFileSync(sourcePath, 'utf8'));
const matches = [];
let termHits = 0;
let glossHits = 0;

for (const candidate of candidates) {
  const anchor = normalizeEnglish(candidate.english_anchor);
  const anchorTokens = contentTokens(anchor);
  let candidateTermHit = false;
  let candidateGlossHit = false;
  const candidateMatches = [];

  for (const proposedTerm of candidate.proposed_terms || []) {
    const term = normalizeChinese(proposedTerm);
    if (!term) continue;
    const rows = source.byTerm.get(term) || [];
    if (rows.length) candidateTermHit = true;
    for (const row of rows) {
      const similarity = bidirectionalTokenCoverage(anchorTokens, row.english_tokens);
      if (similarity.anchor_coverage < 0.67 || similarity.source_coverage < 0.67) continue;
      candidateGlossHit = true;
      candidateMatches.push({
        proposed_term: proposedTerm,
        source_term: row.term,
        source_term_raw: row.raw_term,
        english_gloss: row.english_gloss,
        gloss_overlap: similarity.overlap,
        anchor_coverage: similarity.anchor_coverage,
        source_coverage: similarity.source_coverage
      });
    }
  }

  if (candidateTermHit) termHits += 1;
  if (candidateGlossHit) glossHits += 1;
  if (!candidateMatches.length) continue;
  matches.push({
    candidate_key: candidate.candidate_key,
    source_entry_id: candidate.source_entry_id,
    source_sense_id: candidate.source_sense_id,
    word: candidate.word,
    source_lang: candidate.source_lang,
    frequency_rank: candidate.frequency_rank,
    target_lang: 'zh',
    english_anchor: candidate.english_anchor,
    observed_families: candidate.observed_families,
    accepted_terms: unique(candidateMatches.map((row) => row.source_term)),
    source_family: 'cedpane-pd-definitions',
    records: candidateMatches
      .sort((left, right) =>
        Math.min(right.anchor_coverage, right.source_coverage) -
        Math.min(left.anchor_coverage, left.source_coverage)
      )
      .slice(0, 10)
  });
}

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  policy: {
    diagnostic_only: true,
    publication_evidence: false,
    automatic_promotion: false,
    source_independent_from_cc_cedict: true,
    exact_simplified_chinese_term_required: true,
    minimum_anchor_content_token_coverage: 0.67,
    minimum_source_content_token_coverage: 0.67,
    final_reverse_evidence_required: true,
    mainland_chinese_preferred: true
  },
  source: {
    source_key: 'cedpane-pd-english-definitions',
    source_family: 'cedpane-pd-definitions',
    source_url: 'https://github.com/ssb22/CedPane',
    license: 'PDDL / Unlicense public-domain dedication',
    file: relative(sourcePath),
    sha256: sha256(fs.readFileSync(sourcePath)),
    parsed_rows: source.rows,
    unique_simplified_terms: source.byTerm.size
  },
  input: {
    report: relative(reportPath),
    selected_rows: (report.selected || []).length,
    zh_near_unlock_rows: candidates.length
  },
  summary: {
    zh_near_unlock_rows: candidates.length,
    exact_term_hits: termHits,
    term_and_gloss_hits: glossHits,
    newly_supported_candidates: matches.length,
    coverage_rate: candidates.length ? matches.length / candidates.length : 0
  },
  validations: matches.map((row) => ({
    candidate_key: row.candidate_key,
    target_lang: 'zh',
    decision: 'accept',
    accepted_terms: row.accepted_terms.map((term) => ({
      term,
      families: ['cedpane-pd-definitions'],
      region: 'mainland-compatible-simplified'
    }))
  })),
  matches
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out: relative(outPath), ...output.summary }, null, 2));

function buildSourceIndex(text) {
  const byTerm = new Map();
  let rows = 0;
  for (const rawLine of text.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    if (!rawLine.trim()) continue;
    const columns = rawLine.split('\t');
    if (columns.length < 3) continue;
    const rawTerm = String(columns[0] || '').normalize('NFKC').trim();
    const term = normalizeChinese(rawTerm);
    const englishGloss = String(columns.at(-1) || '').trim();
    const englishTokens = contentTokens(englishGloss);
    if (!term || !englishTokens.size) continue;
    rows += 1;
    if (!byTerm.has(term)) byTerm.set(term, []);
    byTerm.get(term).push({
      term,
      raw_term: rawTerm,
      english_gloss: englishGloss,
      english_tokens: englishTokens
    });
  }
  return { byTerm, rows };
}

function contentTokens(value) {
  return new Set(
    normalizeEnglish(value)
      .split(/[^a-z]+/u)
      .map(stemEnglish)
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
  );
}

function stemEnglish(token) {
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith('es')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1);
  return token;
}

function normalizeEnglish(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[“”"']/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeChinese(value) {
  return traditionalToSimplified(
    String(value || '').normalize('NFKC').replace(/\s+/gu, '').trim()
  );
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requiredPath(value) {
  const result = path.resolve(value);
  if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`);
  return result;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function relative(value) {
  return path.relative(process.cwd(), value);
}

function unique(values) {
  return [...new Set(values)];
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
