#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root || '.');
const historyPaths = String(args.history || 'data/candidates/v123-attempted-source-history.json')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => path.resolve(root, value));
const runsRoot = path.resolve(root, args['runs-root'] || 'runs');
const batchRoot = path.resolve(root, args['batch-root'] || 'batches');
const outPath = path.resolve(root, args.out || 'state/native-daily-source-entry-exclusions.json');

const reportPaths = new Set(historyPaths);
if (fs.existsSync(runsRoot)) {
  for (const manifestPath of walkManifestFiles(runsRoot)) {
    try {
      const manifest = readJson(manifestPath);
      if (!['complete', 'completed', 'succeeded'].includes(String(manifest.status || ''))) continue;
      if (!manifest.input) continue;
      const inputPath = path.resolve(root, String(manifest.input));
      if (!isInside(inputPath, batchRoot) || !fs.existsSync(inputPath)) continue;
      reportPaths.add(inputPath);
    } catch {
      // An unreadable old run must not prevent rebuilding exclusions from healthy runs.
    }
  }
}

const sourceEntryIds = new Set();
let reportsRead = 0;
for (const reportPath of reportPaths) {
  if (!fs.existsSync(reportPath)) continue;
  const report = readJson(reportPath);
  reportsRead += 1;
  for (const row of candidateRows(report)) {
    const id = Number(row?.source_entry_id ?? row?.entry_id);
    if (Number.isInteger(id) && id > 0) sourceEntryIds.add(id);
  }
}

const selected = [...sourceEntryIds]
  .sort((left, right) => left - right)
  .map((source_entry_id) => ({ source_entry_id }));
const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  summary: {
    reports_discovered: reportPaths.size,
    reports_read: reportsRead,
    unique_source_entry_ids: selected.length
  },
  selected
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary: output.summary }, null, 2));

function* walkManifestFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walkManifestFiles(entryPath);
    else if (entry.isFile() && entry.name === 'manifest.json') yield entryPath;
  }
}

function candidateRows(report) {
  if (Array.isArray(report)) return report;
  for (const key of ['selected', 'items', 'candidates', 'entries', 'generated']) {
    if (Array.isArray(report?.[key])) return report[key];
  }
  return [];
}

function isInside(candidate, directory) {
  const relativePath = path.relative(directory, candidate);
  return relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function relative(value) {
  return path.relative(process.cwd(), value);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      result[key] = next;
      index += 1;
    } else result[key] = 'true';
  }
  return result;
}
