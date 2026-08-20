#!/usr/bin/env node

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db');
const apply = args.apply === 'true';
if (!fs.existsSync(dbPath)) throw new Error(`Product DB not found: ${dbPath}`);

const db = new Database(dbPath, apply ? {} : { readonly: true, fileMustExist: true });
const exists = Boolean(db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name='product_sense_verification'"
).get());
const accepted = db.prepare("SELECT COUNT(*) AS count FROM product_senses WHERE status='accepted'").get().count;

if (apply && !exists) {
  db.exec(`
    CREATE TABLE product_sense_verification (
      product_sense_id INTEGER PRIMARY KEY REFERENCES product_senses(id) ON DELETE CASCADE,
      verification_level TEXT NOT NULL CHECK (verification_level IN ('verified', 'ai_reviewed')),
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      review_model TEXT,
      review_report_sha256 TEXT,
      evidence_families_json TEXT NOT NULL DEFAULT '[]',
      reviewed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_product_sense_verification_level
      ON product_sense_verification(verification_level, product_sense_id);
  `);
}

let backfilled = 0;
if (apply) {
  const result = db.prepare(`
    INSERT OR IGNORE INTO product_sense_verification
      (product_sense_id, verification_level, confidence, review_model,
       review_report_sha256, evidence_families_json, reviewed_at)
    SELECT id, 'verified', MAX(0, MIN(1, confidence)), NULL, NULL, '[]', CURRENT_TIMESTAMP
    FROM product_senses
    WHERE status = 'accepted'
  `).run();
  backfilled = result.changes;
}

const metadataRows = apply || exists
  ? db.prepare('SELECT verification_level, COUNT(*) AS count FROM product_sense_verification GROUP BY verification_level').all()
  : [];
console.log(JSON.stringify({
  ok: true,
  db: path.relative(process.cwd(), dbPath),
  apply,
  table_existed: exists,
  accepted_senses: accepted,
  backfilled,
  verification_counts: Object.fromEntries(metadataRows.map((row) => [row.verification_level, row.count]))
}, null, 2));

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
