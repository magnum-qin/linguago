import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const evidencePath = requiredPath(args.evidence, 'evidence');
const outPath = requiredPath(args.out, 'out');
const limit = boundedInteger(args.limit, 20);
const excludedLangs = csvSet(args['exclude-langs']);
const excludedWords = csvSet(args['exclude-words']);
const excludedSourceEntryIds = integerCsvSet(args['exclude-source-entry-ids']);
const langTargets = parseLangTargets(args['lang-targets']);
const excludeProperGlosses = booleanArg(args['exclude-proper-glosses'], false);
const decisions = csvSet(args.decisions || 'manual_review');
const reasons = new Set(
  String(args.reasons || 'polysemous_source_term_low_match_ratio')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);

const report = readJson(reportPath);
const evidence = readJson(evidencePath);
const rows = Array.isArray(report.selected) ? report.selected : [];
const validations = Array.isArray(evidence.validations) ? evidence.validations : [];
const rowByKey = new Map(rows.map((row) => [candidateKey(row), row]));

const eligible = validations
  .filter(
    (validation) =>
      decisions.has(String(validation?.decision || '')) &&
      reasons.has(String(validation?.reason || '')) &&
      Number.isInteger(Number(validation?.source_entry_id)) &&
      rowByKey.has(candidateKey(validation)) &&
      !excludedSourceEntryIds.has(Number(validation.source_entry_id)) &&
      !excludedLangs.has(String(rowByKey.get(candidateKey(validation))?.source_lang || '')) &&
      !excludedWords.has(String(rowByKey.get(candidateKey(validation))?.word || '')) &&
      (!excludeProperGlosses ||
        !looksLikeProperOrEncyclopedicGloss(rowByKey.get(candidateKey(validation))))
  )
  .sort(compareValidation);

const selectedValidations =
  langTargets.size > 0 ? selectByLanguageTargets(eligible, rowByKey, langTargets, limit) : eligible.slice(0, limit);
const selected = selectedValidations.map((validation) => {
  const row = rowByKey.get(candidateKey(validation));
  return {
    ...row,
    candidate_review_provenance: {
      kind: 'manual_reverse_evidence_review',
      source_report: path.relative(process.cwd(), evidencePath),
      decision: validation.decision,
      reason: validation.reason,
      matching_sources: validation.evidence?.matching_sources || [],
      match_ratio: validation.evidence?.match_ratio ?? null,
      target_coverage_count: Number(validation.target_coverage_count || 0)
    },
    manual_review_evidence: validation.evidence || null,
    manual_review_template: {
      decision: null,
      preferred_terms: { en: null, 'pt-BR': null, zh: null, ja: null },
      rationale: null
    }
  };
});

const output = {
  ...report,
  ok: true,
  generated_at: new Date().toISOString(),
  source_report: path.relative(process.cwd(), reportPath),
  source_evidence: path.relative(process.cwd(), evidencePath),
  selection_policy: {
    decisions: [...decisions],
    reasons: [...reasons],
    excluded_langs: [...excludedLangs],
    excluded_words: [...excludedWords],
    excluded_source_entry_ids: [...excludedSourceEntryIds],
    lang_targets: Object.fromEntries(langTargets),
    exclude_proper_glosses: excludeProperGlosses,
    order: ['frequency_rank', 'source_lang', 'source_entry_id'],
    limit
  },
  selected_count: selected.length,
  selected,
  summary: {
    ...(report.summary || {}),
    manual_review_selection: {
      evidence_rows: validations.length,
      eligible_rows: eligible.length,
      selected_rows: selected.length,
      selected_by_lang: countBy(selected.map((row) => row.source_lang))
    }
  }
};

function selectByLanguageTargets(validations, rowsByKey, targets, maximum) {
  const selectedRows = [];
  const selectedIds = new Set();
  for (const [lang, target] of targets) {
    const matches = validations
      .filter((validation) => rowsByKey.get(candidateKey(validation))?.source_lang === lang)
      .slice(0, target);
    for (const validation of matches) {
      selectedRows.push(validation);
      selectedIds.add(Number(validation.source_entry_id));
    }
  }
  if (selectedRows.length < maximum) {
    for (const validation of validations) {
      if (selectedRows.length >= maximum) break;
      if (selectedIds.has(Number(validation.source_entry_id))) continue;
      selectedRows.push(validation);
    }
  }
  return selectedRows.slice(0, maximum);
}

function candidateKey(row) {
  const senseId = row?.source_sense_id ?? row?.first_sense_id;
  return `${Number(row?.source_entry_id)}:${Number(senseId)}`;
}

function looksLikeProperOrEncyclopedicGloss(row) {
  const gloss = String(row?.gloss_preview || row?.gloss_key || '');
  if (/\b(?:battle of|king|queen|prince|princess|saint|baron(?:ne)?|madame|sir)\b/i.test(gloss)) {
    return true;
  }
  const latinText = gloss.replace(/^[a-z]{2}:\s*/i, '');
  const capitalizedTokens = latinText.match(/\b[A-Z][a-z]{2,}\b/g) || [];
  return capitalizedTokens.length >= 2;
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(
  JSON.stringify(
    {
      ok: true,
      out: path.relative(process.cwd(), outPath),
      summary: output.summary.manual_review_selection,
      words: selected.map((row) => row.word)
    },
    null,
    2
  )
);

function compareValidation(left, right) {
  return (
    Number(left.frequency_rank ?? Number.MAX_SAFE_INTEGER) -
      Number(right.frequency_rank ?? Number.MAX_SAFE_INTEGER) ||
    String(left.source_lang || '').localeCompare(String(right.source_lang || '')) ||
    Number(left.source_entry_id) - Number(right.source_entry_id)
  );
}

function countBy(values) {
  return Object.fromEntries(
    [...values.reduce((map, value) => map.set(value, (map.get(value) || 0) + 1), new Map())].sort(
      ([left], [right]) => String(left).localeCompare(String(right))
    )
  );
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return path.resolve(value);
}

function boundedInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Invalid positive integer: ${value}`);
  return parsed;
}

function csvSet(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function parseLangTargets(value) {
  const targets = new Map();
  for (const item of String(value || '').split(',')) {
    if (!item.trim()) continue;
    const separator = item.lastIndexOf('=');
    if (separator <= 0) throw new Error(`Invalid language target: ${item}`);
    const lang = item.slice(0, separator).trim();
    const target = boundedInteger(item.slice(separator + 1).trim(), 1);
    targets.set(lang, target);
  }
  return targets;
}

function integerCsvSet(value) {
  const values = csvSet(value);
  const parsed = new Set();
  for (const item of values) {
    const number = Number(item);
    if (!Number.isInteger(number)) throw new Error(`Invalid source entry ID: ${item}`);
    parsed.add(number);
  }
  return parsed;
}

function booleanArg(value, fallback) {
  if (value === undefined) return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`Invalid boolean: ${value}`);
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
