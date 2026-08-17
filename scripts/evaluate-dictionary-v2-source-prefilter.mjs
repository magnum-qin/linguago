#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const prefilterPath = requiredPath(args.prefilter, 'prefilter');
const primaryPath = requiredPath(args.primary, 'primary');
const finalPath = args.final ? requiredPath(args.final, 'final') : null;
const outPath = requiredPath(args.out, 'out');
const prefilter = readJson(prefilterPath);
const primary = readJson(primaryPath);
const finalReport = finalPath ? readJson(finalPath) : null;
const failOpen = args['fail-open'] !== 'false';
const prefilterByKey = new Map((prefilter.reviews || []).map((row) => [key(row), row]));
const primaryByKey = new Map((primary.reviews || []).map((row) => [key(row), row]));
const comparedKeys = new Set([...primaryByKey.keys()].filter((candidateKey) => prefilterByKey.has(candidateKey)));
const allFinalAccepted = new Set(
  (finalReport?.selected || finalReport?.reviews || [])
    .filter((row) => row?.consensus_accepted !== false && row?.approved !== false)
    .map(key)
);
const finalAccepted = intersection(allFinalAccepted, comparedKeys);
const primaryApproved = new Set(
  [...primaryByKey]
    .filter(([candidateKey, row]) => comparedKeys.has(candidateKey) && row?.valid === true && row?.approved === true)
    .map(([value]) => value)
);
const prefilterPassed = new Set(
  [...prefilterByKey]
    .filter(
      ([candidateKey, row]) =>
        comparedKeys.has(candidateKey) &&
        ((row?.valid === true && row?.approved === true) || (failOpen && row?.valid !== true))
    )
    .map(([value]) => value)
);
const primaryRetained = intersection(primaryApproved, prefilterPassed);
const finalRetained = intersection(finalAccepted, prefilterPassed);
const output = {
  ok: true,
  created_at: new Date().toISOString(),
  reports: {
    prefilter: relative(prefilterPath),
    primary: relative(primaryPath),
    final: finalPath ? relative(finalPath) : null
  },
  policy: {
    prefilter_is_advisory_only: true,
    prefilter_is_not_dictionary_evidence: true,
    fail_open_on_invalid_or_transport_error: failOpen,
    production_rejection_enabled: false,
    enable_rejection_only_after_zero_final_false_negatives: true
  },
  summary: {
    primary_candidates: primaryByKey.size,
    prefilter_candidates: prefilterByKey.size,
    compared: comparedKeys.size,
    primary_missing_from_prefilter: primaryByKey.size - comparedKeys.size,
    prefilter_valid: [...prefilterByKey].filter(([candidateKey, row]) => comparedKeys.has(candidateKey) && row?.valid === true).length,
    prefilter_passed: prefilterPassed.size,
    prefilter_explicit_rejected: [...prefilterByKey].filter(
      ([candidateKey, row]) => comparedKeys.has(candidateKey) && row?.valid === true && row?.approved !== true
    ).length,
    prefilter_rejected_or_invalid: comparedKeys.size - prefilterPassed.size,
    primary_approved: primaryApproved.size,
    primary_retained: primaryRetained.size,
    primary_recall: ratio(primaryRetained.size, primaryApproved.size),
    final_accepted: finalAccepted.size,
    final_retained: finalRetained.size,
    final_recall: ratio(finalRetained.size, finalAccepted.size),
    theoretical_qwen_calls_saved: comparedKeys.size - prefilterPassed.size,
    theoretical_qwen_call_savings: ratio(comparedKeys.size - prefilterPassed.size, comparedKeys.size)
  },
  false_negatives: {
    primary: details(difference(primaryApproved, prefilterPassed)),
    final: details(difference(finalAccepted, prefilterPassed))
  },
  passed_keys: [...prefilterPassed]
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out: relative(outPath), summary: output.summary, false_negatives: output.false_negatives }, null, 2));

function details(keys) {
  return [...keys].map((candidateKey) => ({
    candidate_key: candidateKey,
    prefilter: summarize(prefilterByKey.get(candidateKey)),
    primary: summarize(primaryByKey.get(candidateKey))
  }));
}

function summarize(row) {
  if (!row) return null;
  return {
    valid: row.valid === true,
    approved: row.approved === true,
    decision: row.decision || null,
    confidence: Number(row.confidence) || null,
    reason: row.reason || null
  };
}

function key(row) {
  return `${Number(row.source_entry_id)}:${Number(row.source_sense_id ?? row.first_sense_id)}`;
}

function intersection(left, right) {
  return new Set([...left].filter((value) => right.has(value)));
}

function difference(left, right) {
  return new Set([...left].filter((value) => !right.has(value)));
}

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : null;
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
