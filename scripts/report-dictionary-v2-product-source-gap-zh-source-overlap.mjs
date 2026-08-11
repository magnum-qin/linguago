import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const capacityPath = path.resolve(
  args.report || 'logs/product-v93-manual-evidence-capacity.json'
);
const sourceDbPath = path.resolve(args['source-db'] || 'data/processed/linguago_v2_full.db');
const supplementalDbPath = path.resolve(
  args['supplemental-db'] ||
    '.tmp/combined/v90-production5000-ecdict-extracted-japanese-wordnet-biunique-evidence.db'
);
const outPath = path.resolve(args.out || 'logs/product-source-gap-zh-source-overlap.json');
const limit = boundedInteger(args.limit, Number.MAX_SAFE_INTEGER, 1);

for (const file of [capacityPath, sourceDbPath, supplementalDbPath]) {
  if (!fs.existsSync(file)) throw new Error(`Required input not found: ${file}`);
}

const capacity = JSON.parse(fs.readFileSync(capacityPath, 'utf8'));
const candidates = (capacity.near_unlock || [])
  .filter((row) => row?.source_lang === 'zh')
  .slice(0, limit);
const sourceDb = new Database(sourceDbPath, { readonly: true, fileMustExist: true });
const supplementalDb = new Database(supplementalDbPath, {
  readonly: true,
  fileMustExist: true
});

const selectCedict = sourceDb.prepare(`
  SELECT se.word, se.normalized_key, ss.sense_order, ss.gloss
  FROM source_entries se
  JOIN dictionary_sources ds ON ds.id = se.source_id
  JOIN source_senses ss ON ss.source_entry_id = se.id
  WHERE ds.source_key = 'cc-cedict'
    AND (se.word = ? OR se.normalized_key = ?)
  ORDER BY ss.sense_order
`);
const hasOpenHowNetMetadata = Boolean(
  supplementalDb.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'openhownet_sense_metadata'").get()
);
const selectOpenHowNet = supplementalDb.prepare(`
  SELECT e.source_key, e.term, e.normalized_key, e.english_gloss, e.concept_id
         ${hasOpenHowNetMetadata ? ', m.zh_pos, m.en_pos, m.sememe_definition' : ''}
  FROM lexical_evidence e
  ${hasOpenHowNetMetadata ? "LEFT JOIN openhownet_sense_metadata m ON 'openhownet:' || m.sense_id = e.concept_id" : ''}
  WHERE e.source_family = 'openhownet'
    AND e.lang = 'zh'
    AND e.normalized_key = ?
  ORDER BY e.source_key, e.english_normalized_key, e.concept_id
`);

const rows = candidates.map((candidate) => inspectCandidate(candidate));
sourceDb.close();
supplementalDb.close();

const researchCandidates = uniqueBy(rows.filter((row) => row.pilot_candidate).map((row) => ({
  candidate_key: row.candidate_key,
  word: row.word,
  source_lang: 'zh',
  english_anchor: row.anchor,
  expected_pos: row.expected_pos,
  zh_term: row.word,
  matching_concepts: row.openhownet.evidence
    .filter((item) => item.overlap !== 'none' && item.pos_binding !== 'conflict')
    .map((item) => item.concept_id),
  sememe_definitions: unique(row.openhownet.evidence
    .filter((item) => item.overlap !== 'none' && item.pos_binding !== 'conflict')
    .map((item) => item.sememe_definition)),
  status: 'semantic_review_required',
  generation_allowed: false,
  publication_evidence: false
})), (row) => `${normalizeEnglish(row.word)}\u0000${normalizeEnglish(row.english_anchor)}`);

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  inputs: {
    capacity_report: relative(capacityPath),
    source_db: relative(sourceDbPath),
    supplemental_db: relative(supplementalDbPath)
  },
  policy: {
    diagnostic_only: true,
    research_only: true,
    production_publishable: false,
    publication_evidence: false,
    warning:
      'Exact headword coverage alone is not sense evidence. Only exact or phrase-level English anchor overlap is a pilot signal and still requires the existing independent-evidence gate.'
  },
  summary: {
    candidates: rows.length,
    utf8_headwords_valid: rows.filter((row) => row.utf8_headword_valid).length,
    cedict_headword_covered: rows.filter((row) => row.cc_cedict.headword_covered).length,
    cedict_anchor_overlap: rows.filter((row) => row.cc_cedict.anchor_overlap).length,
    openhownet_headword_covered: rows.filter((row) => row.openhownet.headword_covered).length,
    openhownet_anchor_overlap: rows.filter((row) => row.openhownet.anchor_overlap).length,
    any_headword_covered: rows.filter((row) => row.any_headword_covered).length,
    any_anchor_overlap: rows.filter((row) => row.any_anchor_overlap).length,
    pilot_candidates: researchCandidates.length
  },
  research_candidates: researchCandidates,
  rows
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary: output.summary }, null, 2));

