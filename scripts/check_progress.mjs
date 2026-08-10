import Database from 'better-sqlite3';

const db = new Database('data/processed/linguago_d1_ready.db', { readonly: true });

// How many multi-pron entries got filled vs not
const nullEntries = db
  .prepare(
    `
  SELECT COUNT(DISTINCT e.id) as c 
  FROM entries e 
  INNER JOIN senses s ON s.entry_id = e.id 
  WHERE s.pronunciation IS NULL
`
  )
  .get();

console.log('Entries with NULL pronunciation senses:', nullEntries.c);

// Check specific multi-pron words
const words = ['炸', '长', '行', '还', '倒', '差'];
for (const w of words) {
  const rows = db
    .prepare(
      `
    SELECT s.sense_order, s.pronunciation, s.gloss
    FROM senses s INNER JOIN entries e ON s.entry_id = e.id
    WHERE e.word = ? ORDER BY s.sense_order
  `
    )
    .all(w);

  if (rows.length > 0) {
    const hasNull = rows.some((r) => !r.pronunciation);
    console.log(`\n${w}: ${hasNull ? '❌ NOT DONE' : '✅ DONE'}`);
    rows.slice(0, 4).forEach((r) => {
      console.log(`  ${r.sense_order}. [${r.pronunciation || 'NULL'}] ${r.gloss?.substring(0, 40)}`);
    });
    if (rows.length > 4) console.log(`  ... (${rows.length} senses total)`);
  }
}
