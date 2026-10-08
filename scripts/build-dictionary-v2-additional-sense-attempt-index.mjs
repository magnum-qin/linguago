#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root || '.');
const runsRoot = path.resolve(root, args['runs-root'] || 'runs');
const outPath = path.resolve(root, args.out || 'state/additional-sense-attempt-index.json');
const historyPaths = String(args.history || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => path.resolve(root, value));
const attempts = new Map();
let reportsRead = 0;

if (fs.existsSync(runsRoot)) {
  for (const runEntry of fs.readdirSync(runsRoot, { withFileTypes: true })) {
    if (!runEntry.isDirectory()) continue;
    const runDir = path.join(runsRoot, runEntry.name);
    const reportPath = path.join(runDir, '00a-daily-primary-senses.json');
    try {
      let report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      reportsRead += 1;
      recordRows(report.selected);
      continue;
    } catch {
      // Recovery runs intentionally skip daily selection because each input is
      // already bound to an exact source sense. Record that manifest input.
    }
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'));
      const inputPath = path.resolve(root, String(manifest.input || ''));
      if (!inputPath.startsWith(root)) continue;
      const report = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
      const exactRows = (report.selected || []).filter((row) =>
        row?.candidate_lane === 'additional_sense_recovery' && candidateKey(row)
      );
      if (exactRows.length === 0) continue;
      reportsRead += 1;
      recordRows(exactRows);
    } catch {
      // A partial or old run must not prevent rebuilding the usable index.
    }
  }
}

for (const historyPath of historyPaths) {
  try {
    const report = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    reportsRead += 1;
    recordRows(report.selected || report.candidates || report.items || report.results || report.reviews);
  } catch (error) {
    throw new Error(`Unable to read attempt history ${historyPath}: ${error.message}`);
  }
}

function recordRows(rows = []) {
  for (const row of rows) {
    const sourceEntryId = Number(row?.source_entry_id);
    const sourceSenseId = Number(row?.first_sense_id ?? row?.source_sense_id);
    if (!Number.isInteger(sourceEntryId) || !Number.isInteger(sourceSenseId)) continue;
    attempts.set(`${sourceEntryId}:${sourceSenseId}`, {
      source_entry_id: sourceEntryId,
      source_sense_id: sourceSenseId
    });
  }
}

const selected = [...attempts.values()].sort(
  (left, right) => left.source_entry_id - right.source_entry_id || left.source_sense_id - right.source_sense_id
);
const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  policy: {
    records_every_locked_daily_primary_sense: true,
    failed_and_successful_runs_are_both_attempts: true,
    explicit_history_reports_are_attempts: true
  },
  summary: { reports_read: reportsRead, attempted_source_senses: selected.length },
  selected
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2));

function candidateKey(row) {
  const sourceEntryId = Number(row?.source_entry_id);
  const sourceSenseId = Number(row?.first_sense_id ?? row?.source_sense_id);
  return Number.isInteger(sourceEntryId) && Number.isInteger(sourceSenseId)
    ? `${sourceEntryId}:${sourceSenseId}`
    : '';
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) result[key] = argv[++index];
    else result[key] = 'true';
  }
  return result;
}
