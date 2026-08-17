#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const outPath = path.resolve(args.out || 'logs/product-source-gap-shared-concept.json');
const minTargetLangs = positiveInteger(args['min-target-langs'], 2);
const limit = positiveInteger(args.limit, Number.MAX_SAFE_INTEGER);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const rows = Array.isArray(report.selected) ? report.selected : [];
const selected = [];
const rejectedReasons = new Map();

for (const row of rows) {
  const lock = row?.reverse_evidence_prefilter?.wikidata_hint_lock;
  if (lock?.locked === true && lock?.concept_id) {
    selected.push({
      ...row,
      shared_concept_gate: {
        type: 'wikidata',
        concept_id: lock.concept_id,
        target_langs: Object.keys(row.generation_hints || {}).filter(
          (lang) => lang !== row.source_lang
        )
      }
    });
    if (selected.length >= limit) break;
    continue;
  }

  const concepts = new Map();
  for (const [lang, hint] of Object.entries(row.generation_hints || {})) {
    if (lang === row.source_lang) continue;
    for (const source of hint?.sources || []) {
      const match = /^omw:(\d{8}-[nvar])$/u.exec(String(source));
      if (!match) continue;
      if (!concepts.has(match[1])) concepts.set(match[1], new Set());
      concepts.get(match[1]).add(lang);
    }
  }
  const qualified = [...concepts]
    .filter(([, langs]) => langs.size >= minTargetLangs)
    .sort((left, right) => right[1].size - left[1].size || left[0].localeCompare(right[0]));
  if (!qualified.length) {
    increment(rejectedReasons, 'no_shared_omw_or_locked_wikidata_concept');
    continue;
  }
  const [conceptId, langs] = qualified[0];
  selected.push({
    ...row,
    shared_concept_gate: {
      type: 'omw',
      concept_id: conceptId,
      target_langs: [...langs].sort(),
      qualified_concept_count: qualified.length
    }
  });
  if (selected.length >= limit) break;
}

const output = {
  ...report,
  generated_at: new Date().toISOString(),
  source_report: path.relative(process.cwd(), reportPath),
  selected_count: selected.length,
  selected,
  shared_concept_policy: {
    minimum_non_source_target_languages: minTargetLangs,
    accepted_concept_types: ['omw_synset', 'locked_wikidata'],
    english_anchor_only_is_insufficient: true
  },
  shared_concept_summary: {
    input_rows: rows.length,
    selected_rows: selected.length,
    selected_by_source_lang: countBy(selected.map((row) => row.source_lang)),
    selected_by_concept_type: countBy(selected.map((row) => row.shared_concept_gate.type)),
    rejected_reasons: Object.fromEntries(rejectedReasons)
  }
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), ...output.shared_concept_summary }, null, 2));

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    result[key] = next && !next.startsWith('--') ? argv[++index] : true;
  }
  return result;
}

function requiredPath(value, label) {
  if (!value) throw new Error(`Missing --${label}`);
  const result = path.resolve(value);
  if (!fs.existsSync(result)) throw new Error(`${label} not found: ${result}`);
  return result;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Expected positive integer, got ${value}`);
  return parsed;
}

function countBy(values) {
  const result = {};
  for (const value of values) result[value] = (result[value] || 0) + 1;
  return result;
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}
