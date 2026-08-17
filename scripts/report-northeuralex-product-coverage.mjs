#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import csv from 'csv-parser';
import * as OpenCC from 'opencc-js';

const args = parseArgs(process.argv.slice(2));
const dbPath = requiredPath(
  args.db || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db'
);
const inputDir = path.resolve(args['input-dir'] || 'data/raw/northeuralex-cldf');
const outPath = path.resolve(args.out || 'logs/northeuralex-product-coverage.json');
const languagesPath = requiredPath(path.join(inputDir, 'languages.csv'));
const parametersPath = requiredPath(path.join(inputDir, 'parameters.csv'));
const formsPath = requiredPath(path.join(inputDir, 'forms.csv'));
const langs = ['en', 'pt-BR', 'zh', 'ja'];
const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });

const languageById = new Map();
for (const row of await readCsv(languagesPath)) {
  const lang = languageFromIso(row.ISO639P3code, row.Name);
  if (lang) languageById.set(row.ID, lang);
}
const parameterById = new Map(
  (await readCsv(parametersPath)).map((row) => [row.ID, {
    parameter_id: row.ID,
    concepticon_id: row.Concepticon_ID || null,
    concepticon_gloss: row.Concepticon_Gloss || null,
    gloss: row.NorthEuralex_Gloss || row.Concepticon_Gloss || row.Name || ''
  }])
);
const formsByConcept = new Map();
for (const row of await readCsv(formsPath)) {
  const lang = languageById.get(row.Language_ID);
  if (!lang) continue;
  const term = cleanTerm(row.Value || row.Form, lang);
  if (!term) continue;
  if (!formsByConcept.has(row.Parameter_ID)) formsByConcept.set(row.Parameter_ID, new Map());
  const forms = formsByConcept.get(row.Parameter_ID);
  if (!forms.has(lang)) forms.set(lang, new Set());
  forms.get(lang).add(term);
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const rows = db.prepare(`
  SELECT ps.id sense_id, pl.lang, pl.term
  FROM product_senses ps
  JOIN product_localizations pl ON pl.product_sense_id = ps.id
  WHERE ps.status = 'accepted' AND COALESCE(pl.needs_review, 0) = 0
    AND pl.lang IN ('en', 'pt-BR', 'zh', 'ja')
`).all();
db.close();

const senseTerms = new Map();
const termToSenses = new Map();
for (const row of rows) {
  if (!senseTerms.has(row.sense_id)) senseTerms.set(row.sense_id, new Map());
  const byLang = senseTerms.get(row.sense_id);
  if (!byLang.has(row.lang)) byLang.set(row.lang, new Set());
  const normalized = normalizeForLang(row.term, row.lang);
  byLang.get(row.lang).add(normalized);
  const key = `${row.lang}:${normalized}`;
  if (!termToSenses.has(key)) termToSenses.set(key, new Set());
  termToSenses.get(key).add(row.sense_id);
}

const selected = [];
let completeConcepts = 0;
let fourLanguageConcepts = 0;
for (const [parameterId, forms] of formsByConcept) {
  if (!langs.every((lang) => forms.get(lang)?.size)) continue;
  fourLanguageConcepts += 1;
  const candidateSenseIds = new Set(
    langs.flatMap((lang) =>
      [...forms.get(lang)].flatMap((term) => [...(termToSenses.get(`${lang}:${normalizeForLang(term, lang)}`) || [])])
    )
  );
  let best = { sense_id: null, matched_langs: [] };
  for (const senseId of candidateSenseIds) {
    const productTerms = senseTerms.get(senseId) || new Map();
    const matchedLangs = langs.filter((lang) =>
      intersects(productTerms.get(lang), new Set([...forms.get(lang)].map((term) => normalizeForLang(term, lang))))
    );
    if (matchedLangs.length > best.matched_langs.length) best = { sense_id: senseId, matched_langs: matchedLangs };
    if (matchedLangs.length === langs.length) break;
  }
  if (best.matched_langs.length === langs.length) {
    completeConcepts += 1;
    continue;
  }
  const parameter = parameterById.get(parameterId) || { parameter_id: parameterId, gloss: parameterId };
  selected.push({
    ...parameter,
    terms: Object.fromEntries(langs.map((lang) => [lang, [...forms.get(lang)]])),
    best_product_sense_id: best.sense_id,
    matched_langs: best.matched_langs,
    unmatched_source_form_langs: langs.filter((lang) => !best.matched_langs.includes(lang)),
    matched_lang_count: best.matched_langs.length,
    priority: (langs.length - best.matched_langs.length) * 1000 + (parameter.concepticon_id ? 0 : 100)
  });
}
selected.sort((a, b) => a.priority - b.priority || String(a.parameter_id).localeCompare(String(b.parameter_id)));

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  db: path.relative(process.cwd(), dbPath),
  source: {
    family: 'northeuralex',
    license: 'CC-BY-4.0',
    repository: 'https://github.com/lexibank/northeuralex',
    concept_bound: true
  },
  policy: {
    exact_alignment_requires_one_product_sense_matching_all_four_source_forms: true,
    mainland_chinese_normalization: true,
    report_only: true,
    automatic_promotion: false,
    unmatched_source_form_does_not_mean_missing_localization: true
  },
  summary: {
    source_concepts: formsByConcept.size,
    four_language_concepts: fourLanguageConcepts,
    exact_aligned_concepts: completeConcepts,
    non_exact_aligned_concepts: selected.length,
    by_matched_lang_count: countBy(selected.map((row) => row.matched_lang_count))
  },
  selected_count: selected.length,
  selected
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2));

function intersects(left, right) {
  if (!left || !right) return false;
  for (const value of left) if (right.has(value)) return true;
  return false;
}
function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}
function readCsv(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath).pipe(csv()).on('data', (row) => rows.push(row)).on('end', () => resolve(rows)).on('error', reject);
  });
}
function languageFromIso(iso, name) {
  const code = String(iso || '').toLowerCase();
  const label = String(name || '').toLowerCase();
  if (code === 'eng') return 'en';
  if (code === 'por') return 'pt-BR';
  if (code === 'jpn') return 'ja';
  if (code === 'cmn' || label.includes('mandarin')) return 'zh';
  return null;
}
function cleanTerm(value, lang) {
  let term = String(value || '').normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!term || term === '-') return null;
  if (lang === 'zh') {
    if (!/\p{Script=Han}/u.test(term)) return null;
    term = toSimplified(term);
  } else if (lang === 'ja' && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(term)) {
    return null;
  }
  return term;
}
function normalizeForLang(value, lang) {
  const text = lang === 'zh' ? toSimplified(String(value || '')) : String(value || '');
  return text.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ');
}
function requiredPath(value) {
  const resolved = path.resolve(String(value || ''));
  if (!value || !fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  return resolved;
}
function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith('--') ? argv[++index] : true;
  }
  return parsed;
}
