import Database from 'better-sqlite3';

const dbIn = new Database('data/processed/linguago.db', { readonly: true });
const dbOut = new Database('data/processed/linguago_cleaned.db');

// Create the same schema
dbOut.exec(`
  CREATE TABLE dictionary (
    word TEXT PRIMARY KEY,
    data JSON
  );
`);

const insert = dbOut.prepare('INSERT INTO dictionary (word, data) VALUES (?, ?)');

dbOut.exec('BEGIN TRANSACTION');

const rows = dbIn.prepare('SELECT word, data FROM dictionary').all();
let cleanedCount = 0;

for (const row of rows) {
  let jsonStr = row.data;

  // Only process if it's suspiciously large (e.g., > 100KB)
  if (jsonStr.length > 100000) {
    try {
      const parsed = JSON.parse(jsonStr);
      let changed = false;

      if (parsed.translations) {
        for (const lang of Object.keys(parsed.translations)) {
          if (Array.isArray(parsed.translations[lang]) && parsed.translations[lang].length > 20) {
            parsed.translations[lang] = parsed.translations[lang].slice(0, 20);
            changed = true;
          }
        }
      }

      if (changed) {
        jsonStr = JSON.stringify(parsed);
        cleanedCount++;
      }
    } catch (e) {
      console.error(`Failed to parse JSON for word: ${row.word}`, e);
    }
  }

  insert.run(row.word, jsonStr);
}

dbOut.exec('COMMIT');

console.log(`Successfully cleaned ${cleanedCount} excessively large dictionary entries.`);
