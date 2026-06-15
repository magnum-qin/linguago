import Database from 'better-sqlite3';

const db = new Database('data/processed/linguago.db', { readonly: true });

// Count entries by number of sounds
const rows = db.prepare('SELECT word, data FROM dictionary').iterate();

let total = 0;
let noSounds = 0;
let onePron = 0;
let multiPron = 0;
let hasEnBase = 0;

const multiExamples = [];

for (const row of rows) {
  let parsed;
  try { parsed = JSON.parse(row.data); } catch { continue; }
  
  const enTrans = parsed.translations?.en;
  if (!enTrans || !Array.isArray(enTrans) || enTrans.length === 0) continue;
  
  hasEnBase++;
  const sounds = parsed.sounds || [];
  
  if (sounds.length === 0) {
    noSounds++;
  } else if (sounds.length === 1) {
    onePron++;
  } else {
    multiPron++;
    if (multiExamples.length < 5) {
      multiExamples.push({
        word: row.word,
        sounds: sounds.map(s => s.value),
        senseCount: enTrans.length
      });
    }
  }
  total++;
}

console.log(`Total valid entries (has en base): ${hasEnBase}`);
console.log(`No sounds:          ${noSounds} (${(noSounds/hasEnBase*100).toFixed(1)}%)`);
console.log(`Single pronunciation: ${onePron} (${(onePron/hasEnBase*100).toFixed(1)}%)`);
console.log(`Multi pronunciation:  ${multiPron} (${(multiPron/hasEnBase*100).toFixed(1)}%)`);
console.log(`\nMulti-pronunciation examples:`);
multiExamples.forEach(e => {
  console.log(`  ${e.word}: sounds=[${e.sounds.join(', ')}], senses=${e.senseCount}`);
});
