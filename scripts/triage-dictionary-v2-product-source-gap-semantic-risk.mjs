#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import * as OpenCC from 'opencc-js';

const LANGS = ['en', 'pt-BR', 'zh', 'ja'];
const traditionalToSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });
const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const outPath = requiredPath(args.out, 'out');
const limit = positiveInteger(args.limit, 20);
const maxRisk = nonNegativeNumber(args['max-risk'], 4);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const rows = Array.isArray(report.selected) ? report.selected : [];

const assessed = rows.map(assess).sort(
  (left, right) =>
    left.semantic_risk.score - right.semantic_risk.score ||
    Number(left.frequency_rank ?? Infinity) - Number(right.frequency_rank ?? Infinity) ||
    String(left.word).localeCompare(String(right.word))
);
const selected = assessed.filter((row) => row.semantic_risk.score <= maxRisk).slice(0, limit);
const output = {
  ...report,
  generated_at: new Date().toISOString(),
  semantic_risk_policy: {
    ranking_only: true,
    publication_evidence: false,
    max_risk: maxRisk,
    limit,
    downstream_source_review_required: true,
    downstream_reverse_evidence_required: true,
    downstream_independent_consensus_required: true
  },
  summary: {
    input_rows: rows.length,
    eligible_rows: assessed.filter((row) => row.semantic_risk.score <= maxRisk).length,
    selected_rows: selected.length,
    selected_by_lang: countBy(selected, (row) => row.source_lang),
    risk_reasons: countBy(assessed, (row) => row.semantic_risk.reasons, true)
  },
  selected_count: selected.length,
  selected,
  assessed
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), ...output.summary }, null, 2));

function assess(row) {
  const reasons = [];
  let score = 0;
  const sourceLang = String(row.source_lang || '');
  const pos = normalizePos(row.part_of_speech || row.useful_senses?.[0]?.part_of_speech);
  const targetLangs = LANGS.filter((lang) => lang !== sourceLang);
  const hints = Object.fromEntries(
    LANGS.map((lang) => [lang, (row?.generation_hints?.[lang]?.terms || []).map(String).filter(Boolean)])
  );
  const targetHintCount = targetLangs.reduce((sum, lang) => sum + hints[lang].length, 0);
  const maxTargetHints = Math.max(0, ...targetLangs.map((lang) => hints[lang].length));
  const parallelAgreement = row.parallel_dictionary_agreement || {};
  const parallelHighMismatchCount = Number(parallelAgreement.high_quality_mismatch_count || 0);
  const parallelLowMismatchCount = Number(parallelAgreement.low_quality_mismatch_count || 0);
  const parallelNearCount = Number(parallelAgreement.near_count || 0);
  if (parallelHighMismatchCount >= 2) add('parallel_dictionary_high_quality_mismatch_multiple', 6);
  else if (parallelHighMismatchCount === 1) add('parallel_dictionary_high_quality_mismatch_single', 3);
  if (parallelLowMismatchCount > 0) add('parallel_dictionary_low_quality_mismatch', 1);
  if (parallelNearCount > 0) add('parallel_dictionary_near_match', 1);
  if (maxTargetHints > 3) add('target_hint_fanout_gt_3', 3);
  else if (maxTargetHints > 2) add('target_hint_fanout_gt_2', 1);
  if (targetHintCount > 8) add('total_target_hints_gt_8', 3);
  else if (targetHintCount > 6) add('total_target_hints_gt_6', 1);
  for (const lang of targetLangs) {
    if (hasDistinctHintChoices(lang, hints[lang])) {
      add(`distinct_${lang}_hint_choices`, pos ? 3 : 5);
    }
  }

  const english = hints.en.map(normalizeLatin);
  if (english.some((value) => /^(?:sense|failure|original|job|task|thing|person|place|state|act|action)$/u.test(value))) {
    add('generic_english_anchor', 4);
  }
  if (english.some((value) => /\b(?:or|and)\b/u.test(value))) add('compound_or_alternative_anchor', 1);

  if (pos === 'adjective') {
    if (hints.zh.length && !hints.zh.some(chineseAdjectiveLike)) add('zh_pos_shape_mismatch', 2);
    if (hints.ja.length && !hints.ja.some(japaneseAdjectiveLike)) add('ja_pos_shape_mismatch', 2);
  }
  if (pos === 'verb') {
    if (hints.ja.length && !hints.ja.some(japaneseVerbLike)) add('ja_pos_shape_mismatch', 2);
  }

  const word = normalizeLatin(row.word);
  if (/(?:ado|ido)$/u.test(word) && english.some((value) => /atomic number \d+/u.test(value))) {
    add('participle_element_scope_mismatch', 8);
  }
  if (english.includes('one percent') && hints.ja.some((value) => String(value).includes('厘'))) {
    add('percentage_unit_mismatch', 8);
  }
  if (english.some((value) => /ebola (?:hemorrhagic )?fever/u.test(value)) && english.includes('ebola')) {
    add('pathogen_disease_scope_mix', 6);
  }
  if (english.includes('psychopathy') && english.some((value) => /mental (?:illness|disease)/u.test(value))) {
    add('specific_hypernym_scope_mix', 6);
  }
  const processWord = /(?:cao|ção|mento)$/u.test(word);
  if (processWord && english.some((value) => /(?:tion|ment|ing|process)$/u.test(value)) &&
      english.some((value) => !/(?:tion|ment|ing|process)$/u.test(value))) {
    add('process_result_anchor_mix', 4);
  }
  if (/(?:mento)$/u.test(word) && english.length && english.every((value) => !/(?:ment|ing|process|action|act)$/u.test(value))) {
    add('process_headword_object_anchor_mismatch', 6);
  }
  if (
    pos === 'verb' &&
    english.some((value) => /^(?:discriminate|differentiate|distinguish)$/u.test(value)) &&
    [...hints.zh, ...hints.ja].some((value) => /(?:歧视|差別)/u.test(String(value)))
  ) {
    add('neutral_social_discrimination_scope_mix', 6);
  }
  if (
    english.some((value) => /mandarin(?: orange)?/u.test(value)) &&
    hints.zh.some((value) => String(value).includes('普通话'))
  ) {
    add('mandarin_language_fruit_scope_mix', 8);
  }
  if (english.includes('muffin') && english.includes('gem')) {
    add('muffin_gem_scope_mix', 8);
  }
  if (word === 'sapateira' && english.some((value) => /^(?:cobbler|shoemaker)$/u.test(value))) {
    add('object_occupation_scope_mix', 8);
  }
  if (english.includes('platonism') && english.includes('realism')) {
    add('philosophy_school_scope_mix', 8);
  }
  if (
    english.includes('stamen') &&
    hints.zh.some((value) => String(value).includes('花蕊')) &&
    !hints.zh.some((value) => /(?:雄蕊|雄蕾)/u.test(String(value)))
  ) {
    add('specific_botanical_scope_mix', 8);
  }
  if (
    english.some((value) => /sinai peninsula/u.test(value)) &&
    hints.zh.some((value) => /(?:西奈山|半岛)$/u.test(String(value)))
  ) {
    add('specific_geographic_scope_mix', 8);
  }
  if (english.includes('calf') && english.includes('sura')) {
    add('anatomy_religious_homograph_mix', 8);
  }
  if (
    english.some((value) => /pleistocene/u.test(value)) &&
    hints.zh.length &&
    hints.zh.some((value) => /(?:冰期|冰川期|冰河期)/u.test(String(value))) &&
    !hints.zh.some((value) => String(value).includes('更新世'))
  ) {
    add('geological_epoch_glaciation_scope_mix', 8);
  }

  if (/(?:ectomia)$/u.test(word)) {
    if (!hints.zh.some((value) => /切除/u.test(value)) || !hints.ja.some((value) => /切除/u.test(value))) {
      add('procedure_scope_marker_missing', 5);
    }
  }
  if (/(?:ite)$/u.test(word) && english.some((value) => /itis$/u.test(value))) {
    if (!hints.zh.some((value) => /炎/u.test(value)) || !hints.ja.some((value) => /炎/u.test(value))) {
      add('inflammation_scope_marker_missing', 5);
    } else {
      score = Math.max(0, score - 2);
      reasons.push('concrete_inflammation_alignment');
    }
  }
  if (english.some((value) => /atomic number \d+/u.test(value))) {
    score = Math.max(0, score - 2);
    reasons.push('concrete_element_alignment');
  }
  if (english.some((value) => /^(?:amino acid|amine|polyethylene|polygon|termite|rainbow trout)$/u.test(value))) {
    score = Math.max(0, score - 1);
    reasons.push('concrete_canonical_concept');
  }

  return { ...row, semantic_risk: { score, reasons, target_hint_count: targetHintCount, max_target_hints: maxTargetHints } };

  function add(reason, points) {
    score += points;
    reasons.push(reason);
  }
}

