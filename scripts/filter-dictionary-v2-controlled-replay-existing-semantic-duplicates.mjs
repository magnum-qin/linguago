import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

const DEFAULT_DB = 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const LANGS = ['en', 'pt-BR', 'zh', 'ja'];
const args = parseArgs(process.argv.slice(2));
const inputPath = requiredPath(args.input, '--input');
const outputPath = requiredPath(args.output, '--output');
const reportPath = path.resolve(args.report || `${outputPath}.report.json`);
const dbPath = path.resolve(args.db || DEFAULT_DB);
const minimumExactLanguages = integerArg(args['min-exact-languages'], 2);

const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const generated = Array.isArray(input) ? input : input.generated;
if (!Array.isArray(generated)) throw new Error('Input must be an array or contain generated[]');

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const findEntries = db.prepare(`
  SELECT id
  FROM product_entries
  WHERE primary_lang = ?
    AND (normalized_key = ? OR headword = ?)
    AND status = 'accepted'
`);
const localizations = db.prepare(`
  SELECT s.id AS product_sense_id, sl.lang, sl.term, sl.definition
  FROM product_senses s
  JOIN product_localizations sl ON sl.product_sense_id = s.id
  WHERE s.product_entry_id = ?
    AND s.status = 'accepted'
    AND sl.needs_review = 0
  ORDER BY s.id, sl.lang
`);

const kept = [];
const excluded = [];
try {
  for (const row of generated) {
    const item = row?.output || row;
    const duplicate = findDuplicate(item);
    if (duplicate) {
      excluded.push({
        source_entry_id: item.source_entry_id ?? row.source_entry_id ?? null,
        source_sense_id: item.source_sense_id ?? null,
        headword: item.headword,
        primary_lang: item.primary_lang,
        existing_product_entry_id: duplicate.entryId,
        existing_product_sense_id: duplicate.senseId,
        exact_languages: duplicate.exactLanguages
      });
    } else {
      kept.push(row);
    }
  }
} finally {
  db.close();
}

const output = Array.isArray(input)
  ? kept
  : {
      ...input,
      generated: kept,
      stats: {
        ...(input.stats || {}),
        semantic_duplicate_filter_input: generated.length,
        semantic_duplicate_filter_kept: kept.length,
        semantic_duplicate_filter_excluded: excluded.length
      },
      semantic_duplicate_filter: {
        product_db: dbPath,
        minimum_exact_languages: minimumExactLanguages,
        excluded
      }
    };

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
fs.writeFileSync(reportPath, `${JSON.stringify({
  ok: true,
  input: inputPath,
  output: outputPath,
  product_db: dbPath,
  minimum_exact_languages: minimumExactLanguages,
  counts: { input: generated.length, kept: kept.length, excluded: excluded.length },
  excluded
}, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  ok: true,
  input: generated.length,
  kept: kept.length,
  excluded: excluded.length,
  output: outputPath,
  report: reportPath,
  excluded_headwords: excluded.map((row) => row.headword)
}, null, 2));

function findDuplicate(item) {
  if (!item?.headword || !item?.primary_lang || !item?.localizations) return null;
  const normalizedKey = normalizeKey(item.normalized_key || item.headword);
  for (const entry of findEntries.all(item.primary_lang, normalizedKey, item.headword)) {
    const bySense = new Map();
    for (const row of localizations.all(entry.id)) {
      if (!bySense.has(row.product_sense_id)) bySense.set(row.product_sense_id, []);
      bySense.get(row.product_sense_id).push(row);
    }
    for (const [senseId, rows] of bySense) {
      const exactLanguages = [];
      for (const lang of LANGS) {
        const existing = rows.find((row) => row.lang === lang);
        const candidate = item.localizations[lang];
        if (!existing || !candidate) continue;
        if (
          normalizeText(existing.term) === normalizeText(candidate.term) &&
          normalizeText(existing.definition) === normalizeText(candidate.definition)
        ) exactLanguages.push(lang);
      }
      if (exactLanguages.length >= minimumExactLanguages) {
        return { entryId: entry.id, senseId, exactLanguages };
      }
    }
  }
  return null;
}

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('und')
    .replace(/[\s'’._-]+/gu, '');
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('und')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function requiredPath(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return path.resolve(String(value));
}

function integerArg(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > LANGS.length) {
    throw new Error(`Invalid --min-exact-languages: ${value}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    output[key] = next && !next.startsWith('--') ? argv[++index] : true;
  }
  return output;
}
