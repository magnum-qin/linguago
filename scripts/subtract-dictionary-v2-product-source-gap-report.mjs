import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const excludePaths = String(args.exclude || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => path.resolve(value));
const outPath = requiredPath(args.out, 'out');
const limit = optionalPositiveInteger(args.limit, 'limit');
const uniqueEntry = args['unique-entry'] === 'true';
const uniqueWord = args['unique-word'] === 'true';
const excludeEntry = args['exclude-entry'] === 'true';
const singleHintPerTarget = args['single-hint-per-target'] === 'true';
const maxHintsPerTarget = optionalPositiveInteger(args['max-hints-per-target'], 'max-hints-per-target');
const maxTotalTargetHints = optionalPositiveInteger(args['max-total-target-hints'], 'max-total-target-hints');
const minWordLength = optionalPositiveInteger(args['min-word-length'], 'min-word-length');
const minFirstSenseLangs = optionalPositiveInteger(
  args['min-first-sense-langs'],
  'min-first-sense-langs'
);
const requiredHintFamilies = parseRequiredHintFamilies(args['require-hint-family']);

if (!excludePaths.length) throw new Error('Missing --exclude');

const report = readReport(reportPath);
const selected = selectedRows(report, reportPath);
const excludedKeys = new Set();
const excludedEntryWildcards = new Set();

for (const excludePath of excludePaths) {
  for (const row of selectedRows(readReport(excludePath), excludePath)) {
    const entryId = String(row.source_entry_id);
    if (excludeEntry) {
      excludedEntryWildcards.add(entryId);
      continue;
    }
    const senseId = row.source_sense_id ?? row.first_sense_id ?? row.output?.source_sense_id;
    if (senseId) excludedKeys.add(`${entryId}:${senseId}`);
    else excludedEntryWildcards.add(entryId);
  }
}

const eligible = selected.filter((row) => {
  const entryId = String(row.source_entry_id);
  const senseId = row.source_sense_id ?? row.first_sense_id ?? row.output?.source_sense_id;
  if (excludedEntryWildcards.has(entryId) || excludedKeys.has(`${entryId}:${senseId}`)) return false;
  if (minWordLength && [...String(row.word || '')].length < minWordLength) return false;
  if (
    minFirstSenseLangs &&
    Number(row.first_sense_clean_localization_lang_count || 0) < minFirstSenseLangs
  ) return false;
  if (
    requiredHintFamilies.some(({ lang, family }) =>
      !(row?.generation_hints?.[lang]?.evidence_families || []).includes(family)
    )
  ) return false;
  if (singleHintPerTarget) {
    const targetLangs = ['en', 'pt-BR', 'zh', 'ja'].filter((lang) => lang !== row.source_lang);
    if (!targetLangs.every((lang) => row?.generation_hints?.[lang]?.terms?.length === 1)) return false;
  }
  if (maxHintsPerTarget || maxTotalTargetHints) {
    const targetLangs = ['en', 'pt-BR', 'zh', 'ja'].filter((lang) => lang !== row.source_lang);
    const counts = targetLangs.map((lang) => row?.generation_hints?.[lang]?.terms?.length || 0);
    if (maxHintsPerTarget && counts.some((count) => count > maxHintsPerTarget)) return false;
    if (maxTotalTargetHints && counts.reduce((sum, count) => sum + count, 0) > maxTotalTargetHints) return false;
  }
  return true;
});
const seenEntries = new Set();
const seenWords = new Set();
const remaining = [];
for (const row of eligible) {
  const entryId = String(row.source_entry_id);
  const normalizedWord = String(row.normalized_key || row.word || '').normalize('NFKC').trim().toLocaleLowerCase();
  if (uniqueEntry && seenEntries.has(entryId)) continue;
  if (uniqueWord && seenWords.has(normalizedWord)) continue;
  seenEntries.add(entryId);
  seenWords.add(normalizedWord);
  remaining.push(row);
  if (limit && remaining.length >= limit) break;
}
const output = {
  ...report,
  generated_at: new Date().toISOString(),
  summary: {
    ...(report.summary || {}),
    subtraction: {
      input: path.relative(process.cwd(), reportPath),
      excluded_reports: excludePaths.map((value) => path.relative(process.cwd(), value)),
      input_rows: selected.length,
      excluded_rows: selected.length - remaining.length,
      excluded_entry_wildcards: excludedEntryWildcards.size,
      excluded_entry_sense_keys: excludedKeys.size,
      eligible_rows: eligible.length,
      unique_entry: uniqueEntry,
      unique_word: uniqueWord,
      exclude_entry: excludeEntry,
      single_hint_per_target: singleHintPerTarget,
      max_hints_per_target: maxHintsPerTarget,
      max_total_target_hints: maxTotalTargetHints,
      min_word_length: minWordLength,
      min_first_sense_langs: minFirstSenseLangs,
      required_hint_families: requiredHintFamilies,
      limit,
      remaining_rows: remaining.length
    }
  },
  selected_count: remaining.length,
  selected: remaining
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(
  JSON.stringify(
    {
      ok: true,
      out: path.relative(process.cwd(), outPath),
      input_rows: selected.length,
      excluded_rows: selected.length - remaining.length,
      remaining_rows: remaining.length
    },
    null,
    2
  )
);

function selectedRows(reportValue, filePath) {
  if (Array.isArray(reportValue.selected)) return reportValue.selected;
  if (Array.isArray(reportValue.generated)) return reportValue.generated;
  if (Array.isArray(reportValue.replayed)) return reportValue.replayed;
  throw new Error(`Report has no selected/generated/replayed array: ${filePath}`);
}

function optionalPositiveInteger(value, name) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Invalid --${name}: ${value}`);
  return parsed;
}

function parseRequiredHintFamilies(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separator = item.indexOf(':');
      if (separator <= 0 || separator === item.length - 1) {
        throw new Error(`Invalid --require-hint-family value: ${item}; expected lang:family`);
      }
      return { lang: item.slice(0, separator), family: item.slice(separator + 1) };
    });
}

function readReport(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Report not found: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return path.resolve(value);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const [key, inlineValue] = token.slice(2).split('=', 2);
    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
      continue;
    }
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
