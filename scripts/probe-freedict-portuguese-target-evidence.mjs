#!/usr/bin/env node

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const sourceDbPath = requiredPath(args['source-db'] || 'data/processed/linguago_v2_full.db');
const inputPath = requiredPath(args.input);
const outPath = path.resolve(args.out || '.tmp/freedict-portuguese-target-probe.json');
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const candidates = Array.isArray(input.selected) ? input.selected : [];

const db = new Database(sourceDbPath, { readonly: true, fileMustExist: true });
db.pragma('query_only = ON');
const findEnglish = db.prepare(`
  SELECT ds.source_key, se.word, se.normalized_key, ss.sense_order,
         ss.part_of_speech, ss.gloss
  FROM source_entries se
  JOIN dictionary_sources ds ON ds.id = se.source_id
  JOIN source_senses ss ON ss.source_entry_id = se.id
  WHERE ds.source_key = 'freedict-eng-por'
    AND se.lang = 'en'
    AND se.normalized_key = ?
  ORDER BY ss.sense_order, ss.id
`);
const findPortuguese = db.prepare(`
  SELECT ds.source_key, se.word, se.normalized_key, ss.sense_order,
         ss.part_of_speech, ss.gloss
  FROM source_entries se
  JOIN dictionary_sources ds ON ds.id = se.source_id
  JOIN source_senses ss ON ss.source_entry_id = se.id
  WHERE ds.source_key = 'freedict-por-eng'
    AND se.lang = 'pt-BR'
    AND se.normalized_key = ?
  ORDER BY ss.sense_order, ss.id
`);

const rows = candidates.map((candidate) => {
  const englishKeys = candidateEnglishKeys(candidate);
  const forward = uniqueRows(englishKeys.flatMap((key) => findEnglish.all(key)));
  const portugueseTerms = unique(
    forward.flatMap((row) => splitGlossTerms(row.gloss)).map(normalize).filter(Boolean)
  );
  const reverse = uniqueRows(portugueseTerms.flatMap((term) => findPortuguese.all(term)));
  return {
    candidate_key: candidate.candidate_key,
    word: candidate.word,
    source_lang: candidate.source_lang,
    english_anchor: candidate.english_anchor,
    english_keys: englishKeys,
    forward,
    portuguese_terms: portugueseTerms,
    reverse
  };
});

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_db: path.relative(process.cwd(), sourceDbPath),
  input: path.relative(process.cwd(), inputPath),
  policy: {
    freedict_bidirectional_files_are_one_family: true,
    exact_or_conservative_inflectional_english_anchor: true,
    output_is_probe_not_production_evidence: true
  },
  summary: {
    candidates: rows.length,
    with_forward_hits: rows.filter((row) => row.forward.length).length,
    with_portuguese_terms: rows.filter((row) => row.portuguese_terms.length).length,
    with_reverse_hits: rows.filter((row) => row.reverse.length).length
  },
  rows
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(output.summary, null, 2));
console.log(`[done] wrote ${path.relative(process.cwd(), outPath)}`);

function candidateEnglishKeys(candidate) {
  const values = [candidate.english_anchor];
  if (candidate.source_lang === 'en') values.push(candidate.word);
  return unique(
    values
      .flatMap(splitGlossTerms)
      .map(normalize)
      .filter(Boolean)
      .flatMap(conservativeEnglishForms)
  );
}

function conservativeEnglishForms(value) {
  const forms = new Set([value]);
  if (!/^[a-z][a-z '-]*$/u.test(value) || value.includes(' ')) return [...forms];
  if (value.endsWith('ied') && value.length >= 6) forms.add(`${value.slice(0, -3)}y`);
  if (value.endsWith('ed') && value.length >= 5) {
    const base = value.slice(0, -2);
    forms.add(base);
    forms.add(`${base}e`);
    if (base.length >= 4 && base.at(-1) === base.at(-2)) forms.add(base.slice(0, -1));
  }
  if (value.endsWith('ing') && value.length >= 6) {
    const base = value.slice(0, -3);
    forms.add(base);
    forms.add(`${base}e`);
    if (base.length >= 4 && base.at(-1) === base.at(-2)) forms.add(base.slice(0, -1));
  }
  return [...forms];
}

function splitGlossTerms(value) {
  return String(value || '')
    .split(/[;,/]|\s+\bor\b\s+/iu)
    .map((item) => item.replace(/^to\s+/iu, '').trim())
    .filter(Boolean);
}

function normalize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/gu, ' ').trim();
}

function unique(values) {
  return [...new Set(values)];
}

function uniqueRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = JSON.stringify(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function requiredPath(value) {
  if (!value) throw new Error('Missing required path argument');
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  return resolved;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) parsed[key] = argv[++index];
    else parsed[key] = true;
  }
  return parsed;
}
