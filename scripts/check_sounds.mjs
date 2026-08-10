import Database from 'better-sqlite3';

const db = new Database('data/processed/linguago.db', { readonly: true });

// 抽查几个典型的多音字
const words = ['炸', '行', '了', '还', '长', '乐', '的', '地'];

for (const w of words) {
  const r = db.prepare('SELECT data FROM dictionary WHERE word=?').get(w);
  if (r) {
    const data = JSON.parse(r.data);
    console.log(`\n=== ${w} ===`);
    console.log('sounds:', JSON.stringify(data.sounds, null, 2));

    // Show senses with their gloss to see if sounds map to specific senses
    if (data.translations?.en) {
      data.translations.en.forEach((t, i) => {
        console.log(`  sense ${i + 1}: [${t.pos}] ${t.gloss}`);
      });
    }
  }
}
