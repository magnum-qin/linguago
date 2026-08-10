#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import * as OpenCC from 'opencc-js';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const outPath = requiredPath(args.out, 'out', false);
const sourceDbPath = path.resolve(args['source-db'] || 'data/processed/linguago_v2_full.db');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const rows = Array.isArray(report.selected) ? report.selected : [];
const traditionalToSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });
const sourceDb = new Database(sourceDbPath, { readonly: true, fileMustExist: true });
const sourceMetadataBySense = sourceDb.prepare(`
  SELECT ds.source_key, ss.raw_json
  FROM sense_source_links ssl
  JOIN source_senses ss ON ss.id = ssl.source_sense_id
  JOIN source_entries se ON se.id = ss.source_entry_id
  JOIN dictionary_sources ds ON ds.id = se.source_id
  WHERE ssl.sense_id = ?
`);

const assessed = rows.map((row) => {
  const checks = parallelChecks(row);
  const mismatchCount = checks.filter((item) => item.status === 'mismatch').length;
  const highQualityMismatchCount = checks.filter(
    (item) => item.status === 'mismatch' && item.wikdict_quality === 'high'
  ).length;
  const lowQualityMismatchCount = checks.filter(
    (item) => item.status === 'mismatch' && item.wikdict_quality === 'low'
  ).length;
  const nearCount = checks.filter((item) => item.status === 'near').length;
  return {
    ...row,
    parallel_dictionary_agreement: {
      policy: 'diagnostic_only',
      mismatch_count: mismatchCount,
      high_quality_mismatch_count: highQualityMismatchCount,
      low_quality_mismatch_count: lowQualityMismatchCount,
      near_count: nearCount,
      checked_languages: [...new Set(checks.map((item) => item.lang))],
      checks
    }
  };
});

const output = {
  ...report,
  generated_at: new Date().toISOString(),
  parallel_agreement_policy: {
    diagnostic_only: true,
    publication_evidence: false,
    exact_or_containment_is_agreement: true,
    cjk_near_match_is_not_automatic_agreement: true,
    mismatches_require_source_review: true
  },
  summary: {
    input_rows: rows.length,
    rows_with_parallel_checks: assessed.filter((row) => row.parallel_dictionary_agreement.checks.length).length,
    rows_with_mismatch: assessed.filter((row) => row.parallel_dictionary_agreement.mismatch_count).length,
    rows_with_near_match: assessed.filter((row) => row.parallel_dictionary_agreement.near_count).length,
    checks_by_status: countBy(assessed.flatMap((row) => row.parallel_dictionary_agreement.checks), (row) => row.status),
    mismatches_by_lang: countBy(
      assessed.flatMap((row) => row.parallel_dictionary_agreement.checks).filter((row) => row.status === 'mismatch'),
      (row) => row.lang
    ),
    mismatches_by_quality: countBy(
      assessed.flatMap((row) => row.parallel_dictionary_agreement.checks).filter((row) => row.status === 'mismatch'),
      (row) => row.wikdict_quality
    )
  },
  selected_count: assessed.length,
  selected: assessed
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), ...output.summary }, null, 2));

function parallelChecks(row) {
  const hints = Object.fromEntries(
    Object.entries(row.generation_hints || {}).map(([lang, value]) => [lang, terms(value?.terms || [])])
  );
  const checks = [];
  for (const candidate of row?.sense_alignment?.candidates || []) {
    const lang = wikdictTargetLanguage(candidate.source);
    if (!lang || lang === row.source_lang || !hints[lang]?.length) continue;
    const parallelTerms = terms(splitTerms(candidate.gloss_key));
    if (!parallelTerms.length) continue;
    const status = compareTermSets(parallelTerms, hints[lang]);
    const metadata = wikdictMetadata(candidate.sense_id, candidate.source);
    checks.push({
      lang,
      source: candidate.source,
      status,
      wikdict_quality: metadata.quality,
      wikdict_score: metadata.score,
      wikdict_is_good: metadata.is_good,
      wikdict_lexentry: metadata.lexentry,
      parallel_terms: parallelTerms.map((item) => item.raw),
      generation_hint_terms: hints[lang].map((item) => item.raw)
    });
  }
  return checks;
}

function wikdictMetadata(senseId, sourceKey) {
  const row = sourceMetadataBySense.all(Number(senseId)).find((item) => item.source_key === sourceKey);
  const raw = safeJson(row?.raw_json);
  const wikdict = raw.wikdict || {};
  const score = Number(wikdict.score || 0);
  const isGood = Number(wikdict.is_good || 0);
  return {
    quality: isGood === 1 && score >= 20 ? 'high' : 'low',
    score,
    is_good: isGood,
    lexentry: wikdict.lexentry || null
  };
}

function wikdictTargetLanguage(source) {
  const match = String(source || '').match(/^wikdict-(?:pt|ja|zh|en)-(en|pt|ja|zh)$/u);
  if (!match) return null;
  return { en: 'en', pt: 'pt-BR', zh: 'zh', ja: 'ja' }[match[1]];
}

function compareTermSets(left, right) {
  for (const a of left) {
    for (const b of right) {
      if (a.normalized === b.normalized) return 'exact';
      const minLength = isCjk(a.normalized) || isCjk(b.normalized) ? 2 : 3;
      if (
        a.normalized.length >= minLength &&
        b.normalized.length >= minLength &&
        (a.normalized.includes(b.normalized) || b.normalized.includes(a.normalized))
      ) return 'containment';
    }
  }
  for (const a of left) {
    for (const b of right) {
      if (cjkNearMatch(a.normalized, b.normalized)) return 'near';
    }
  }
  return 'mismatch';
}

function cjkNearMatch(left, right) {
  if (!isCjk(left) || !isCjk(right)) return false;
  const leftSet = new Set([...left]);
  const rightSet = new Set([...right]);
  const shared = [...leftSet].filter((char) => rightSet.has(char)).length;
  return shared >= 2 && shared / Math.min(leftSet.size, rightSet.size) >= 0.6;
}

function terms(values) {
  return values.map((raw) => ({ raw: String(raw), normalized: normalize(raw) })).filter((item) => item.normalized);
}

function splitTerms(value) {
  return String(value || '').split(/[;|,/]/u).map((item) => item.trim()).filter(Boolean);
}

function normalize(value) {
  return traditionalToSimplified(String(value || '').normalize('NFKC').toLowerCase())
    .replace(/[\s'\u2019-]/gu, '')
    .trim();
}

function isCjk(value) {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(String(value));
}

function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = String(selector(row) || 'none');
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function safeJson(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function requiredPath(value, name, mustExist = true) {
  if (!value) throw new Error(`Missing --${name}`);
  const resolved = path.resolve(String(value));
  if (mustExist && !fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  return resolved;
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
