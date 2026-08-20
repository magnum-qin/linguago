#!/usr/bin/env node

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db');
const outPath = path.resolve(args.out || 'logs/product-verification-audit.json');
if (!fs.existsSync(dbPath)) throw new Error(`Product DB not found: ${dbPath}`);

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
db.pragma('query_only = ON');
const tableExists = Boolean(db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name='product_sense_verification'"
).get());
const accepted = db.prepare("SELECT COUNT(*) AS count FROM product_senses WHERE status='accepted'").get().count;
const rows = tableExists ? db.prepare(`
  SELECT v.*, ps.status
  FROM product_sense_verification v
  JOIN product_senses ps ON ps.id = v.product_sense_id
  ORDER BY v.product_sense_id
`).all() : [];
const issues = [];
if (tableExists) {
  const covered = rows.filter((row) => row.status === 'accepted').length;
  if (covered !== accepted) issues.push({ issue: 'accepted_sense_metadata_gap', accepted, covered });
  for (const row of rows) {
    let families;
    try { families = JSON.parse(row.evidence_families_json); } catch { families = null; }
    if (!Array.isArray(families)) issues.push({ issue: 'invalid_evidence_families_json', sense_id: row.product_sense_id });
    if (row.verification_level === 'ai_reviewed') {
      if (!String(row.review_model || '').trim()) issues.push({ issue: 'ai_reviewed_missing_model', sense_id: row.product_sense_id });
      if (!/^[a-f0-9]{64}$/u.test(String(row.review_report_sha256 || ''))) issues.push({ issue: 'ai_reviewed_missing_review_hash', sense_id: row.product_sense_id });
      if (Number(row.confidence) < 0.9) issues.push({ issue: 'ai_reviewed_low_confidence', sense_id: row.product_sense_id });
    }
  }
}

const output = {
  ok: tableExists && issues.length === 0,
  generated_at: new Date().toISOString(),
  db: path.relative(process.cwd(), dbPath),
  table_exists: tableExists,
  accepted_senses: accepted,
  metadata_rows: rows.length,
  counts: countBy(rows, (row) => row.verification_level),
  issues
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(output, null, 2));
if (!output.ok) process.exitCode = 1;

function countBy(values, selector) {
  const counts = {};
  for (const value of values) counts[selector(value)] = (counts[selector(value)] || 0) + 1;
  return counts;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return parsed;
}
