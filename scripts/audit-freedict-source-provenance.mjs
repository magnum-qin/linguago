#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { inspectFreeDictProvenance } from './lib/freedict-source-provenance.mjs';

const args = parseArgs(process.argv.slice(2));
const files = String(args.files || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map(requiredPath);
if (!files.length) throw new Error('Missing --files <tei[,tei]>');

const rows = files.map((filePath) => ({
  file: path.relative(process.cwd(), filePath),
  sha256: sha256File(filePath),
  ...inspectFreeDictProvenance(filePath)
}));
const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  policy: {
    package_name_is_not_source_family: true,
    wikdict_and_wiktionary_collapse_to_wiktionary: true,
    unresolved_upstream_is_not_production_evidence: true
  },
  summary: {
    files: rows.length,
    independent_lexical_sources: rows.filter((row) => row.independent_lexical_family).length,
    collapsed_or_unresolved_sources: rows.filter((row) => !row.independent_lexical_family).length,
    by_family: countBy(rows, (row) => row.source_family)
  },
  sources: rows
};

if (args.out) {
  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify(output, null, 2));

function countBy(values, selector) {
  const counts = {};
  for (const value of values) {
    const key = String(selector(value));
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function requiredPath(value) {
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
