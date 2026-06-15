import Database from 'better-sqlite3';

const db = new Database('data/processed/linguago.db', { readonly: true });
const words = ['剝離', '剥离'];

for (const w of words) {
  const r = db.prepare("SELECT data FROM dictionary WHERE word=?").get(w);
  console.log('--- ' + w + ' ---');
  if (r) {
    console.log(JSON.stringify(JSON.parse(r.data), null, 2));
  } else {
    console.log("Not found");
  }
}
