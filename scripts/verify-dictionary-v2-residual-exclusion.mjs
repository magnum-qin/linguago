import fs from 'node:fs';
import path from 'node:path';

function value(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

function rows(report) {
  for (const key of ['selected', 'candidates', 'items', 'results']) {
    if (Array.isArray(report?.[key])) return report[key];
  }
  return [];
}

function senseId(row) {
  return row.source_sense_id ?? row.first_sense_id ?? row.daily_sense_selection?.selected_sense_id;
}

function key(row) {
  return `${row.source_entry_id}:${senseId(row)}`;
}

const batchPath = value('batch');
const residualPath = value('residual');
const previewLimit = Number(value('preview-limit', '20'));

if (!batchPath || !residualPath) {
  throw new Error('Usage: --batch <path> --residual <path> [--preview-limit 20]');
}

const batchRows = rows(readJson(batchPath));
const residualRows = rows(readJson(residualPath));
const residualKeys = new Set(residualRows.map(key));
const overlap = batchRows.filter((row) => residualKeys.has(key(row)));

const result = {
  ok: overlap.length === 0,
  batch_count: batchRows.length,
  residual_count: residualRows.length,
  exact_overlap: overlap.length,
  overlap: overlap.map((row) => ({
    word: row.word,
    source_lang: row.source_lang,
    source_entry_id: row.source_entry_id,
    source_sense_id: senseId(row),
  })),
  preview: batchRows.slice(0, previewLimit).map((row) => ({
    word: row.word,
    source_lang: row.source_lang,
    source_entry_id: row.source_entry_id,
    source_sense_id: senseId(row),
    frequency_rank: row.frequency_rank,
    gloss: row.gloss_preview ?? row.gloss_key ?? null,
  })),
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
