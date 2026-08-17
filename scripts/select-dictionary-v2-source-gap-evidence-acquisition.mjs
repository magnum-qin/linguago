#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const evidencePath = requiredPath(args.evidence, 'evidence');
const attemptPath = requiredPath(args['attempt-index'], 'attempt-index');
const outPath = path.resolve(
  args.out || 'logs/product-source-gap-evidence-acquisition-candidates.json'
);
const limit = positiveInteger(args.limit, 500);
const excludeAttempted = args['exclude-attempted'] !== 'false';
const targetLangs = new Set(
  String(args['target-langs'] || 'zh,ja').split(',').map((value) => value.trim()).filter(Boolean)
);

const evidence = readJson(evidencePath);
const attempts = readJson(attemptPath);
const attemptedEntries = new Set();
const attemptedSenses = new Set();
for (const row of attempts.selected || []) {
  const entryId = String(row.source_entry_id ?? '');
  if (!entryId) continue;
  if (row.source_sense_id == null) attemptedEntries.add(entryId);
  else attemptedSenses.add(`${entryId}:${row.source_sense_id}`);
}

const candidates = [];
for (const row of evidence.validations || []) {
  if (!isEvidenceAcquisitionDecision(row)) continue;
  const entryId = String(row.source_entry_id ?? '');
  const senseId = String(row.source_sense_id ?? row.first_sense_id ?? '');
  if (
    !entryId ||
    (excludeAttempted && (attemptedEntries.has(entryId) || attemptedSenses.has(`${entryId}:${senseId}`)))
  ) {
    continue;
  }

  for (const targetLang of targetLangs) {
    if (targetLang === row.source_lang) continue;
    const hint = row.generation_hints?.[targetLang];
    const families = unique(hint?.evidence_families || []);
    if (families.length > 1) continue;
    candidates.push({
      source_entry_id: Number(entryId),
      source_sense_id: Number(senseId),
      candidate_key: row.candidate_key || `${entryId}:${senseId}`,
      word: row.word,
      source_lang: row.source_lang,
      frequency_rank: row.frequency_rank ?? null,
      part_of_speech: row.part_of_speech ?? null,
      english_anchor: row.evidence?.anchor || null,
      target_lang: targetLang,
      proposed_terms: hint?.terms || [],
      observed_families: families,
      missing_family_count: 2 - families.length,
      acquisition_priority: targetLang === 'zh' ? 2 : 1,
      recommended_source:
        targetLang === 'zh'
          ? 'mainland_chinese_lexical_source'
          : 'independent_japanese_lexical_source'
    });
  }
}

function isEvidenceAcquisitionDecision(row) {
  if (row?.decision === 'manual_review') return true;
  return row?.decision === 'unsupported' && [
    'insufficient_independent_target_evidence',
    'existing_localization_does_not_round_trip',
    'no_strong_reverse_dictionary_evidence'
  ].includes(row?.reason);
}

candidates.sort((left, right) =>
  left.missing_family_count - right.missing_family_count ||
  right.acquisition_priority - left.acquisition_priority ||
  Number(left.frequency_rank ?? Number.MAX_SAFE_INTEGER) -
    Number(right.frequency_rank ?? Number.MAX_SAFE_INTEGER) ||
  left.source_entry_id - right.source_entry_id
);

const selected = [];
const seen = new Set();
for (const row of candidates) {
  const key = `${row.candidate_key}:${row.target_lang}`;
  if (seen.has(key)) continue;
  seen.add(key);
  selected.push(row);
  if (selected.length >= limit) break;
}

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  evidence_report: relative(evidencePath),
  attempt_index: relative(attemptPath),
  policy: {
    diagnostic_only: true,
    publication_evidence: false,
    target_languages: [...targetLangs],
    maximum_existing_families: 1,
    historical_attempts_excluded: excludeAttempted,
    mainland_chinese_preferred: true
  },
  summary: {
    eligible_rows: candidates.length,
    selected_rows: selected.length,
    by_target_lang: countBy(selected, (row) => row.target_lang),
    by_existing_family_count: countBy(selected, (row) => String(row.observed_families.length)),
    by_recommended_source: countBy(selected, (row) => row.recommended_source)
  },
  selected
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary: output.summary }, null, 2));

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) throw new Error(`Missing file for --${name}: ${resolved}`);
  return resolved;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function unique(values) {
  return [...new Set(values.map((value) => String(value).trim().toLowerCase()).filter(Boolean))];
}

function countBy(rows, keyFn) {
  const result = {};
  for (const row of rows) {
    const key = String(keyFn(row));
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

function relative(filePath) {
  return path.relative(process.cwd(), filePath);
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
    } else parsed[key] = true;
  }
  return parsed;
}
