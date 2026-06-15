import Database from 'better-sqlite3';

const db = new Database('data/processed/linguago.db', { readonly: true });
const r = db.prepare("SELECT data FROM dictionary WHERE word='炸'").get();
if (r) {
  console.log(JSON.stringify(JSON.parse(r.data), null, 2));
} else {
  console.log("Not found");
}
