import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPath = path.resolve(
  args.report || 'logs/product-coverage-gaps-v93-production-ecdict-extracted-strict-evidence.json'
);
const outPath = path.resolve(
  args.out || 'logs/product-source-gap-manual-evidence-capacity.json'
);
const limit = boundedInteger(args.limit, 500, 1);

if (!fs.existsSync(reportPath)) throw new Error(`Evidence report not found: ${reportPath}`);

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const manualRows = (report.validations || []).filter((row) => row?.decision === 'manual_review');
const nearUnlock = manualRows
  .filter(isNearUnlock)
  .sort(compareCandidate)
  .slice(0, limit)
  .map(compactCandidate);

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_report: path.relative(process.cwd(), reportPath),
  policy: {
    diagnostic_only: true,
    publication_evidence: false,
    near_unlock_requires: [
      'manual_review',
      'unambiguous_omw_support',
      'omw_is_the_only_matching_source_family',
      'at_least_two_aligned_omw_target_languages'
    ]
  },
  summary: {
    manual_rows: manualRows.length,
    by_source_lang: countBy(manualRows, (row) => row.source_lang),
    by_reason: countBy(manualRows, (row) => row.reason),
    matching_family_patterns: countBy(manualRows, matchingFamilyPattern),
    aligned_target_language_patterns: countBy(manualRows, alignedTargetPattern),
    aligned_omw_target_coverage: countBy(
      manualRows,
      (row) => String(Number(row?.evidence?.aligned_omw_target_coverage || 0))
    ),
    near_unlock_rows: manualRows.filter(isNearUnlock).length,
    near_unlock_by_source_lang: countBy(manualRows.filter(isNearUnlock), (row) => row.source_lang),
    suggested_source_families: countBy(
      manualRows.filter(isNearUnlock),
      (row) => suggestedSourceFamily(row.source_lang)
    )
  },
  near_unlock: nearUnlock
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2));

function isNearUnlock(row) {
  const families = row?.evidence?.matching_source_families || [];
  return (
    row?.reason === 'no_strong_reverse_dictionary_evidence' &&
    row?.evidence?.unambiguous_omw_support === true &&
    families.length === 1 &&
    families[0] === 'omw' &&
    Number(row?.evidence?.aligned_omw_target_coverage || 0) >= 2
  );
}

function compactCandidate(row) {
  return {
    source_entry_id: Number(row.source_entry_id),
    source_sense_id: Number(row.source_sense_id),
    candidate_key: row.candidate_key,
    word: row.word,
    source_lang: row.source_lang,
    frequency_rank: row.frequency_rank,
    anchor: row?.evidence?.anchor || null,
    aligned_omw_synsets: row?.evidence?.aligned_omw_synsets || [],
    aligned_target_languages: alignedTargetLanguages(row),
    aligned_omw_terms: row?.evidence?.aligned_omw_terms || {},
    suggested_source_family: suggestedSourceFamily(row.source_lang)
  };
}

function alignedTargetLanguages(row) {
  const terms = row?.evidence?.aligned_omw_terms || {};
  return ['pt-BR', 'zh', 'ja'].filter((lang) => Array.isArray(terms[lang]) && terms[lang].length);
}

function alignedTargetPattern(row) {
  return alignedTargetLanguages(row).join('+') || 'none';
}

function matchingFamilyPattern(row) {
  return [...(row?.evidence?.matching_source_families || [])].sort().join('+') || 'none';
}

function suggestedSourceFamily(lang) {
  return {
    en: 'ecdict_or_wordnet_lexical',
    'pt-BR': 'freedict_or_dicionario_aberto',
    zh: 'cc_cedict_or_openhownet',
    ja: 'jmdict_or_ejdict'
  }[lang] || 'language_specific_lexical_source';
}

function compareCandidate(left, right) {
  return (
    Number(left.frequency_rank ?? Number.MAX_SAFE_INTEGER) -
      Number(right.frequency_rank ?? Number.MAX_SAFE_INTEGER) ||
    String(left.source_lang).localeCompare(String(right.source_lang)) ||
    Number(left.source_entry_id) - Number(right.source_entry_id)
  );
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = String(keyFn(row) ?? 'unknown');
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1]));
}

function boundedInteger(value, fallback, minimum) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < minimum) return fallback;
  return parsed;
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
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}
