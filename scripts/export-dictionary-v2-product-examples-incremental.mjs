#!/usr/bin/env node
// Incremental D1 export for example enrichment waves: only product_examples
// and product_example_localizations rows whose ids exceed the supplied
// watermarks (the ids already present in D1). All other tables are untouched.
// The no-op schema file keeps the push script's schema+chunks flow working
// without dropping or recreating anything.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(
  args.db || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db'
);
const outDir = path.resolve(args['out-dir'] || 'output/d1-examples-incremental');
const sinceExampleId = nonNegativeInteger(args['since-example-id'], 0);
const sinceLocalizationId = nonNegativeInteger(args['since-localization-id'], 0);

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
db.pragma('query_only = ON');

const acceptedSenseIds = new Set(
  db.prepare('SELECT id FROM product_senses WHERE status = \'accepted\'').all().map((row) => Number(row.id))
);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, '000_schema.sql'), '-- incremental examples export: no schema changes\n', 'utf8');

let buffer = '';
let bytes = 0;
let chunkIndex = 1;
const chunkPaths = [];
const stats = { examples: 0, example_localizations: 0, chunks: 0, max_example_id: null, max_localization_id: null };
const exportedExampleIds = new Set();

function append(sql) {
  const sqlBytes = Buffer.byteLength(sql, 'utf8');
  if (bytes > 0 && bytes + sqlBytes > 4_000_000) flush();
  buffer += sql;
  bytes += sqlBytes;
}
function flush() {
  if (!buffer) return;
  const file = path.join(outDir, `${String(chunkIndex).padStart(3, '0')}_data.sql`);
  fs.writeFileSync(file, buffer, 'utf8');
  chunkPaths.push(file);
  chunkIndex += 1;
  buffer = '';
  bytes = 0;
}

const q = (value) => `'${String(value ?? '').replace(/'/gu, "''")}'`;
const n = (value) => (value === null || value === undefined ? 'NULL' : String(value));

for (const row of db.prepare(`
  SELECT id, product_sense_id, example_order, source_lang, source_text, source, confidence
  FROM product_examples
  WHERE needs_review = 0 AND id > ?
  ORDER BY id
`).iterate(sinceExampleId)) {
  if (!acceptedSenseIds.has(Number(row.product_sense_id))) continue;
  exportedExampleIds.add(Number(row.id));
  append(
    `INSERT INTO v2_examples (id, sense_id, example_order, source_lang, source_text, source_reading, difficulty, register_label, source, confidence) VALUES (${n(row.id)}, ${n(row.product_sense_id)}, ${n(row.example_order)}, ${q(row.source_lang)}, ${q(row.source_text)}, NULL, NULL, NULL, ${q(row.source)}, ${n(row.confidence)}) ON CONFLICT(id) DO NOTHING;\n`
  );
  stats.examples += 1;
  stats.max_example_id = Number(row.id);
}

for (const row of db.prepare(`
  SELECT id, product_example_id, lang, text, reading, source, confidence
  FROM product_example_localizations
  WHERE needs_review = 0 AND id > ?
  ORDER BY id
`).iterate(sinceLocalizationId)) {
  if (!exportedExampleIds.has(Number(row.product_example_id))) continue;
  append(
    `INSERT INTO v2_example_localizations (id, example_id, lang, text, reading, source, confidence) VALUES (${n(row.id)}, ${n(row.product_example_id)}, ${q(row.lang)}, ${q(row.text)}, ${q(row.reading)}, ${q(row.source)}, ${n(row.confidence)}) ON CONFLICT(id) DO NOTHING;\n`
  );
  stats.example_localizations += 1;
  stats.max_localization_id = Number(row.id);
}

flush();
stats.chunks = chunkPaths.length;
const manifest = {
  ok: true,
  mode: 'incremental-examples',
  db: path.relative(process.cwd(), dbPath),
  out_dir: path.relative(process.cwd(), outDir),
  since: { example_id: sinceExampleId, localization_id: sinceLocalizationId },
  schema: chunkPaths.length ? path.relative(process.cwd(), path.join(outDir, '000_schema.sql')) : null,
  chunks: chunkPaths.map((file) => path.relative(process.cwd(), file)),
  stats
};
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log(JSON.stringify(manifest, null, 2));
db.close();

function nonNegativeInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Invalid non-negative integer: ${value}`);
  return parsed;
}
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    out[key] = next && !next.startsWith('--') ? argv[++i] : 'true';
  }
  return out;
}
