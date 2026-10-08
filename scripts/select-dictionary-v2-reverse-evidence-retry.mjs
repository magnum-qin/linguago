#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const validationPath = requiredPath(args.validation, 'validation');
const outPath = path.resolve(args.out || 'logs/product-source-gap-reverse-evidence-retry.json');
const decisions = new Set(csv(args.decisions || 'manual_review'));

const report = readJson(reportPath);
const validation = readJson(validationPath);
const rows = Array.isArray(report.selected) ? report.selected : [];
const validations = Array.isArray(validation.validations) ? validation.validations : [];
const selectedKeys = new Set(
  validations
    .filter((row) => decisions.has(String(row?.decision || '')))
    .map(candidateKey)
);
const selected = rows.filter((row) => selectedKeys.has(candidateKey(row)));
const selectedRowKeys = new Set(selected.map(candidateKey));
const missingKeys = [...selectedKeys].filter((key) => !selectedRowKeys.has(key)).sort();

const output = {
  ...report,
  ok: missingKeys.length === 0,
  generated_at: new Date().toISOString(),
  source_report: relative(reportPath),
  source_validation: relative(validationPath),
  selection_policy: {
    decisions: [...decisions].sort(),
    exact_candidate_binding: true,
    automatic_publication: false
  },
  selected_count: selected.length,
  selected,
  summary: {
    input_rows: rows.length,
    validation_rows: validations.length,
    selected_rows: selected.length,
    selected_by_source_lang: countBy(selected, (row) => row.source_lang),
    missing_rows: missingKeys.length
  },
  missing_candidate_keys: missingKeys
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: output.ok, out: relative(outPath), summary: output.summary }, null, 2));
if (!output.ok) process.exitCode = 1;

function candidateKey(row) {
  return `${Number(row?.source_entry_id)}:${Number(row?.source_sense_id ?? row?.first_sense_id)}`;
}

function countBy(values, selector) {
  const counts = {};
  for (const value of values) {
    const key = String(selector(value) || 'unknown');
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function csv(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const filePath = path.resolve(value);
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return filePath;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function relative(filePath) {
  return path.relative(process.cwd(), filePath);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    result[key] = value && !value.startsWith('--') ? argv[++index] : 'true';
  }
  return result;
}
