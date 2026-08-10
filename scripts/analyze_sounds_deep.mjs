import Database from 'better-sqlite3';

const db = new Database('data/processed/linguago.db', { readonly: true });

// Deep analysis: for multi-pronunciation words, check if CC-CEDICT senses group by pronunciation
const testWords = ['炸', '行', '长', '还', '了', '乐', '的', '地', '干', '倒', '差', '薄', '弹'];

for (const w of testWords) {
  const r = db.prepare('SELECT data FROM dictionary WHERE word=?').get(w);
  if (!r) continue;
  const data = JSON.parse(r.data);
  const sounds = data.sounds || [];
  const enTrans = data.translations?.en || [];

  // CC-CEDICT senses have pos="unknown", Wiktionary have other pos values
  const cedictSenses = enTrans.filter((s) => s.pos === 'unknown');
  const wiktSenses = enTrans.filter((s) => s.pos !== 'unknown');

  console.log(`\n=== ${w} ===`);
  console.log(`  sounds: [${sounds.map((s) => s.value).join(', ')}]`);
  console.log(`  CC-CEDICT senses (${cedictSenses.length}):`);
  cedictSenses.forEach((s, i) => {
    console.log(`    ${i + 1}. ${s.gloss}`);
  });
  console.log(`  Wiktionary senses (${wiktSenses.length}):`);
  wiktSenses.forEach((s, i) => {
    console.log(`    ${i + 1}. [${s.pos}] ${s.gloss}`);
  });
}
