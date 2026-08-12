#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const probePath = requiredPath(args.probe, 'probe');
const qwenPath = requiredPath(args.qwen, 'qwen');
const gemmaPath = requiredPath(args.gemma, 'gemma');
const outPath = path.resolve(required(args.out, 'out'));

const report = readJson(reportPath);
const probe = readJson(probePath);
const qwen = readJson(qwenPath);
const gemma = readJson(gemmaPath);
if (probe.research_only !== true || qwen.research_only !== true || gemma.research_only !== true) {
  throw new Error('Expected research-only probe and reviews');
}
if (qwen.model === gemma.model || !/qwen/iu.test(qwen.model) || !/gemma/iu.test(gemma.model)) {
  throw new Error('Expected independent Qwen and Gemma model families');
}

const probeKeys = new Set((probe.review_candidates || []).map((row) => String(row.candidate_key)));
const qwenReviews = new Map((qwen.reviews || []).map((row) => [String(row.candidate_key), row]));
const gemmaReviews = new Map((gemma.reviews || []).map((row) => [String(row.candidate_key), row]));
const acceptedKeys = new Set(
  [...probeKeys].filter((key) => {
    const left = qwenReviews.get(key);
    const right = gemmaReviews.get(key);
    if (!left?.approved || !right?.approved) return false;
    return (left.supporting_definition_orders || []).some((order) =>
      (right.supporting_definition_orders || []).includes(order)
    );
  })
);
const rows = Array.isArray(report.selected) ? report.selected : [];
const selected = rows
  .filter((row) => acceptedKeys.has(candidateKey(row)))
  .map((row) => ({
    ...row,
    candidate_review_provenance: {
      kind: 'dicionario_aberto_dual_model_definition_review',
      source_probe: relative(probePath),
      qwen_review: relative(qwenPath),
      gemma_review: relative(gemmaPath),
      qwen_review_sha256: sha256(fs.readFileSync(qwenPath)),
      gemma_review_sha256: sha256(fs.readFileSync(gemmaPath))
    }
  }));
const mappedKeys = new Set(selected.map(candidateKey));
const missingKeys = [...acceptedKeys].filter((key) => !mappedKeys.has(key));
if (missingKeys.length) throw new Error(`Accepted candidates missing from source report: ${missingKeys.join(', ')}`);

const output = {
  ...report,
  ok: true,
  generated_at: new Date().toISOString(),
  source_report: relative(reportPath),
  reviewed_definition_probe: relative(probePath),
  review_reports: [relative(qwenPath), relative(gemmaPath)],
  selection_policy: {
    exact_candidate_key_mapping: true,
    qwen_and_gemma_approved: true,
    supporting_definition_order_intersection_required: true,
    publication_evidence: false,
    downstream_reverse_evidence_prefilter_required: true
  },
  summary: {
    ...(report.summary || {}),
    dicionario_aberto_review_mapping: {
      probe_rows: probeKeys.size,
      dual_accepted_rows: acceptedKeys.size,
      source_report_rows: rows.length,
      selected_rows: selected.length
    }
  },
  selected_count: selected.length,
  selected
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary: output.summary.dicionario_aberto_review_mapping }, null, 2));

function candidateKey(row) { return String(row.candidate_key || `${row.source_entry_id}:${row.source_sense_id ?? row.first_sense_id}`); }
function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function relative(value) { return path.relative(process.cwd(), value); }
function required(value, name) { if (!value) throw new Error(`Missing --${name}`); return String(value); }
function requiredPath(value, name) { const result = path.resolve(required(value, name)); if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`); return result; }
function parseArgs(argv) { const out = {}; for (let index = 0; index < argv.length; index += 1) { const token = argv[index]; if (!token.startsWith('--')) continue; const key = token.slice(2); const next = argv[index + 1]; out[key] = next && !next.startsWith('--') ? argv[++index] : true; } return out; }
