#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const jmdictPath = requiredPath(args.jmdict || 'data/raw/JMdict_e.gz', 'jmdict');
const outPath = requiredPath(args.out, 'out');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const jaSuggestionTerms = args['ja-suggestions']
  ? loadJaSuggestionTerms(requiredPath(args['ja-suggestions'], 'ja-suggestions'))
  : new Map();
const excludeKeys = args['exclude-report']
  ? loadCandidateKeys(requiredPath(args['exclude-report'], 'exclude-report'))
  : new Set();
const readings = await loadReadings(jmdictPath);
const selected = [];
const rejected = [];

for (const row of report.selected || []) {
  if (excludeKeys.has(candidateKey(row))) continue;
  const preferredTerm = String(row?.candidate_evidence_review?.preferred_terms?.ja || '').trim();
  const suggestedTerm = String(row?.candidate_evidence_review?.suggested_terms?.ja || '').trim();
  const nativeSourceTerm = row?.source_lang === 'ja' ? String(row.word || '').trim() : '';
  const candidates = uniqueTerms([
    preferredTerm && { term: preferredTerm, source: 'reviewed:preferred-term' },
    nativeSourceTerm && { term: nativeSourceTerm, source: 'deterministic:jmdict-source-headword' },
    suggestedTerm && { term: suggestedTerm, source: 'reviewed:suggested-term+jmdict-exact' },
    ...(jaSuggestionTerms.get(candidateKey(row)) || []).map((term) => ({
      term,
      source: 'reviewed:ja-generation-term-suggestion+jmdict-exact'
    }))
  ].filter(Boolean));
  if (!candidates.length) {
    rejected.push(reject(row, 'missing_reviewed_ja_term', '', []));
    continue;
  }
  const attempts = candidates.map(({ term, source }) => resolveGenerationContract(term, source, readings));
  const resolved = attempts.find((attempt) => attempt.ok);
  if (resolved) selected.push(withGenerationContract(row, resolved.contract));
  else {
    const first = attempts[0];
    rejected.push(reject(row, first.reason, first.term, first.expected));
  }
}

const output = {
  ...report,
  generated_at: new Date().toISOString(),
  derived_from: { ...(report.derived_from || {}), jmdict_preflight_report: path.relative(process.cwd(), reportPath) },
  selection_policy: {
    ...(report.selection_policy || {}),
    require_jmdict_ja_term: true,
    allow_reviewed_suggested_ja_term_with_jmdict_exact_match: true,
    allow_reviewed_ja_generation_term_suggestions_with_jmdict_exact_match: true,
    require_unique_jmdict_ja_reading: true,
    hiragana_katakana_equivalent_for_reading_uniqueness: true,
    unique_jmdict_priority_reading_allowed: true
  },
  selected_count: selected.length,
  selected,
  jmdict_preflight_rejected: rejected,
  jmdict_preflight_summary: {
    input: (report.selected || []).length - excludeKeys.size,
    excluded: excludeKeys.size,
    selected: selected.length,
    rejected: rejected.length,
    rejected_by_reason: countBy(rejected.map((row) => row.reason))
  }
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out: path.relative(process.cwd(), outPath), ...output.jmdict_preflight_summary }, null, 2));

