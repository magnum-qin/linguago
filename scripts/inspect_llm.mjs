import Database from 'better-sqlite3';

const db = new Database('data/processed/linguago.db', { readonly: true });
const row = db.prepare(`SELECT word, data FROM dictionary WHERE data LIKE '%"failed":true%' LIMIT 1`).get();

if (row) {
  console.log('WORD:', row.word);
} else {
  console.log('Not found');
}
