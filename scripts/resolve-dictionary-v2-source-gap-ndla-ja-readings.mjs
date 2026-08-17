#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const unresolvedPath = requiredPath(args.unresolved, 'unresolved');
const candidatesPath = requiredPath(args.candidates, 'candidates');
const lexiconPath = requiredPath(args.lexicon || 'data/raw/government-lexicons/ndla/ndlsh-tsv/ndlsh-tsv.tsv', 'lexicon');
const outPath = requiredPath(args.out, 'out', false);
const unresolvedReport = readJson(unresolvedPath);
const candidateReport = readJson(candidatesPath);
const candidateByKey = new Map((candidateReport.selected || []).map((row) => [candidateKey(row), row]));
const authorities = loadAuthorities(lexiconPath);
const selected = [];
const remaining = [];

for (const row of unresolvedReport.unresolved || []) {
  const candidate = candidateByKey.get(candidateKey(row));
  const jaTerm = String(row.ja_term || candidate?.candidate_evidence_review?.preferred_terms?.ja || '').trim();
  const englishAnchor = normalizeEnglish(candidate?.candidate_evidence_review?.english_anchor);
  const matches = candidate ? resolveMatches(jaTerm, englishAnchor, authorities) : [];
  const readings = unique(matches.map((match) => match.reading));
  if (candidate && readings.length === 1) {
    selected.push({
      ...candidate,
      generation_contract: {
        ...(candidate.generation_contract || {}),
        ja_term: jaTerm,
        ja_reading: readings[0],
        ja_reading_variants: readings,
        ja_reading_source: 'deterministic:ndla-subject-heading',
        ja_reading_evidence: matches
      }
    });
  } else {
    remaining.push({ ...row, ndla_matches: matches, ndla_readings: readings });
  }
}

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  derived_from: {
    unresolved_report: relative(unresolvedPath),
    candidate_report: relative(candidatesPath),
    lexicon: relative(lexiconPath),
    lexicon_sha256: sha256(lexiconPath)
  },
  policy: {
    authority: 'National Diet Library, Japan - Web NDL Authorities (NDLSH)',
    terms_url: 'https://id.ndl.go.jp/information/use/',
    attribution_required: 'Data obtained from Web NDL Authorities',
    exact_heading_or_reading_annotated_synonym: true,
    derived_suffix_rule: 'exact preferred heading + 学 only when an authority source title contains the full term',
    english_anchor_rule: 'exact English synonym, explicit asphalt-bitumen equivalence, or source-title-bound 学 derivation',
    product_database_write: false
  },
  summary: {
    input_unresolved: (unresolvedReport.unresolved || []).length,
    indexed_authorities: authorities.length,
    selected: selected.length,
    unresolved: remaining.length
  },
  selected_count: selected.length,
  selected,
  unresolved: remaining
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out: relative(outPath), ...output.summary }, null, 2));

function resolveMatches(jaTerm, englishAnchor, rows) {
  const matches = [];
  for (const authority of rows) {
    if (authority.heading === jaTerm && anchorMatches(englishAnchor, authority.englishSynonyms)) {
      matches.push(evidence(authority, hira(authority.reading), 'exact_preferred_heading'));
    }
    for (const synonym of authority.synonyms) {
      if (synonym.term === jaTerm && synonym.reading && anchorMatches(englishAnchor, authority.englishSynonyms)) {
        matches.push(evidence(authority, hira(synonym.reading), 'exact_reading_annotated_synonym'));
      }
    }
    if (jaTerm.endsWith('学') && authority.heading === jaTerm.slice(0, -1) && authority.sources.includes(jaTerm)) {
      matches.push(evidence(authority, `${hira(authority.reading)}がく`, 'source_title_bound_gaku_suffix'));
    }
  }
  return uniqueBy(matches, (match) => `${match.authority_id}:${match.reading}:${match.match_rule}`);
}

function anchorMatches(anchor, synonyms) {
  if (!anchor) return false;
  const normalized = synonyms.map(normalizeEnglish);
  if (normalized.includes(anchor)) return true;
  return (anchor === 'asphalt' && normalized.includes('bitumen')) ||
    (anchor === 'bitumen' && normalized.includes('asphalt'));
}

function evidence(authority, reading, matchRule) {
  return {
    authority_id: authority.id,
    authority_uri: `https://id.ndl.go.jp/auth/ndlsh/${authority.id}`,
    heading: authority.heading,
    heading_reading: authority.reading,
    reading,
    english_synonyms: authority.englishSynonyms,
    lcsh: authority.lcsh,
    sources: authority.sources,
    match_rule: matchRule
  };
}

function loadAuthorities(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, '').split(/\r?\n/u);
  return lines.slice(1).filter(Boolean).map((line) => {
    const columns = line.split('\t');
    const rawSynonyms = String(columns[3] || '').split(/[;；]/u).map((value) => value.trim()).filter(Boolean);
    return {
      heading: String(columns[0] || '').trim(),
      reading: String(columns[1] || '').trim(),
      id: String(columns[2] || '').trim(),
      synonyms: rawSynonyms.map(parseSynonym),
      englishSynonyms: rawSynonyms.filter((value) => /^[\p{Script=Latin}\s'-]+$/u.test(value)),
      lcsh: String(columns[11] || '').trim(),
      sources: String(columns[14] || '').trim()
    };
  });
}

function parseSynonym(value) {
  const match = value.match(/^(.*)\[([^\]]+)\]$/u);
  return match ? { term: match[1].trim(), reading: match[2].trim() } : { term: value, reading: '' };
}

function hira(value) {
  return String(value || '').normalize('NFKC').replace(/[ァ-ヶ]/gu, (character) => String.fromCodePoint(character.codePointAt(0) - 0x60));
}

function normalizeEnglish(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/gu, ' ').trim();
}

function candidateKey(row) {
  return `${Number(row?.source_entry_id ?? row?.output?.source_entry_id)}:${Number(row?.first_sense_id ?? row?.source_sense_id ?? row?.output?.source_sense_id)}`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function uniqueBy(values, keyOf) {
  return [...new Map(values.map((value) => [keyOf(value), value])).values()];
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function relative(value) {
  return path.relative(process.cwd(), value);
}

function requiredPath(value, name, mustExist = true) {
  if (!value) throw new Error(`Missing --${name}`);
  const result = path.resolve(value);
  if (mustExist && !fs.existsSync(result)) throw new Error(`File not found: ${result}`);
  return result;
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    out[key] = next && !next.startsWith('--') ? argv[++index] : true;
  }
  return out;
}
