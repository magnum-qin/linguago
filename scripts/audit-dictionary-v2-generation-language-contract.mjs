#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { definitionContractLanguageLooksRight } from './lib/source-review-contract.mjs';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const outPath = path.resolve(args.out || reportPath.replace(/\.json$/u, '-language-contract-audit.json'));
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const generated = Array.isArray(report.generated) ? report.generated : [];
const rows = generated.map((item) => {
  const errors = [];
  for (const lang of ['en', 'pt-BR', 'zh', 'ja']) {
    const definition = item?.output?.localizations?.[lang]?.definition;
    if (!definitionContractLanguageLooksRight(definition, lang)) errors.push(`definition_language_${lang}`);
  }
  return {
    source_entry_id: item.source_entry_id,
    source_sense_id: item.source_sense_id ?? item.source_entry_id,
    word: item.word,
    valid_before: item.valid === true,
    contract_valid: errors.length === 0,
    errors
  };
});
const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  report: path.relative(process.cwd(), reportPath),
  summary: {
    generated: rows.length,
    valid_before: rows.filter((row) => row.valid_before).length,
    contract_valid: rows.filter((row) => row.contract_valid).length,
    newly_rejected: rows.filter((row) => row.valid_before && !row.contract_valid).length,
    errors: countBy(rows.flatMap((row) => row.errors))
  },
  rows
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2));

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index++) {
    if (!values[index].startsWith('--')) continue;
    const key = values[index].slice(2);
    const next = values[index + 1];
    parsed[key] = next && !next.startsWith('--') ? values[++index] : 'true';
  }
  return parsed;
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const filePath = path.resolve(value);
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return filePath;
}
