import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dbArg = process.argv.indexOf('--db');
if (dbArg < 0 || !process.argv[dbArg + 1]) {
  throw new Error('Usage: node checkpoint-sqlite-db.mjs --db <path>');
}

const dbPath = path.resolve(process.argv[dbArg + 1]);
if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath);
try {
  const result = db.pragma('wal_checkpoint(TRUNCATE)', { simple: false });
  db.pragma('journal_mode = DELETE');
  process.stdout.write(`${JSON.stringify({ ok: true, db: dbPath, result })}\n`);
} finally {
  db.close();
}
