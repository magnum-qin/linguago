#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const args = parseArgs(process.argv.slice(2));
const preflightPath = requiredPath(args.preflight, 'preflight');
const candidatesPath = requiredPath(args.candidates, 'candidates');
const kaikkiPath = requiredPath(args.kaikki || 'data/raw/kaikki_Japanese.jsonl', 'kaikki');
const outPath = requiredPath(args.out, 'out', false);

const preflight = JSON.parse(fs.readFileSync(preflightPath, 'utf8'));
const candidates = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));
const candidateByKey = new Map(
  (candidates.selected || []).map((row) => [candidateKey(row), row])
);
const rejected = preflight.jmdict_preflight_rejected || [];
const targets = new Map();

for (const row of rejected) {
  const candidate = candidateByKey.get(candidateKey(row));
  const term = String(row.ja_term || candidate?.candidate_evidence_review?.preferred_terms?.ja || '').trim();
  const anchor = String(candidate?.candidate_evidence_review?.english_anchor || '').trim();
  if (!candidate || !term || !anchor) continue;
  if (!targets.has(term)) targets.set(term, []);
  targets.get(term).push({ row, candidate, anchor });
}

const matchesByKey = new Map();
const input = fs.createReadStream(kaikkiPath, { encoding: 'utf8' });
const lines = readline.createInterface({ input, crlfDelay: Infinity });
let linesScanned = 0;
let exactEntries = 0;

for await (const line of lines) {
  linesScanned += 1;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }
  const term = String(entry.word || '').trim();
  const targetRows = targets.get(term);
  if (!targetRows) continue;
  exactEntries += 1;
  const glosses = (entry.senses || []).flatMap((sense) => [
    ...(sense.glosses || []),
    ...(sense.raw_glosses || [])
  ]).filter(Boolean);
  const readings = extractReadings(entry, term);
  for (const target of targetRows) {
    const matchedGlosses = glosses.filter((gloss) => glossMatchesAnchor(gloss, target.anchor));
    if (!matchedGlosses.length || !readings.length) continue;
    const key = candidateKey(target.row);
    if (!matchesByKey.has(key)) matchesByKey.set(key, []);
    matchesByKey.get(key).push({
      term,
      readings,
      matched_glosses: unique(matchedGlosses),
      part_of_speech: entry.pos || null
    });
  }
}

const selected = [];
const unresolved = [];
for (const row of rejected) {
  const key = candidateKey(row);
  const candidate = candidateByKey.get(key);
  const matches = matchesByKey.get(key) || [];
  const canonicalReadings = unique(matches.flatMap((match) => match.readings).map(canonicalReading));
  if (candidate && canonicalReadings.length === 1) {
    selected.push({
      ...candidate,
      generation_contract: {
        ...(candidate.generation_contract || {}),
        ja_term: row.ja_term,
        ja_reading: canonicalReadings[0],
        ja_reading_variants: unique(matches.flatMap((match) => match.readings)),
        ja_reading_source: 'deterministic:kaikki-exact-term-anchor-sense',
        ja_reading_evidence: matches
      }
    });
  } else {
    unresolved.push({
      ...row,
      kaikki_matches: matches,
      kaikki_canonical_readings: canonicalReadings
    });
  }
}

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  derived_from: {
    preflight_report: relative(preflightPath),
    candidate_report: relative(candidatesPath),
    kaikki_source: relative(kaikkiPath)
  },
  policy: {
    exact_japanese_written_term: true,
    english_anchor_must_match_same_kaikki_entry: true,
    unique_canonical_reading_required: true,
    hiragana_katakana_equivalent: true,
    product_database_write: false
  },
  summary: {
    input_rejected: rejected.length,
    kaikki_lines_scanned: linesScanned,
    exact_term_entries: exactEntries,
    selected: selected.length,
    unresolved: unresolved.length
  },
  selected_count: selected.length,
  selected,
  unresolved
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out: relative(outPath), ...output.summary }, null, 2));

function extractReadings(entry, term) {
  const rubyReadings = [];
  for (const form of entry.forms || []) {
    if (form.form !== term || !Array.isArray(form.ruby)) continue;
    const reading = form.ruby.map((pair) => pair?.[1] || '').join('');
    if (reading) rubyReadings.push(reading);
  }
  if (rubyReadings.length) return unique(rubyReadings.map(normalizeReading).filter(Boolean));

  const soundReadings = [];
  for (const sound of entry.sounds || []) {
    const reading = String(sound.other || '').trim();
    if (reading && /^[\u3040-\u30ffー・\s]+$/u.test(reading)) soundReadings.push(reading);
  }
  return unique(soundReadings.map(normalizeReading).filter(Boolean));
}

function glossMatchesAnchor(gloss, anchor) {
  const normalizedGloss = normalizeEnglish(gloss);
  const normalizedAnchor = normalizeEnglish(anchor);
  if (!normalizedGloss || !normalizedAnchor) return false;
  if (normalizedGloss === normalizedAnchor) return true;
  const escaped = normalizedAnchor.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'u').test(normalizedGloss);
}

function normalizeEnglish(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en')
    .replace(/[‐‑‒–—]/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeReading(value) {
  return String(value || '').normalize('NFKC').replace(/[\s・]+/gu, '');
}

function canonicalReading(value) {
  return [...normalizeReading(value)].map((character) => {
    const code = character.codePointAt(0);
    return code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : character;
  }).join('');
}

function candidateKey(row) {
  return `${Number(row?.source_entry_id ?? row?.output?.source_entry_id)}:${Number(
    row?.first_sense_id ?? row?.source_sense_id ?? row?.output?.source_sense_id
  )}`;
}

function unique(values) {
  return [...new Set(values)];
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
