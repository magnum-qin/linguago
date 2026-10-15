#!/usr/bin/env node
// Select accepted senses that lack reviewed examples, ordered by entry
// frequency so enrichment lands on the words users actually look up.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(
  args.db || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db'
);
const outPath = path.resolve(args.out || 'logs/example-enrichment-cohort.json');
const limit = positiveInteger(args.limit, 300);
// Pilot keeps one example per entry (its primary sense); later waves can
// relax this to cover secondary senses of the same entry.
const primaryOnly = args['primary-sense-only'] !== 'false';
const maxRank = positiveInteger(args['max-rank'], 100_000);

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
db.pragma('query_only = ON');
const rows = db.prepare(`
  SELECT ps.id AS product_sense_id,
         ps.sense_order,
         ps.gloss_key,
         ps.part_of_speech,
         pe.headword,
         pe.primary_lang,
         pe.frequency_rank
  FROM product_senses ps
  JOIN product_entries pe ON pe.id = ps.product_entry_id
  WHERE ps.status = 'accepted'
    AND pe.status = 'accepted'
    AND pe.frequency_rank IS NOT NULL
    AND pe.frequency_rank <= ?
    ${primaryOnly ? 'AND ps.sense_order = 1' : ''}
    AND NOT EXISTS (
      SELECT 1 FROM product_examples ex
      WHERE ex.product_sense_id = ps.id AND ex.needs_review = 0
    )
  ORDER BY pe.frequency_rank, ps.sense_order, ps.id
  LIMIT ?
`).all(maxRank, limit);

const byLang = {};
for (const row of rows) byLang[row.primary_lang] = (byLang[row.primary_lang] || 0) + 1;
const report = {
  ok: true,
  generated_at: new Date().toISOString(),
  summary: {
    db: path.relative(process.cwd(), dbPath),
    selected: rows.length,
    primary_sense_only: primaryOnly,
    max_rank: maxRank,
    selected_by_lang: byLang
  },
  selected_count: rows.length,
  selected: rows
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report.summary));

function positiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid positive integer: ${value}`);
  }
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
