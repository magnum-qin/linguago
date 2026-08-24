import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
if (!args.db) throw new Error('Usage: node fingerprint-sqlite-logical.mjs --db <path>');

const dbPath = path.resolve(args.db);
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const hash = crypto.createHash('sha256');
let rowCount = 0;

try {
  const tables = db.prepare(`
    SELECT name, sql
    FROM sqlite_schema
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all();

  for (const table of tables) {
    const columns = db.prepare(`PRAGMA table_info(${quoteIdentifier(table.name)})`).all();
    hash.update(JSON.stringify(['table', table.name, table.sql ?? null, columns]));

    if (columns.length === 0) continue;
    const names = columns.map((column) => column.name);
    const order = names.map(quoteIdentifier).join(', ');
    const sql = `SELECT ${order} FROM ${quoteIdentifier(table.name)} ORDER BY ${order}`;
    for (const row of db.prepare(sql).iterate()) {
      hash.update(JSON.stringify(names.map((name) => normalizeValue(row[name]))));
      hash.update('\n');
      rowCount += 1;
    }
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    db: dbPath,
    tables: tables.length,
    rows: rowCount,
    logical_sha256: hash.digest('hex').toUpperCase(),
  }, null, 2)}\n`);
} finally {
  db.close();
}

function normalizeValue(value) {
  if (Buffer.isBuffer(value)) return { blob_base64: value.toString('base64') };
  if (typeof value === 'bigint') return { bigint: value.toString() };
  return value;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) continue;
    parsed[value.slice(2)] = values[index + 1];
    index += 1;
  }
  return parsed;
}
