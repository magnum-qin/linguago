#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(required(args.db, 'db'));
const checkpointPaths = required(args.checkpoints, 'checkpoints')
  .split(',')
  .map((value) => path.resolve(value.trim()))
  .filter(Boolean);
const outPath = path.resolve(required(args.out, 'out'));

for (const filePath of [dbPath, ...checkpointPaths]) {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
}

const senseIds = new Set();
for (const checkpointPath of checkpointPaths) {
  const checkpoint = readJson(checkpointPath);
  for (const item of Object.values(checkpoint.items || {})) {
    if (item?.status !== 'accepted') continue;
    const senseId = Number(item.product_sense_id);
    if (Number.isInteger(senseId)) senseIds.add(senseId);
  }
}
if (!senseIds.size) throw new Error('No accepted product_sense_id values found in checkpoints');

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
db.pragma('query_only = ON');
const placeholders = [...senseIds].map(() => '?').join(',');
const rows = db.prepare(`
  SELECT
    pe.id AS product_entry_id,
    pe.headword,
    pe.primary_lang,
    ps.id AS product_sense_id,
    ps.part_of_speech,
    ps.gloss_key,
    ps.status AS sense_status,
    link.source_entry_id,
    link.source_sense_id,
    link.source_word,
    pl.lang,
    pl.term,
    pl.reading,
    pl.reading_system,
    pl.pronunciation,
    pl.pronunciation_system,
    pl.definition
  FROM product_senses ps
  JOIN product_entries pe ON pe.id = ps.product_entry_id
  JOIN product_sense_source_links link ON link.product_sense_id = ps.id
  JOIN product_localizations pl ON pl.product_sense_id = ps.id
  WHERE ps.id IN (${placeholders})
  ORDER BY ps.id, link.id, pl.lang
`).all(...senseIds);
db.close();

const generatedBySense = new Map();
for (const row of rows) {
  let generated = generatedBySense.get(Number(row.product_sense_id));
  if (!generated) {
    generated = {
      product_entry_id: Number(row.product_entry_id),
      product_sense_id: Number(row.product_sense_id),
      source_entry_id: Number(row.source_entry_id),
      source_sense_id: Number(row.source_sense_id),
      word: row.headword,
      source_lang: row.primary_lang,
      valid: true,
      output: {
        primary_lang: row.primary_lang,
        source_word: row.source_word || row.headword,
        source_sense_id: Number(row.source_sense_id),
        part_of_speech: row.part_of_speech,
        gloss_key: row.gloss_key,
        localizations: {}
      }
    };
    generatedBySense.set(Number(row.product_sense_id), generated);
  }
  if (Number(row.source_sense_id) !== Number(generated.source_sense_id)) continue;
  generated.output.localizations[row.lang] = {
    term: row.term,
    reading: row.reading,
    reading_system: row.reading_system,
    pronunciation: row.pronunciation,
    pronunciation_system: row.pronunciation_system,
    definition: row.definition
  };
}

const generated = [...generatedBySense.values()].filter(
  (row) => ['en', 'pt-BR', 'zh', 'ja'].every((lang) => row.output.localizations[lang]?.term)
);
if (generated.length !== senseIds.size) {
  throw new Error(`Checkpoint/DB mismatch: checkpoint senses=${senseIds.size}, complete DB rows=${generated.length}`);
}

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  derived_from: {
    db: path.relative(process.cwd(), dbPath),
    checkpoints: checkpointPaths.map((filePath) => path.relative(process.cwd(), filePath))
  },
  stats: {
    generated: generated.length,
    accepted: generated.length,
    rejected: 0,
    reconstructed_from_checkpoint_drafts: true
  },
  generated
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), generated: generated.length }, null, 2));

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function required(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return String(value);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index += 1;
    } else parsed[key] = true;
  }
  return parsed;
}
