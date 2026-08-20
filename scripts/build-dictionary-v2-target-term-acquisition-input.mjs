#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const outPath = path.resolve(args.out || 'logs/product-target-term-acquisition-input.json');
const targetLang = String(args['target-lang'] || 'pt-BR');
const limit = positiveInteger(args.limit, 100);
const offset = nonNegativeInteger(args.offset, 0);
const maxRank = positiveInteger(args['max-rank'], 50000);
if (!['pt-BR', 'zh', 'ja'].includes(targetLang)) throw new Error(`Unsupported target language: ${targetLang}`);

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const selected = (report.validations || [])
  .filter((row) => row.decision === 'supported')
  .filter((row) => row.source_lang !== targetLang)
  .filter((row) => !(row.generation_hints?.[targetLang]?.terms || []).length)
  .filter((row) => Number(row.frequency_rank || Number.MAX_SAFE_INTEGER) <= maxRank)
  .map((row) => ({
    candidate_key: String(row.candidate_key || `${row.source_entry_id}:${row.source_sense_id}`),
    bound_candidate_key: String(row.candidate_key || `${row.source_entry_id}:${row.source_sense_id}`),
    source_entry_id: row.source_entry_id,
    source_sense_id: row.source_sense_id ?? row.first_sense_id,
    word: row.word,
    source_lang: row.source_lang,
    target_lang: targetLang,
    english_anchor: String(row.evidence?.anchor || '').trim(),
    part_of_speech: row.part_of_speech || null,
    frequency_rank: row.frequency_rank,
    existing_terms: [],
    existing_target_languages: Object.keys(row.generation_hints || {}).filter(
      (lang) => lang !== row.source_lang && (row.generation_hints?.[lang]?.terms || []).length
    )
  }))
  .filter((row) => row.english_anchor)
  .sort((left, right) =>
    Number(left.frequency_rank || Number.MAX_SAFE_INTEGER) - Number(right.frequency_rank || Number.MAX_SAFE_INTEGER) ||
    String(left.word).localeCompare(String(right.word))
  )
  .slice(offset, offset + limit);

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_report: path.relative(process.cwd(), reportPath),
  policy: {
    source_decision_must_be_supported: true,
    target_hint_must_be_missing: true,
    llm_suggestions_are_not_evidence: true,
    downstream_independent_dictionary_validation_required: true
  },
  summary: {
    target_lang: targetLang,
    max_rank: maxRank,
    offset,
    selected: selected.length,
    by_source_lang: countBy(selected, (row) => row.source_lang)
  },
  selected
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2));

function countBy(values, selector) {
  const counts = {};
  for (const value of values) {
    const key = String(selector(value));
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}
function positiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Invalid positive integer: ${value}`);
  return parsed;
}
function nonNegativeInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Invalid non-negative integer: ${value}`);
  return parsed;
}
function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  return resolved;
}
function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) parsed[key] = argv[++index];
    else parsed[key] = true;
  }
  return parsed;
}
