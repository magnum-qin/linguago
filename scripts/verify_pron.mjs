import Database from 'better-sqlite3';

const db = new Database('data/processed/linguago_d1_ready.db', { readonly: true });

// Check pronunciation stats
const total = db.prepare('SELECT COUNT(*) as c FROM senses').get().c;
const withPron = db.prepare("SELECT COUNT(*) as c FROM senses WHERE pronunciation IS NOT NULL").get().c;
const noPron = db.prepare("SELECT COUNT(*) as c FROM senses WHERE pronunciation IS NULL").get().c;

console.log(`Total senses: ${total}`);
console.log(`With pronunciation: ${withPron} (${(withPron/total*100).toFixed(1)}%)`);
console.log(`Without pronunciation: ${noPron} (${(noPron/total*100).toFixed(1)}%)`);

// Spot check specific words
const words = ['炸', '长', '行', '打听', '披萨', '口号', '花園'];
for (const w of words) {
  const sql = `
    SELECT s.sense_order, s.pronunciation, s.gloss
    FROM senses s
    INNER JOIN entries e ON s.entry_id = e.id
    WHERE e.word = ?
    ORDER BY s.sense_order
  `;
  const rows = db.prepare(sql).all(w);
  if (rows.length > 0) {
    console.log(`\n=== ${w} ===`);
    rows.forEach(r => {
      console.log(`  ${r.sense_order}. [${r.pronunciation || 'NULL'}] ${r.gloss}`);
    });
  }
}
