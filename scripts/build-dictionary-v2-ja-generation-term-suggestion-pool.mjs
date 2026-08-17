#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const preflightPath = requiredPath(args.preflight, 'preflight');
const outPath = path.resolve(required(args.out, 'out'));
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const preflight = JSON.parse(fs.readFileSync(preflightPath, 'utf8'));
const repairKeys = new Set(
  (preflight.jmdict_preflight_rejected || [])
    .filter((row) => ['missing_reviewed_ja_term', 'ja_term_not_in_jmdict', 'ja_reading_not_unique'].includes(row.reason))
    .map(candidateKey)
);

const selected = (report.selected || [])
  .filter((row) => repairKeys.has(candidateKey(row)))
  .map((row) => ({
    candidate_key: candidateKey(row),
    source_entry_id: Number(row.source_entry_id),
    source_sense_id: Number(row.first_sense_id ?? row.source_sense_id),
    word: row.word,
    source_lang: row.source_lang,
    frequency_rank: row.frequency_rank,
    part_of_speech: row.part_of_speech || null,
    english_anchor: row?.candidate_evidence_review?.english_anchor || row.gloss_key || row.gloss_preview,
    target_lang: 'ja',
    existing_terms: [
      row?.candidate_evidence_review?.preferred_terms?.ja,
      row?.candidate_evidence_review?.suggested_terms?.ja
    ].map((value) => String(value || '').trim()).filter(Boolean),
    observed_families: []
  }));

const output = {
  ok: selected.length === repairKeys.size,
  generated_at: new Date().toISOString(),
  source_report: path.relative(process.cwd(), reportPath),
  preflight_report: path.relative(process.cwd(), preflightPath),
  summary: { rejected_candidates: repairKeys.size, selected: selected.length },
  selected
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: output.ok, out: path.relative(process.cwd(), outPath), ...output.summary }, null, 2));
if (!output.ok) process.exitCode = 1;

function candidateKey(row) { return `${Number(row.source_entry_id)}:${Number(row.source_sense_id ?? row.first_sense_id)}`; }
function required(value, name) { if (!value) throw new Error(`Missing --${name}`); return value; }
function requiredPath(value, name) { const result = path.resolve(required(value, name)); if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`); return result; }
function parseArgs(argv) { const out = {}; for (let i = 0; i < argv.length; i += 1) { if (!argv[i].startsWith('--')) continue; const key = argv[i].slice(2); const next = argv[i + 1]; out[key] = next && !next.startsWith('--') ? argv[++i] : true; } return out; }
