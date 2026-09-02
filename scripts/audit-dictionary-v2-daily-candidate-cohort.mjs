#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { dailyCandidateReasons } from './lib/daily-candidate-quality.mjs';

const args = parseArgs(process.argv.slice(2));
const reportPath = path.resolve(required(args.report, 'report'));
const outPath = path.resolve(args.out || 'logs/daily-candidate-cohort-audit.json');
const inspectCount = positiveInteger(args['inspect-count'], 50);
const minimumCandidates = positiveInteger(args['minimum-candidates'], 100);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const rows = report.selected || [];
const findings = [];

for (const [index, row] of rows.entries()) {
  const word = String(row.word || '').trim();
  const reasons = dailyCandidateReasons(row);
  if (reasons.length) findings.push({ position: index + 1, source_entry_id: row.source_entry_id, source_sense_id: row.source_sense_id, source_lang: row.source_lang, word, reasons });
}
const selectedCount = Number(report.selected_count || (report.selected || []).length);
const output = {
  ok: selectedCount >= minimumCandidates && findings.length === 0,
  scope: 'deterministic_only_not_semantic_approval',
  generated_at: new Date().toISOString(),
  source_report: path.relative(process.cwd(), reportPath),
  policy: { inspect_first: inspectCount, minimum_candidates: minimumCandidates, mainland_simplified_primary: true, maximum_findings: 0 },
  summary: {
    selected_count: selectedCount,
    inspected: rows.length,
    findings: findings.length,
    selected_by_lane: countBy(report.selected || [], (row) => row.production_lane),
    selected_by_lang: countBy(report.selected || [], (row) => row.source_lang),
    findings_by_reason: countReasons(findings)
  },
  findings,
  preview: rows.slice(0, inspectCount).map((row, index) => ({ position: index + 1, lane: row.production_lane, source_lang: row.source_lang, word: row.word, frequency_rank: row.frequency_rank, gloss: row.gloss_key || row.gloss_preview || row.first_gloss_preview }))
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: output.ok, out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2));
if (!output.ok) process.exitCode = 2;

function countBy(rows, selector) { const out = {}; for (const row of rows) { const key = String(selector(row) || 'unknown'); out[key] = (out[key] || 0) + 1; } return out; }
function countReasons(rows) { const out = {}; for (const row of rows) for (const reason of row.reasons) out[reason] = (out[reason] || 0) + 1; return out; }
function required(value, name) { if (!value) throw new Error(`Missing --${name}`); return value; }
function positiveInteger(value, fallback) { const n = value === undefined ? fallback : Number(value); if (!Number.isInteger(n) || n < 1) throw new Error(`Invalid positive integer: ${value}`); return n; }
function parseArgs(argv) { const out = {}; for (let i=0;i<argv.length;i+=1) { if (!argv[i].startsWith('--')) continue; const key=argv[i].slice(2); const next=argv[i+1]; if (next && !next.startsWith('--')) { out[key]=next; i+=1; } else out[key]='true'; } return out; }
