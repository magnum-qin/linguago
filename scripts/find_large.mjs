import Database from 'better-sqlite3';

const db = new Database('data/processed/linguago.db', { readonly: true });
const rows = db
  .prepare('SELECT word, length(data) as size FROM dictionary WHERE length(data) > 500000 ORDER BY size DESC')
  .all();

console.log(`Found ${rows.length} rows > 500KB`);
for (const row of rows) {
  console.log(`- ${row.word}: ${(row.size / 1024 / 1024).toFixed(2)} MB`);
}
