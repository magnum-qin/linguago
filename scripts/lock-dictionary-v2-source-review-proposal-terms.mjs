#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import * as OpenCC from 'opencc-js';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const outPath = path.resolve(args.out || 'logs/product-source-gap-source-review-terms-locked.json');
const report = readJson(reportPath);
const traditionalToSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });
const selected = [];
const rejected = [];

for (const row of report.selected || []) {
  const preferred = row?.candidate_evidence_review?.preferred_terms || {};
  const missing = ['en', 'pt-BR', 'zh', 'ja'].filter(
    (lang) => typeof preferred[lang] !== 'string' || !preferred[lang].trim()
  );
  const mismatches = ['en', 'pt-BR', 'zh', 'ja'].filter(
    (lang) => !matchesSuppliedHint(lang, preferred[lang], row?.generation_hints?.[lang]?.terms)
  );
  if (missing.length || mismatches.length) {
    rejected.push({
      source_entry_id: row.source_entry_id,
      source_sense_id: row.first_sense_id ?? row.source_sense_id,
      word: row.word,
      missing_languages: missing,
      evidence_mismatch_languages: mismatches
    });
    continue;
  }
  const generationHints = structuredClone(row.generation_hints || {});
  const originalTerms = {};
  for (const lang of ['en', 'pt-BR', 'zh', 'ja']) {
    originalTerms[lang] = generationHints[lang]?.terms || [];
    generationHints[lang] = {
      ...(generationHints[lang] || {}),
      terms: [preferred[lang].trim()]
    };
  }
  selected.push({
    ...row,
    generation_hints: generationHints,
    source_review_proposal_lock: {
      proposer_model_family: 'qwen',
      exact_evidence_match: true,
      original_terms: originalTerms,
      locked_terms: Object.fromEntries(
        ['en', 'pt-BR', 'zh', 'ja'].map((lang) => [lang, preferred[lang].trim()])
      ),
      independent_reviewer_must_review_same_terms: true
    }
  });
}

const output = {
  ok: rejected.length === 0,
  generated_at: new Date().toISOString(),
  source_report: relative(reportPath),
  policy: {
    proposed_terms_must_match_supplied_evidence: true,
    chinese_script_equivalence_allowed: true,
    independent_reviewer_reselects_terms: false,
    automatic_publication: false
  },
  summary: {
    input: (report.selected || []).length,
    selected: selected.length,
    rejected: rejected.length
  },
  rejected,
  selected_count: selected.length,
  selected
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: output.ok, out: relative(outPath), summary: output.summary }, null, 2));
if (!output.ok) process.exitCode = 1;

function matchesSuppliedHint(lang, preferred, supplied) {
  if (!Array.isArray(supplied) || !supplied.length) return false;
  const target = normalize(lang, preferred);
  return supplied.some((term) => normalize(lang, term) === target);
}

function normalize(lang, value) {
  const text = String(value || '').normalize('NFKC').trim();
  const normalized = lang === 'zh' ? traditionalToSimplified(text) : text;
  return normalized.toLocaleLowerCase(lang === 'pt-BR' ? 'pt-BR' : undefined);
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const filePath = path.resolve(value);
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return filePath;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
    parsed[key] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return parsed;
}
