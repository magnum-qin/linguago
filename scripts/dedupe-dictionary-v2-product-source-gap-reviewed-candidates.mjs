#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const outPath = path.resolve(required(args.out, 'out'));
const limit = integer(args.limit, Number.MAX_SAFE_INTEGER, 1);
const allowRiskFlags = args['allow-risk-flags'] === 'true';
const allowResolvedRiskFlags = args['allow-resolved-risk-flags'] === 'true';
const report = readJson(reportPath);
const rows = Array.isArray(report.selected) ? report.selected : [];

const groups = new Map();
for (const row of rows) {
  const review = row?.candidate_evidence_review;
  if (review?.decision !== 'accept' || review?.approved === false) continue;
  const riskFlags = Array.isArray(review?.risk_flags) ? review.risk_flags : [];
  if (
    riskFlags.length &&
    !allowRiskFlags &&
    !(allowResolvedRiskFlags && riskFlags.every(isResolvedRiskFlag))
  ) continue;
  const key = semanticKey(row);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
}

const selected = [];
for (const [semanticKeyValue, group] of groups) {
  const representative = structuredClone(group[0]);
  representative.semantic_candidate_key = semanticKeyValue;
  representative.coalesced_source_senses = group.map((row) => ({
    source_entry_id: Number(row.source_entry_id),
    source_sense_id: Number(row.first_sense_id ?? row.source_sense_id),
    candidate_key: row.candidate_key || candidateKey(row)
  }));
  selected.push(representative);
  if (selected.length >= limit) break;
}

const output = {
  ...report,
  generated_at: new Date().toISOString(),
  derived_from: path.relative(process.cwd(), reportPath),
  selected_count: selected.length,
  selected,
  semantic_dedupe: {
    policy: 'source_entry+review_anchor+canonical_pos+preferred_terms',
    risk_flags_allowed: allowRiskFlags,
    resolved_risk_flags_allowed: allowResolvedRiskFlags,
    input_rows: rows.length,
    reviewed_rows: [...groups.values()].reduce((sum, group) => sum + group.length, 0),
    semantic_groups: groups.size,
    selected_groups: selected.length,
    coalesced_rows: [...groups.values()].reduce((sum, group) => sum + Math.max(0, group.length - 1), 0),
    multi_source_groups: [...groups.values()].filter((group) => group.length > 1).length
  }
};

function isResolvedRiskFlag(value) {
  const flag = String(value || '').trim();
  if (!flag) return false;
  const resolved = /(excluded|ignored|corrected|rejected in favor|but (?:the )?(?:selected|preferred|primary|precise|correct)|also (?:present|listed).*(?:correct|align)|provided as an alternative.*specific|in context.*(?:correct|unambiguous)|context (?:implies|disambiguates)|given the (?:explicit )?(?:gloss|anchor|context)|specific gloss|can also mean|polysem|ambiguous|secondary meaning|associated with.*but|context.*acceptable|context.*accepted)/iu;
  const registerOnly = /\b(colloquial|archaic|loanword origin|katakana loan|spelling variant|outdated terminology)\b/iu;
  const unresolved = /not strict|wrong|mismatch|broader than|narrower than|hypernym|subset|different sense|implies .* rather|usually means .*not|slightly narrower|wrong part|noun, source|noun form for verb|specific to .* while|female-specific|singular|plural/iu;
  return (resolved.test(flag) || registerOnly.test(flag)) && !unresolved.test(flag);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), ...output.semantic_dedupe }, null, 2));

function semanticKey(row) {
  const review = row.candidate_evidence_review || {};
  const preferredTerms = Object.fromEntries(
    Object.entries(review.preferred_terms || {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([lang, value]) => [lang, normalize(value)])
  );
  return [
    Number(row.source_entry_id),
    normalize(review.english_anchor || row.gloss_key || row.gloss_preview),
    canonicalPartOfSpeech(row.part_of_speech),
    JSON.stringify(preferredTerms)
  ].join('|');
}

function canonicalPartOfSpeech(value) {
  const normalized = normalize(value);
  return ({ adj: 'adjective', adv: 'adverb', n: 'noun', v: 'verb', prep: 'preposition' })[normalized] || normalized;
}

function candidateKey(row) {
  return `${Number(row?.source_entry_id)}:${Number(row?.first_sense_id ?? row?.source_sense_id)}`;
}

function normalize(value) {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ');
}

function required(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return String(value);
}

function requiredPath(value, name) {
  const result = path.resolve(required(value, name));
  if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`);
  return result;
}

function integer(value, fallback, minimum) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < minimum) throw new Error(`Invalid integer: ${value}`);
  return parsed;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) parsed[key] = argv[++index];
    else parsed[key] = 'true';
  }
  return parsed;
}
