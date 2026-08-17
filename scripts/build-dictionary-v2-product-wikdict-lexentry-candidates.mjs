#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const LANGS = ['en', 'pt-BR', 'zh', 'ja'];
const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const sourceDbPath = path.resolve(args['source-db'] || 'data/processed/linguago_v2_full.db');
const outPath = path.resolve(
  args.out || 'logs/product-coverage-gaps-wikdict-lexentry-candidates.json'
);
const minTargetLangs = boundedInteger(args['min-target-langs'], 3, 1);
const minScore = boundedNumber(args['min-score'], 20, 0);
const limit = boundedInteger(args.limit, Number.MAX_SAFE_INTEGER, 1);
const inputReasons = new Set(
  String(args['input-reasons'] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);

if (!fs.existsSync(sourceDbPath)) throw new Error(`Source DB not found: ${sourceDbPath}`);

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const reportRows = Array.isArray(report.selected)
  ? report.selected
  : Array.isArray(report.rejected)
    ? report.rejected
    : [];
const rows = inputReasons.size
  ? reportRows.filter((row) => inputReasons.has(row?.sense_alignment?.reason))
  : reportRows;
const db = new Database(sourceDbPath, { readonly: true, fileMustExist: true });
db.pragma('query_only = ON');

const sourceMetadataBySense = db.prepare(`
  SELECT ds.source_key, ss.raw_json
  FROM sense_source_links ssl
  JOIN source_senses ss ON ss.id = ssl.source_sense_id
  JOIN source_entries se ON se.id = ss.source_entry_id
  JOIN dictionary_sources ds ON ds.id = se.source_id
  WHERE ssl.sense_id = ?
    AND ds.source_key LIKE 'wikdict-%'
`);

const assessed = rows.map(assessRow);
const selected = assessed
  .filter((item) => item.decision === 'selected')
  .sort((left, right) => compareRows(left.row, right.row))
  .slice(0, limit)
  .map((item) => item.row);
const rejected = assessed
  .filter((item) => item.decision !== 'selected')
  .map(({ row, ...item }) => ({
    candidate_key: candidateKey(row),
    word: row.word,
    source_lang: row.source_lang,
    ...item
  }));

const summary = {
  input_rows: rows.length,
  report_rows: reportRows.length,
  selected_rows: selected.length,
  rejected_rows: rejected.length,
  selected_by_source_lang: countBy(selected, (row) => row.source_lang),
  rejected_by_reason: countBy(rejected, (row) => row.reason),
  minimum_target_languages: minTargetLangs,
  minimum_wikdict_score: minScore,
  input_reasons: [...inputReasons].sort()
};
const output = {
  ...report,
  ok: true,
  generated_at: new Date().toISOString(),
  source_report: relative(reportPath),
  source_db: relative(sourceDbPath),
  policy: {
    ...(report.policy || {}),
    alignment: 'wikdict_exact_shared_lexentry',
    require_is_good: true,
    minimum_score: minScore,
    minimum_target_languages: minTargetLangs,
    one_source_family_only: true,
    source_family: 'wiktionary',
    independent_validation_required: true,
    publication_evidence: false
  },
  summary: { ...(report.summary || {}), wikdict_lexentry_candidates: summary },
  selected_count: selected.length,
  selected,
  rejected_count: rejected.length,
  rejected
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
db.close();
console.log(JSON.stringify({ ok: true, out: relative(outPath), ...summary }, null, 2));

function assessRow(row) {
  const candidates = Array.isArray(row?.sense_alignment?.candidates)
    ? row.sense_alignment.candidates
    : [];
  const targetLangs = LANGS.filter((lang) => lang !== row.source_lang);
  const groups = new Map();
  let productLinkedCandidates = 0;

  for (const candidate of candidates) {
    if (candidate.accepted_product_link || candidate.draft_product_link) {
      productLinkedCandidates += 1;
      continue;
    }
    const targetLang = wikdictTargetLanguage(candidate.source);
    if (!targetLang || targetLang === row.source_lang) continue;
    const provenanceRows = sourceMetadataBySense
      .all(Number(candidate.sense_id))
      .filter((item) => item.source_key === candidate.source);
    for (const provenance of provenanceRows) {
      const wikdict = safeJson(provenance.raw_json).wikdict || {};
      const score = Number(wikdict.score || 0);
      const isGood = Number(wikdict.is_good || 0);
      const lexentry = String(wikdict.lexentry || '').trim();
      if (!lexentry || isGood !== 1 || score < minScore) continue;
      if (!groups.has(lexentry)) groups.set(lexentry, []);
      groups.get(lexentry).push({
        ...candidate,
        target_lang: targetLang,
        terms: splitTerms(candidate.gloss_key),
        wikdict: { lexentry, score, is_good: isGood }
      });
    }
  }

  const qualified = [...groups.entries()]
    .map(([lexentry, members]) => summarizeGroup(lexentry, members, targetLangs))
    .filter((group) => group.target_lang_count >= minTargetLangs)
    .sort(compareGroups);
  if (!qualified.length) {
    return {
      decision: 'rejected',
      reason:
        !groups.size && productLinkedCandidates
          ? 'all_lexentry_senses_product_linked'
          : groups.size
            ? 'insufficient_target_language_coverage'
            : 'no_high_quality_lexentry',
      observed_lexentry_groups: groups.size,
      product_linked_candidates: productLinkedCandidates,
      row
    };
  }
  if (qualified.length > 1 && compareGroupIdentity(qualified[0], qualified[1]) === 0) {
    return {
      decision: 'rejected',
      reason: 'ambiguous_best_lexentry',
      qualified_lexentries: qualified.map(groupDiagnostic),
      row
    };
  }

  return { decision: 'selected', row: buildRow(row, qualified[0], targetLangs) };
}

function summarizeGroup(lexentry, members, targetLangs) {
  const termsByLang = Object.fromEntries(targetLangs.map((lang) => [lang, []]));
  for (const member of members) {
    termsByLang[member.target_lang] = unique([
      ...(termsByLang[member.target_lang] || []),
      ...member.terms
    ]);
  }
  const coveredTargetLangs = targetLangs.filter((lang) => termsByLang[lang]?.length);
  return {
    lexentry,
    members,
    terms_by_lang: termsByLang,
    covered_target_langs: coveredTargetLangs,
    target_lang_count: coveredTargetLangs.length,
    minimum_score: Math.min(...members.map((item) => item.wikdict.score)),
    total_score: members.reduce((sum, item) => sum + item.wikdict.score, 0)
  };
}

function buildRow(row, group, targetLangs) {
  const sourceTerm = String(row.word || '').trim();
  const termsByLang = { ...group.terms_by_lang, [row.source_lang]: [sourceTerm] };
  const canonical =
    group.members.find((item) => item.target_lang === 'en') ||
    [...group.members].sort((a, b) => Number(a.sense_id) - Number(b.sense_id))[0];
  const localizations = LANGS.map((lang) => {
    const joined = unique(termsByLang[lang] || []).join('; ');
    return {
      lang,
      term: joined,
      reading: null,
      reading_system: null,
      pronunciation: null,
      pronunciation_system: null,
      definition: joined,
      source: 'wikdict-lexentry',
      confidence: confidenceFromScore(group.minimum_score),
      needs_review: 0
    };
  }).filter((item) => item.term);
  const exactCandidates = group.members.map((member) => ({
    sense_id: member.sense_id,
    sense_order: member.sense_order,
    source: member.source,
    confidence: member.confidence,
    gloss_key: member.gloss_key,
    clean_langs: member.clean_langs,
    clean_lang_count: member.clean_lang_count,
    source_term_exact: member.source_term_exact,
    accepted_product_link: member.accepted_product_link,
    draft_product_link: member.draft_product_link,
    wikdict_target_lang: member.target_lang,
    wikdict_lexentry: group.lexentry,
    wikdict_score: member.wikdict.score,
    wikdict_is_good: member.wikdict.is_good
  }));
  const englishTerms = termsByLang.en || [];
  const glossKey = englishTerms.length
    ? `en: ${englishTerms.join('; ')}`
    : targetLangs.map((lang) => `${lang}: ${(termsByLang[lang] || []).join('; ')}`).join(' | ');
  const generationHints = Object.fromEntries(
    LANGS.filter((lang) => termsByLang[lang]?.length).map((lang) => [
      lang,
      {
        terms: termsByLang[lang],
        sources: ['wikdict-lexentry'],
        provenance: 'wikdict_exact_shared_lexentry',
        evidence_families: ['wiktionary']
      }
    ])
  );

  return {
    ...row,
    first_sense_id: canonical.sense_id,
    first_sense_order: canonical.sense_order,
    gloss_key: glossKey,
    gloss_preview: glossKey,
    candidate_key: `${row.source_entry_id}:${canonical.sense_id}`,
    first_sense_clean_localization_langs: localizations.map((item) => item.lang).sort(),
    first_sense_clean_localization_lang_count: localizations.length,
    first_sense_localizations: localizations,
    sense_alignment: {
      status: 'aligned',
      policy: 'wikdict_exact_shared_lexentry',
      original_sense_id: row.first_sense_id,
      aligned_sense_id: canonical.sense_id,
      changed: Number(row.first_sense_id) !== Number(canonical.sense_id),
      aligned_clean_lang_count: localizations.length,
      wikdict_lexentry: group.lexentry,
      wikdict_minimum_score: group.minimum_score,
      wikdict_target_languages: group.covered_target_langs,
      one_source_family_only: true,
      source_family: 'wiktionary',
      independent_validation_required: true,
      candidates: exactCandidates
    },
    generation_hints: generationHints,
    wikdict_lexentry_evidence: {
      lexentry: group.lexentry,
      minimum_score: group.minimum_score,
      target_languages: group.covered_target_langs,
      one_source_family_only: true,
      source_family: 'wiktionary',
      independent_validation_required: true,
      publication_evidence: false
    }
  };
}

function compareGroups(left, right) {
  return (
    right.target_lang_count - left.target_lang_count ||
    right.minimum_score - left.minimum_score ||
    right.total_score - left.total_score ||
    left.lexentry.localeCompare(right.lexentry)
  );
}

function compareGroupIdentity(left, right) {
  return (
    left.target_lang_count - right.target_lang_count ||
    left.minimum_score - right.minimum_score ||
    left.total_score - right.total_score
  );
}

function compareRows(left, right) {
  return (
    Number(left.frequency_rank || Number.MAX_SAFE_INTEGER) -
      Number(right.frequency_rank || Number.MAX_SAFE_INTEGER) ||
    Number(right.priority_score || 0) - Number(left.priority_score || 0) ||
    String(left.word || '').localeCompare(String(right.word || ''))
  );
}

function groupDiagnostic(group) {
  return {
    lexentry: group.lexentry,
    target_languages: group.covered_target_langs,
    minimum_score: group.minimum_score,
    total_score: group.total_score
  };
}

function wikdictTargetLanguage(source) {
  const match = String(source || '').match(/^wikdict-(?:pt|ja|zh|en)-(en|pt|ja|zh)$/u);
  if (!match) return null;
  return { en: 'en', pt: 'pt-BR', zh: 'zh', ja: 'ja' }[match[1]];
}

function splitTerms(value) {
  return unique(
    String(value || '')
      .split(/[;|,/]/u)
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function confidenceFromScore(score) {
  return Math.min(0.98, Number((0.8 + Math.min(Number(score), 100) / 500).toFixed(3)));
}

function candidateKey(row) {
  return row.candidate_key || `${row.source_entry_id}:${row.first_sense_id}`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
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

function boundedInteger(value, fallback, minimum) {
  const parsed = Number.parseInt(value ?? fallback, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
}

function boundedNumber(value, fallback, minimum) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const resolved = path.resolve(String(value));
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
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
