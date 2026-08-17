#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const candidatesPath = requiredPath(
  args.candidates || 'logs/product-coverage-gaps-v95-naer141-moj-mainland-first-aligned.json'
);
const probePath = requiredPath(
  args.probe || 'logs/product-source-gap-v97-jmdict-german-freedict-de-pivot-probe.json'
);
const evidencePath = requiredPath(
  args.evidence || 'logs/product-coverage-gaps-v97-northeuralex-mainland-first-strict-evidence.json'
);
const outPath = path.resolve(args.out || 'logs/product-source-gap-v97-jmdict-german-pivot-review100.json');
const limit = positiveInteger(args.limit, 100);

const candidateReport = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));
const probe = JSON.parse(fs.readFileSync(probePath, 'utf8'));
const evidenceReport = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
const candidateByKey = new Map(
  (candidateReport.selected || []).map((row) => [String(row.candidate_key), row])
);
const evidenceByKey = new Map(
  (evidenceReport.validations || []).map((row) => [String(row.candidate_key), row])
);
const eligible = (probe.matches || [])
  .filter((row) => {
    if (!row.production_evidence_candidate) return false;
    const aligned = evidenceByKey.get(String(row.candidate_key))?.evidence?.aligned_omw_terms;
    return aligned?.['pt-BR']?.length && aligned?.zh?.length;
  })
  .sort((left, right) =>
    Number(left.frequency_rank || Number.MAX_SAFE_INTEGER) -
      Number(right.frequency_rank || Number.MAX_SAFE_INTEGER) ||
    String(left.candidate_key).localeCompare(String(right.candidate_key))
  );

const uniqueEntries = [];
const seenEntries = new Set();
for (const row of eligible) {
  const key = String(row.source_entry_id);
  if (seenEntries.has(key)) continue;
  seenEntries.add(key);
  uniqueEntries.push(row);
}
const selectedProbeRows = evenlySpaced(uniqueEntries, Math.min(limit, uniqueEntries.length));
const selected = selectedProbeRows.map((probeRow) => {
  const candidate = structuredClone(candidateByKey.get(String(probeRow.candidate_key)));
  const strictEvidence = evidenceByKey.get(String(probeRow.candidate_key));
  if (!candidate) throw new Error(`Candidate missing for ${probeRow.candidate_key}`);
  if (!strictEvidence) throw new Error(`Strict evidence missing for ${probeRow.candidate_key}`);
  const alignedTerms = strictEvidence.evidence?.aligned_omw_terms || {};
  candidate.supplemental_evidence = [
    ...(candidate.supplemental_evidence || []),
    {
      source_key: 'jmdict-german-freedict-de-pivot-review',
      source_family: 'jmdict',
      lang: 'ja',
      term: probeRow.word,
      english_gloss: probeRow.english_anchor,
      german_overlap: probeRow.exact_german_overlap,
      alignment: 'exact Japanese form and exact German pivot overlap',
      production_publishable: false
    }
  ];
  candidate.supplemental_evidence_langs = [
    ...new Set([...(candidate.supplemental_evidence_langs || []), 'ja'])
  ];
  candidate.supplemental_evidence_lang_count = candidate.supplemental_evidence_langs.length;
  candidate.generation_hints = {
    ...(candidate.generation_hints || {}),
    en: {
      terms: [probeRow.english_anchor],
      sources: ['source_english_anchor', ...(strictEvidence.evidence?.matching_sources || [])],
      provenance: 'source_english_anchor',
      evidence_families: strictEvidence.evidence?.matching_source_families || []
    },
    'pt-BR': {
      terms: alignedTerms['pt-BR'],
      sources: ['omw-30'],
      provenance: 'omw_synset',
      evidence_families: ['omw']
    },
    zh: {
      terms: alignedTerms.zh,
      sources: ['omw-30'],
      provenance: 'omw_synset',
      evidence_families: ['omw']
    },
    ja: {
      terms: [probeRow.word],
      sources: ['jmdict-german-freedict-de-pivot-review'],
      provenance: 'candidate_bound_exact_german_pivot',
      evidence_families: ['jmdict']
    }
  };
  candidate.pivot_review = {
    family: 'jmdict',
    english_anchor: probeRow.english_anchor,
    german_overlap: probeRow.exact_german_overlap,
    previous_reason: probeRow.previous_reason,
    production_publishable: false
  };
  return candidate;
});

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_report: path.relative(process.cwd(), candidatesPath),
  probe_report: path.relative(process.cwd(), probePath),
  evidence_report: path.relative(process.cwd(), evidencePath),
  policy: {
    selection: 'unique source entries evenly sampled across frequency-sorted eligible pivot candidates',
    no_database_write: true,
    production_publishable: false
  },
  summary: {
    eligible_candidates: eligible.length,
    eligible_unique_source_entries: uniqueEntries.length,
    selected_rows: selected.length,
    selected_unique_source_entries: new Set(selected.map((row) => row.source_entry_id)).size
  },
  selected
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2));

function evenlySpaced(rows, count) {
  if (count >= rows.length) return rows;
  if (count === 1) return [rows[0]];
  const result = [];
  const used = new Set();
  for (let index = 0; index < count; index += 1) {
    const position = Math.round((index * (rows.length - 1)) / (count - 1));
    if (!used.has(position)) {
      used.add(position);
      result.push(rows[position]);
    }
  }
  return result;
}
function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || String(fallback), 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Invalid positive integer: ${value}`);
  return parsed;
}
function requiredPath(value) {
  const resolved = path.resolve(String(value || ''));
  if (!value || !fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  return resolved;
}
function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const value = argv[index + 1];
    parsed[key] = value && !value.startsWith('--') ? argv[++index] : 'true';
  }
  return parsed;
}
