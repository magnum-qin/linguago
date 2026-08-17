#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const LANGS = ['en', 'pt-BR', 'zh', 'ja'];
const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const outPath = requiredPath(args.out, 'out');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const generated = [];
const rejected = [];

for (const row of report.selected || []) {
  const review = row?.candidate_evidence_review || {};
  const terms = review.preferred_terms || {};
  const definitions = review.definition_contract || {};
  const missing = LANGS.filter((lang) => !clean(terms[lang]) || !clean(definitions[lang]));
  if (missing.length) {
    rejected.push({ source_entry_id: row.source_entry_id, source_sense_id: row.first_sense_id, missing });
    continue;
  }
  generated.push({
    source_entry_id: Number(row.source_entry_id),
    source_sense_id: Number(row.first_sense_id),
    word: row.word,
    source_lang: row.source_lang,
    valid: true,
    errors: [],
    output: {
      source_sense_id: Number(row.first_sense_id),
      source_word: row.word,
      headword: row.word,
      primary_lang: row.source_lang,
      gloss_key: review.english_anchor || row.gloss_key,
      localizations: Object.fromEntries(
        LANGS.map((lang) => [lang, { term: clean(terms[lang]), definition: clean(definitions[lang]) }])
      )
    }
  });
}

const output = {
  ok: rejected.length === 0,
  generated_at: new Date().toISOString(),
  source_report: path.relative(process.cwd(), reportPath),
  policy: { semantic_preview_only: true, automatic_database_writes: false },
  stats: { input: (report.selected || []).length, generated: generated.length, rejected: rejected.length },
  generated,
  rejected
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out: path.relative(process.cwd(), outPath), ...output.stats }, null, 2));

function clean(value) { return String(value || '').trim(); }
function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const result = path.resolve(value);
  if (name === 'report' && !fs.existsSync(result)) throw new Error(`File not found: ${result}`);
  return result;
}
function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const name = argv[index].slice(2);
    const next = argv[index + 1];
    parsed[name] = next && !next.startsWith('--') ? argv[++index] : true;
  }
  return parsed;
}
