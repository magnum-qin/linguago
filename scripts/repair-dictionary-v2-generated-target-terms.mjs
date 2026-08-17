#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pinyin } from 'pinyin-pro';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const repairsPath = requiredPath(args.repairs, 'repairs');
const outPath = requiredPath(args.out, 'out');
const report = readJson(reportPath);
const plan = readJson(repairsPath);
const repairs = new Map();
for (const repair of plan.repairs || []) {
  const candidateKey = key(repair);
  if (!repairs.has(candidateKey)) repairs.set(candidateKey, []);
  repairs.get(candidateKey).push(repair);
}
const applied = [];
const generated = (report.generated || []).map((row) => {
  const candidateRepairs = repairs.get(key(row));
  if (!candidateRepairs) return row;
  const next = structuredClone(row);
  for (const repair of candidateRepairs) {
    const lang = repair.lang;
    const target = next?.output?.localizations?.[lang];
    if (!target) throw new Error(`Missing ${lang} localization for ${key(row)}`);
    const field = repair.field || 'term';
    if (String(target[field]) !== String(repair.from)) {
      throw new Error(`Repair source mismatch for ${key(row)} ${lang}.${field}: expected ${repair.from}, got ${target[field]}`);
    }
    target[field] = repair.to;
    if (field === 'term' && lang === 'zh') {
      target.reading = pinyin(repair.to, { toneType: 'symbol', type: 'array' }).join(' ');
      target.reading_system = 'pinyin';
      target.reading_source = 'deterministic:pinyin-pro';
    }
    if (field === 'term' && repair.reading) target.reading = repair.reading;
    target.term_repair = {
      source: repair.source,
      reason: repair.reason,
      evidence: repair.evidence || []
    };
    applied.push({ candidate_key: key(row), lang, field, from: repair.from, to: repair.to });
  }
  return next;
});

const unapplied = [...repairs.keys()].filter((candidateKey) => !applied.some((row) => row.candidate_key === candidateKey));
if (unapplied.length) throw new Error(`Repair candidates not found: ${unapplied.join(', ')}`);
const output = {
  ...report,
  generated_at: new Date().toISOString(),
  repaired_from: relative(reportPath),
  repair_plan: relative(repairsPath),
  target_term_repairs: applied,
  generated
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out: relative(outPath), applied }, null, 2));

function key(row) {
  return `${Number(row.source_entry_id)}:${Number(row.source_sense_id ?? row.output?.source_sense_id)}`;
}
function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return path.resolve(value);
}
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
function relative(filePath) {
  return path.relative(process.cwd(), filePath);
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
