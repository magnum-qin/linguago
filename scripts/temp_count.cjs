const db = require('better-sqlite3')('data/processed/linguago.db');
const schema = db.prepare("SELECT sql FROM sqlite_schema WHERE name='dictionary'").get().sql;
console.log('Schema:', schema);

const sample = db.prepare("SELECT * FROM dictionary LIMIT 1").get();
console.log('Sample:', sample);

const statuses = db.prepare("SELECT status, COUNT(*) as c FROM dictionary GROUP BY status").all();
console.log('Statuses:', statuses);
