import Database from 'better-sqlite3';
import fs from 'fs';
import { pinyin } from 'pinyin-pro';

// ─── Config ───
const dbIn = new Database('data/processed/linguago.db', { readonly: true });
const dbOutPath = 'data/processed/linguago_d1_ready.db';
if (fs.existsSync(dbOutPath)) fs.unlinkSync(dbOutPath);
const dbOut = new Database(dbOutPath);

// ─── Schema ───
dbOut.exec(`
  CREATE TABLE entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL,
    source_lang TEXT NOT NULL,
    UNIQUE(word, source_lang)
  );

  CREATE TABLE senses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL,
    sense_order INTEGER NOT NULL,
    pos TEXT,
    gloss TEXT,
    pronunciation TEXT,
    FOREIGN KEY(entry_id) REFERENCES entries(id)
  );

  CREATE TABLE definitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sense_id INTEGER NOT NULL,
    lang TEXT NOT NULL,
    translation TEXT NOT NULL,
    FOREIGN KEY(sense_id) REFERENCES senses(id)
  );

  CREATE TABLE examples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sense_id INTEGER NOT NULL,
    source_sentence TEXT NOT NULL,
    translation_zh TEXT,
    translation_en TEXT,
    translation_ja TEXT,
    translation_pt TEXT,
    FOREIGN KEY(sense_id) REFERENCES senses(id)
  );
`);

const insertEntry = dbOut.prepare('INSERT OR IGNORE INTO entries (word, source_lang) VALUES (?, ?)');
const insertSense = dbOut.prepare(
  'INSERT INTO senses (entry_id, sense_order, pos, gloss, pronunciation) VALUES (?, ?, ?, ?, ?)'
);
const insertDef = dbOut.prepare('INSERT INTO definitions (sense_id, lang, translation) VALUES (?, ?, ?)');
const insertEx = dbOut.prepare(
  'INSERT INTO examples (sense_id, source_sentence, translation_zh, translation_en, translation_ja, translation_pt) VALUES (?, ?, ?, ?, ?, ?)'
);

// ─── Helpers ───
function isChinese(word) {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(word);
}

// Convert tone-number pinyin (e.g. "zha2") to tone-mark pinyin (e.g. "zhá")
// pinyin-pro already outputs tone marks, but source data uses tone numbers.
// We'll normalize the source data sounds using pinyin-pro's convert function.
function normalizePinyin(toneNumStr) {
  // pinyin-pro can convert between formats, but let's keep as-is for now
  // The source data uses tone numbers like "zha2", we'll keep that format consistent.
  return toneNumStr;
}

// ─── Stats ───
let processedCount = 0;
let skippedCount = 0;
let singlePronCount = 0;
let pinyinProCount = 0;
let multiPronCount = 0;
let noPronCount = 0;

// Track multi-pronunciation entries for later LLM processing
const multiPronEntries = [];

console.log('Starting export pipeline with sense-level pronunciation...');
dbOut.exec('BEGIN TRANSACTION');

const rows = dbIn.prepare('SELECT word, data FROM dictionary').iterate();

for (const row of rows) {
  let parsed;
  try {
    parsed = JSON.parse(row.data);
  } catch {
    skippedCount++;
    continue;
  }

  const enTrans = parsed.translations?.en;
  if (!enTrans || !Array.isArray(enTrans) || enTrans.length === 0) {
    skippedCount++;
    continue;
  }

  // Insert entry
  const sourceLang = parsed.source_lang || 'en';
  let entryId;
  try {
    const result = insertEntry.run(row.word, sourceLang);
    entryId = result.lastInsertRowid;
    if (result.changes === 0) continue; // duplicate
  } catch {
    continue;
  }

  // ─── Determine pronunciation strategy ───
  const sounds = parsed.sounds || [];
  const senses = enTrans.slice(0, 15);

  let pronunciationStrategy; // 'single' | 'pinyin-pro' | 'multi' | 'none'
  let singlePron = null;
  let pinyinProPron = null;

  if (sounds.length === 1) {
    // Layer 2: Single pronunciation → assign to all senses
    pronunciationStrategy = 'single';
    singlePron = sounds[0].value;
    singlePronCount++;
  } else if (sounds.length === 0 && isChinese(row.word)) {
    // Layer 1 upgrade: No sounds + Chinese → use pinyin-pro
    pronunciationStrategy = 'pinyin-pro';
    try {
      pinyinProPron = pinyin(row.word, { toneType: 'symbol' });
    } catch {
      pinyinProPron = null;
    }
    if (pinyinProPron) {
      pinyinProCount++;
    } else {
      pronunciationStrategy = 'none';
      noPronCount++;
    }
  } else if (sounds.length > 1) {
    // Layer 3: Multiple pronunciations → leave NULL for LLM
    pronunciationStrategy = 'multi';
    multiPronCount++;
    multiPronEntries.push({
      entryId,
      word: row.word,
      sounds: sounds.map((s) => s.value),
      senses: senses.map((s, i) => ({ sense_order: i + 1, gloss: s.gloss || '' }))
    });
  } else {
    pronunciationStrategy = 'none';
    noPronCount++;
  }

  // ─── Insert senses with pronunciation ───
  senses.forEach((enSense, index) => {
    let pron = null;
    if (pronunciationStrategy === 'single') {
      pron = singlePron;
    } else if (pronunciationStrategy === 'pinyin-pro') {
      pron = pinyinProPron;
    }
    // 'multi' and 'none' → pron stays NULL

    const pos = enSense.pos || null;
    const gloss = enSense.gloss || null;
    const senseId = insertSense.run(entryId, index + 1, pos, gloss, pron).lastInsertRowid;

    // Definitions
    if (enSense.word) insertDef.run(senseId, 'en', enSense.word);
    ['zh', 'ja', 'pt'].forEach((lang) => {
      const transArr = parsed.translations[lang];
      if (transArr && Array.isArray(transArr) && transArr[index] && transArr[index].word) {
        const dbLang = lang === 'pt' ? 'pt-BR' : lang;
        insertDef.run(senseId, dbLang, transArr[index].word);
      }
    });

    // Examples
    const examples = enSense.examples || [];
    examples.slice(0, 5).forEach((ex) => {
      const sourceSentence = ex.text || ex.en || ex.source_sentence || '';
      if (sourceSentence) {
        insertEx.run(
          senseId,
          sourceSentence,
          ex.zh || ex.translation || null,
          ex.en || ex.text || null,
          ex.ja || null,
          ex.pt || null
        );
      }
    });
  });

  processedCount++;
  if (processedCount % 50000 === 0) {
    console.log(`  Processed ${processedCount} entries...`);
  }
}

dbOut.exec('COMMIT');

// ─── Save multi-pronunciation entries for LLM processing ───
const multiPronPath = 'data/processed/multi_pron_entries.json';
fs.writeFileSync(multiPronPath, JSON.stringify(multiPronEntries, null, 2));

dbOut.close();

console.log(`\n=== Export Complete ===`);
console.log(`Processed:        ${processedCount}`);
console.log(`Skipped (noise):  ${skippedCount}`);
console.log(`Single pron:      ${singlePronCount} (auto-assigned)`);
console.log(`Pinyin-pro:       ${pinyinProCount} (auto-generated)`);
console.log(`Multi pron:       ${multiPronCount} (awaiting LLM)`);
console.log(`No pron:          ${noPronCount} (NULL)`);
console.log(`\nMulti-pron entries saved to ${multiPronPath} for LLM processing.`);
console.log(`Normalized database ready at ${dbOutPath}`);