function inspectCandidate(candidate) {
  const word = String(candidate.word || '').normalize('NFC');
  const anchor = String(candidate.anchor || '').trim();
  const expectedPos = inferExpectedPos(candidate);
  const cedictRows = uniqueEvidence(
    selectCedict.all(word, word).map((row) => ({
      source_key: 'cc-cedict',
      term: row.word,
      gloss: row.gloss,
      sense_order: row.sense_order,
      overlap: classifyEnglishOverlap(anchor, row.gloss)
    }))
  );
  const openHowNetRows = uniqueEvidence(
    selectOpenHowNet.all(word).map((row) => ({
      source_key: row.source_key,
      term: row.term,
      gloss: row.english_gloss,
      concept_id: row.concept_id,
      zh_pos: normalizePos(row.zh_pos),
      en_pos: normalizePos(row.en_pos),
      sememe_definition: row.sememe_definition || null,
      overlap: classifyEnglishOverlap(anchor, row.english_gloss),
      pos_binding: classifyPosBinding(expectedPos, row.en_pos, row.zh_pos)
    }))
  );
  const cedictOverlap = cedictRows.some((row) => row.overlap !== 'none');
  const openHowNetOverlap = openHowNetRows.some((row) => row.overlap !== 'none');
  const anyHeadwordCovered = cedictRows.length > 0 || openHowNetRows.length > 0;
  const anyAnchorOverlap = cedictOverlap || openHowNetOverlap;
  const boundOpenHowNetOverlap = openHowNetRows.some(
    (row) => row.overlap !== 'none' && row.pos_binding !== 'conflict'
  );

  return {
    candidate_key: candidate.candidate_key,
    source_entry_id: candidate.source_entry_id,
    source_sense_id: candidate.source_sense_id,
    word,
    word_code_points: [...word].map((char) => `U+${char.codePointAt(0).toString(16).toUpperCase()}`),
    utf8_headword_valid: isUsableChineseHeadword(word),
    frequency_rank: candidate.frequency_rank,
    anchor,
    expected_pos: expectedPos,
    cc_cedict: {
      headword_covered: cedictRows.length > 0,
      anchor_overlap: cedictOverlap,
      evidence: cedictRows
    },
    openhownet: {
      headword_covered: openHowNetRows.length > 0,
      anchor_overlap: openHowNetOverlap,
      evidence: openHowNetRows
    },
    any_headword_covered: anyHeadwordCovered,
    any_anchor_overlap: anyAnchorOverlap,
    pilot_candidate: isUsableChineseHeadword(word) && (cedictOverlap || boundOpenHowNetOverlap)
  };
}

function inferExpectedPos(candidate) {
  const explicit = normalizePos(candidate.part_of_speech);
  if (explicit) return explicit;
  const inferred = unique((candidate.aligned_omw_synsets || [])
    .map((synset) => String(synset).match(/-([nvar])$/iu)?.[1])
    .map((suffix) => ({ n: 'noun', v: 'verb', a: 'adjective', r: 'adverb' })[suffix])
    .filter(Boolean));
  return inferred.length === 1 ? inferred[0] : null;
}

function normalizePos(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ({
    n: 'noun', noun: 'noun',
    v: 'verb', verb: 'verb',
    a: 'adjective', adj: 'adjective', adjective: 'adjective',
    r: 'adverb', adv: 'adverb', adverb: 'adverb'
  })[normalized] || null;
}

function classifyPosBinding(expected, enPos, zhPos) {
  const en = normalizePos(enPos);
  const zh = normalizePos(zhPos);
  if (expected && en === expected && zh === expected) return 'exact';
  if (en && zh && en === zh) return expected ? 'conflict' : 'internal_consistent';
  return expected ? 'conflict' : 'unknown';
}

function classifyEnglishOverlap(anchor, gloss) {
  const left = normalizeEnglish(anchor);
  const right = normalizeEnglish(gloss);
  if (!left || !right) return 'none';
  if (left === right) return 'exact';
  if (left.length >= 4 && right.length >= 4 && (left.includes(right) || right.includes(left))) {
    return 'phrase';
  }
  const leftTokens = contentTokens(left);
  const rightTokens = new Set(contentTokens(right));
  if (leftTokens.length && leftTokens.every((token) => rightTokens.has(token))) return 'token_containment';
  return 'none';
}

function normalizeEnglish(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function contentTokens(value) {
  const stop = new Set(['a', 'an', 'and', 'at', 'be', 'for', 'in', 'of', 'on', 'or', 'the', 'to']);
  return value.split(' ').filter((token) => token.length >= 2 && !stop.has(token));
}

function isUsableChineseHeadword(value) {
  return Boolean(value) && /\p{Script=Han}/u.test(value) && !/\uFFFD/u.test(value);
}

function uniqueEvidence(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.source_key}\u0000${row.term}\u0000${row.gloss}\u0000${row.concept_id || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function uniqueBy(values, keyFn) {
  const seen = new Set();
  return values.filter((value) => {
    const key = keyFn(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function relative(file) {
  return path.relative(process.cwd(), file);
}

function boundedInteger(value, fallback, minimum) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) return fallback;
  return parsed;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}
