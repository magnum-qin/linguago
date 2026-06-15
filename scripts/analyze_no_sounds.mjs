import Database from 'better-sqlite3';

const db = new Database('data/processed/linguago.db', { readonly: true });

// Check what kind of words have no sounds - are they all Chinese?
const rows = db.prepare('SELECT word, data FROM dictionary').iterate();

let noSoundsZh = 0;    // Looks like Chinese characters
let noSoundsOther = 0;  // Non-Chinese
let noSoundsTotal = 0;

const zhExamples = [];
const otherExamples = [];

// Simple heuristic: if a word contains CJK characters, it's likely Chinese
function isChinese(word) {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(word);
}

for (const row of rows) {
  let parsed;
  try { parsed = JSON.parse(row.data); } catch { continue; }
  
  const enTrans = parsed.translations?.en;
  if (!enTrans || !Array.isArray(enTrans) || enTrans.length === 0) continue;
  
  const sounds = parsed.sounds || [];
  if (sounds.length > 0) continue; // Skip entries that already have sounds
  
  noSoundsTotal++;
  
  if (isChinese(row.word)) {
    noSoundsZh++;
    if (zhExamples.length < 10) zhExamples.push(row.word);
  } else {
    noSoundsOther++;
    if (otherExamples.length < 10) otherExamples.push(row.word);
  }
}

console.log(`Total no-sounds entries: ${noSoundsTotal}`);
console.log(`  Chinese (CJK): ${noSoundsZh} (${(noSoundsZh/noSoundsTotal*100).toFixed(1)}%)`);
console.log(`  Other:          ${noSoundsOther} (${(noSoundsOther/noSoundsTotal*100).toFixed(1)}%)`);
console.log(`\nChinese examples: ${zhExamples.join(', ')}`);
console.log(`Other examples: ${otherExamples.join(', ')}`);