async function loadReadings(filePath) {
  const map = new Map();
  const stream = fs.createReadStream(filePath).pipe(zlib.createGunzip());
  let buffer = '';
  for await (const chunk of stream) {
    buffer += chunk.toString('utf8');
    while (true) {
      const start = buffer.indexOf('<entry>');
      if (start < 0) { buffer = buffer.slice(-32); break; }
      const end = buffer.indexOf('</entry>', start);
      if (end < 0) { if (start > 0) buffer = buffer.slice(start); break; }
      addEntry(map, buffer.slice(start + 7, end));
      buffer = buffer.slice(end + 8);
    }
  }
  return map;
}
function addEntry(map, entry) {
  const terms = [...entry.matchAll(/<keb>([\s\S]*?)<\/keb>/gu)].map((match) => decodeXml(match[1]).trim());
  for (const readingMatch of entry.matchAll(/<r_ele>([\s\S]*?)<\/r_ele>/gu)) {
    const block = readingMatch[1];
    const reb = block.match(/<reb>([\s\S]*?)<\/reb>/u);
    if (!reb) continue;
    const reading = normalizeReading(decodeXml(reb[1]));
    const priorities = [...block.matchAll(/<re_pri>([\s\S]*?)<\/re_pri>/gu)]
      .map((match) => decodeXml(match[1]).trim())
      .filter(Boolean);
    const restrictions = [...block.matchAll(/<re_restr>([\s\S]*?)<\/re_restr>/gu)].map((match) => decodeXml(match[1]).trim());
    for (const term of restrictions.length ? restrictions : terms) {
      if (!map.has(term)) map.set(term, new Map());
      if (!map.get(term).has(reading)) map.get(term).set(reading, new Set());
      for (const priority of priorities) map.get(term).get(reading).add(priority);
    }
  }
}
function reject(row, reason, term, expected) { return { source_entry_id: row.source_entry_id, source_sense_id: row.first_sense_id, word: row.word, reason, ja_term: term, expected_readings: expected }; }
function resolveGenerationContract(term, termSource, readingIndex) {
  if (kanaOnly(term)) {
    return { ok: true, contract: { term, termSource, reading: katakanaToHiragana(normalizeReading(term)), readingVariants: [term], readingSource: 'deterministic:kana-self', priorityTags: [] } };
  }
  const readingRecords = readingIndex.get(term) || new Map();
  const expected = [...readingRecords.keys()];
  if (!expected.length) return { ok: false, reason: 'ja_term_not_in_jmdict', term, expected };
  const canonicalReadings = uniqueCanonicalReadings(expected);
  const prioritizedReadings = uniqueCanonicalReadings([...readingRecords.entries()].filter(([, priorities]) => priorities.size > 0).map(([reading]) => reading));
  const selectedReadings = canonicalReadings.length === 1 ? canonicalReadings : prioritizedReadings.length === 1 ? prioritizedReadings : [];
  if (selectedReadings.length !== 1) return { ok: false, reason: 'ja_reading_not_unique', term, expected };
  return { ok: true, contract: {
    term, termSource, reading: selectedReadings[0], readingVariants: expected,
    readingSource: canonicalReadings.length === 1 ? expected.length === 1 ? 'deterministic:jmdict-unique' : 'deterministic:jmdict-unique-kana-normalized' : 'deterministic:jmdict-unique-priority',
    priorityTags: canonicalReadings.length === 1 ? [] : [...new Set([...readingRecords.entries()].filter(([reading]) => katakanaToHiragana(reading) === selectedReadings[0]).flatMap(([, priorities]) => [...priorities]))].sort()
  } };
}
function withGenerationContract(row, contract) {
  return {
    ...row,
    generation_contract: {
      ...(row.generation_contract || {}),
      ja_term: contract.term,
      ja_term_source: contract.termSource,
      ja_reading: contract.reading,
      ja_reading_variants: contract.readingVariants,
      ja_reading_source: contract.readingSource,
      ja_reading_priority_tags: contract.priorityTags
    }
  };
}
function kanaOnly(value) { return /^[\u3040-\u30ff\s]+$/u.test(value); }
function normalizeReading(value) { return String(value).normalize('NFKC').replace(/[\s・]+/gu, ''); }
function uniqueCanonicalReadings(values) {
  return [...new Set(values.map((value) => katakanaToHiragana(normalizeReading(value))))];
}
function katakanaToHiragana(value) {
  return [...value].map((character) => {
    const code = character.codePointAt(0);
    return code >= 0x30a1 && code <= 0x30f6
      ? String.fromCodePoint(code - 0x60)
      : character;
  }).join('');
}
function loadCandidateKeys(filePath) {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const rows = [
    ...(value.selected || []),
    ...(value.generated || []),
    ...(value.accepted || [])
  ];
  return new Set(rows.map(candidateKey));
}
function loadJaSuggestionTerms(filePath) {
  const report = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const out = new Map();
  for (const row of report.suggestions || []) {
    if (row?.valid !== true) continue;
    out.set(candidateKey(row), (row.terms || []).map((term) => String(term).trim()).filter(Boolean));
  }
  return out;
}
function uniqueTerms(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = row.term.normalize('NFKC');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function candidateKey(row) {
  return `${Number(row?.source_entry_id ?? row?.output?.source_entry_id)}:${Number(
    row?.first_sense_id ?? row?.source_sense_id ?? row?.output?.source_sense_id
  )}`;
}
function decodeXml(value) { return String(value).replace(/&amp;/gu, '&').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&quot;/gu, '"').replace(/&apos;/gu, "'"); }
function countBy(values) { const out = {}; for (const value of values) out[value] = (out[value] || 0) + 1; return out; }
function requiredPath(value, name) { if (!value) throw new Error(`Missing --${name}`); const result = path.resolve(value); if (name !== 'out' && !fs.existsSync(result)) throw new Error(`File not found: ${result}`); return result; }
function parseArgs(argv) { const out = {}; for (let i = 0; i < argv.length; i += 1) { if (!argv[i].startsWith('--')) continue; const key = argv[i].slice(2); const next = argv[i + 1]; out[key] = next && !next.startsWith('--') ? argv[++i] : true; } return out; }
