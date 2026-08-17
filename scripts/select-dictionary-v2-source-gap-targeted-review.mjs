#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const reviewPath = requiredPath(args.review, 'review');
const outPath = requiredPath(args.out, 'out');
const limit = boundedInteger(args.limit, 100, 1);
const report = readJson(reportPath);
const review = readJson(reviewPath);
const selectedByKey = new Map((report.selected || []).map((row) => [key(row), row]));
const routed = [];
const missing = [];

for (const row of review.reviews || []) {
  const reasons = routeReasons(row);
  if (!reasons.length) continue;
  const candidate = selectedByKey.get(key(row));
  if (!candidate) {
    missing.push(key(row));
    continue;
  }
  routed.push({
    ...candidate,
    targeted_review_route: {
      reasons,
      qwen: summarize(row)
    }
  });
  if (routed.length >= limit) break;
}

const output = {
  ...report,
  generated_at: new Date().toISOString(),
  derived_from: { report: relative(reportPath), review: relative(reviewPath) },
  selection_policy: {
    stage: 'post_qwen_targeted_review',
    routes: ['qwen_invalid', 'qwen_manual_review', 'pt-BR_reject', 'regional_variant_risk'],
    nemotron_is_not_publication_evidence: true,
    accepted_output_requires_gemma_agreement: true
  },
  selected_count: routed.length,
  selected: routed,
  missing_candidate_keys: missing
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out: relative(outPath), selected: routed.length, missing: missing.length, reasons: countReasons(routed) }, null, 2));

function routeReasons(row) {
  const reasons = [];
  if (row?.valid !== true) reasons.push('qwen_invalid');
  if (row?.valid === true && row?.decision === 'manual_review') reasons.push('qwen_manual_review');
  const flags = new Set(row?.risk_flags || []);
  if (flags.has('pt-BR_reject')) reasons.push('pt-BR_reject');
  if (flags.has('rare_or_regional')) reasons.push('regional_variant_risk');
  return reasons;
}

function summarize(row) {
  return {
    valid: row?.valid === true,
    approved: row?.approved === true,
    decision: row?.decision || null,
    confidence: Number(row?.confidence) || null,
    reason: row?.reason || null,
    risk_flags: row?.risk_flags || []
  };
}

function countReasons(rows) {
  const counts = {};
  for (const row of rows) {
    for (const reason of row.targeted_review_route.reasons) counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

function key(row) {
  return `${Number(row.source_entry_id)}:${Number(row.source_sense_id ?? row.first_sense_id)}`;
}

function boundedInteger(value, fallback, minimum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
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
