import Database from 'better-sqlite3';
import fs from 'fs';

const db = new Database('data/processed/linguago.db', { readonly: true });
const row = db.prepare("SELECT data FROM dictionary WHERE word = 'to'").get();

if (row) {
  fs.writeFileSync('to_word.json', row.data);
  const parsed = JSON.parse(row.data);

  // Let's summarize what takes up the most space
  console.log('Total bytes:', row.data.length);
  console.log('Translations:', Object.keys(parsed.translations));
  for (const lang of Object.keys(parsed.translations)) {
    const t = parsed.translations[lang];
    console.log(`- ${lang}: ${t.length} meanings`);
    if (t.length > 0) {
      console.log(`  First meaning has ${t[0].examples ? t[0].examples.length : 0} examples`);
    }
  }
} else {
  console.log('Not found.');
}
