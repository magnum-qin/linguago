import Database from 'better-sqlite3';
import fs from 'fs';

const dbPath = 'data/processed/linguago_cleaned.db';
const sqlPath = 'linguago_cleaned.sql';
const db = new Database(dbPath, { readonly: true });
const out = fs.createWriteStream(sqlPath);

// DO NOT ADD BEGIN TRANSACTION or COMMIT for D1 compatibility
out.write('DROP TABLE IF EXISTS dictionary;\n');

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
  
  for (const row of rows) {
    const values = columns.map(c => {
      const val = row[c];
      if (val === null) return 'NULL';
      if (typeof val === 'number') return val;
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

out.end();
console.log('Database dumped to linguago_cleaned.sql');
