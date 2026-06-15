import Database from 'better-sqlite3';
import fs from 'fs';

const dbPath = 'data/processed/linguago.db';
const sqlPath = 'linguago.sql';
const db = new Database(dbPath, { readonly: true });
const out = fs.createWriteStream(sqlPath);

out.write('PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
for (const table of tables) {
  if (table.name === 'sqlite_sequence') continue;
  
  // Dump schema
  const schema = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='${table.name}'`).get();
  if (schema) out.write(`${schema.sql};\n`);
  
  // Dump data
  const rows = db.prepare(`SELECT * FROM ${table.name}`).all();
  if (rows.length === 0) continue;
  
  const columns = Object.keys(rows[0]);
  const placeholders = columns.map(() => '?').join(', ');
  
  // Create INSERT statements using JSON stringify to handle strings/nulls properly, but doing it safely
  for (const row of rows) {
    const values = columns.map(c => {
      const val = row[c];
      if (val === null) return 'NULL';
      if (typeof val === 'number') return val;
      // escape single quotes
      return `'${String(val).replace(/'/g, "''")}'`;
    });
    out.write(`INSERT INTO ${table.name} VALUES(${values.join(',')});\n`);
  }
}

// Dump indexes
const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type='index'").all();
for (const index of indexes) {
  if (index.sql) out.write(`${index.sql};\n`);
}

out.write('COMMIT;\n');
out.end();
console.log('Database dumped to linguago.sql');
