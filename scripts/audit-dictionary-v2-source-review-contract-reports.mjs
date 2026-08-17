#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { validateDefinitionContract } from './lib/source-review-contract.mjs';

const args = parseArgs(process.argv.slice(2));
const logsDir = path.resolve(args.dir || 'logs');
const outPath = path.resolve(args.out || 'logs/product-source-review-contract-audit.json');
const prefix = String(args.prefix || 'product');

if (!fs.existsSync(logsDir)) throw new Error(`Directory not found: ${logsDir}`);

const files = fs.readdirSync(logsDir)
  .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
  .map((name) => path.join(logsDir, name));

const reports = [];
const invalidRows = [];
let approvedRows = 0;

for (const filePath of files) {
  let report;
  try {
    report = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    continue;
  }
  if (report?.prompt_mode !== 'nano-per-language' || !Array.isArray(report.reviews)) continue;
  const approved = report.reviews.filter((row) => row?.approved === true);
  const invalid = [];
  approvedRows += approved.length;
  for (const row of approved) {
    const errors = validateDefinitionContract(row.definition_contract, row.preferred_terms);
    if (!errors.length) continue;
    const record = {
      report: relative(filePath),
      source_entry_id: Number(row.source_entry_id) || null,
      source_sense_id: Number(row.source_sense_id) || null,
      word: row.word || null,
      errors
    };
    invalid.push(record);
    invalidRows.push(record);
  }
  reports.push({
    report: relative(filePath),
    approved: approved.length,
    invalid_contracts: invalid.length
  });
}

const output = {
  ok: invalidRows.length === 0,
  generated_at: new Date().toISOString(),
  policy: {
    prompt_mode: 'nano-per-language',
    audit_only: true,
    automatic_database_changes: false
  },
  summary: {
    reports: reports.length,
    approved_rows: approvedRows,
    invalid_contract_rows: invalidRows.length,
    affected_reports: reports.filter((row) => row.invalid_contracts > 0).length
  },
  reports,
  invalid_rows: invalidRows
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out: relative(outPath), summary: output.summary }, null, 2));

function relative(filePath) {
  return path.relative(process.cwd(), filePath);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return parsed;
}