function chineseAdjectiveLike(value) {
  return /(?:的|性)$/u.test(String(value));
}

function japaneseAdjectiveLike(value) {
  return /(?:い|な|の|的)$/u.test(String(value));
}

function japaneseVerbLike(value) {
  return /(?:する|す|る|う|く|ぐ|つ|ぬ|ぶ|む)$/u.test(String(value));
}

function normalizePos(value) {
  const text = String(value || '').toLowerCase();
  if (/^(?:adj|adjective)$/u.test(text)) return 'adjective';
  if (/^(?:v|verb)$/u.test(text)) return 'verb';
  if (/^(?:n|noun)$/u.test(text)) return 'noun';
  return text;
}

function normalizeLatin(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().trim();
}

function hasDistinctHintChoices(lang, values) {
  if (values.length < 2) return false;
  const normalized = values.map((value) => {
    const text = String(value || '').normalize('NFKC').trim().toLocaleLowerCase('und');
    if (lang === 'zh') return traditionalToSimplified(text);
    if (lang === 'en') return text.replace(/\bcentre\b/gu, 'center').replace(/[\s-]+/gu, ' ');
    return text;
  });
  return new Set(normalized).size > 1;
}

function countBy(rows, selector, flatten = false) {
  const counts = {};
  for (const row of rows) {
    const raw = selector(row);
    const values = flatten && Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      const key = String(value || 'none');
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const resolved = path.resolve(String(value));
  if (name === 'report' && !fs.existsSync(resolved)) throw new Error(`Report not found: ${resolved}`);
  return resolved;
}

function positiveInteger(value, fallback) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Invalid positive integer: ${value}`);
  return parsed;
}

function nonNegativeNumber(value, fallback) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid non-negative number: ${value}`);
  return parsed;
}

function relative(value) {
  return path.relative(process.cwd(), value);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      result[key] = next;
      index += 1;
    } else result[key] = 'true';
  }
  return result;
}
