import fs from 'fs';
import zlib from 'zlib';
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';
import csv from 'csv-parser';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAW_DIR = path.join(__dirname, '../data/raw');
const DB_PATH = path.join(__dirname, '../data/processed/linguago.db');

// Ensure directory exists
if (!fs.existsSync(path.dirname(DB_PATH))) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

console.log('Initializing SQLite Database (WAL Mode)...');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -64000'); // 64MB cache

db.exec(`
  CREATE TABLE IF NOT EXISTS dictionary (
    word TEXT PRIMARY KEY,
    data JSON
  )
`);

const stmtGet = db.prepare('SELECT data FROM dictionary WHERE word = ?');
const stmtInsert = db.prepare('INSERT OR REPLACE INTO dictionary (word, data) VALUES (?, ?)');

function createEmptyData(word) {
  return {
    word: word,
    sounds: [],
    translations: { zh: [], en: [], ja: [], pt: [] }
  };
}

function getWordData(word) {
  const row = stmtGet.get(word);
  if (row) {
    try {
      return JSON.parse(row.data);
    } catch (e) {
      return createEmptyData(word);
    }
  }
  return createEmptyData(word);
}

function saveWordData(word, data) {
  stmtInsert.run(word, JSON.stringify(data));
}

// Memory buffer for massive transactions
let batchBuffer = new Map();
const BATCH_SIZE = 25000;

function flushBatch() {
  if (batchBuffer.size === 0) return;
  const processBatch = db.transaction((entries) => {
    for (const [word, updates] of entries) {
      let data = getWordData(word);
      // apply sounds
      for (const s of updates.sounds) {
        if (!data.sounds.find((ex) => ex.value === s.value && ex.type === s.type)) {
          data.sounds.push(s);
        }
      }
      // apply translations
      for (const lang of ['zh', 'en', 'ja', 'pt']) {
        if (updates.translations[lang]) {
          for (const t of updates.translations[lang]) {
            const exists = data.translations[lang].find(
              (ex) => ex.word === t.word && ex.pos === t.pos && ex.gloss === t.gloss
            );
            if (!exists) data.translations[lang].push(t);
          }
        }
      }
      saveWordData(word, data);
    }
  });

  processBatch(Array.from(batchBuffer.entries()));
  batchBuffer.clear();
}

function queueUpdate(word, soundObj, targetLang, transObj) {
  // Truncate overly long words to avoid junk
  if (word.length > 50) return;

  if (!batchBuffer.has(word)) {
    batchBuffer.set(word, { sounds: [], translations: {} });
  }
  const entry = batchBuffer.get(word);
  if (soundObj) entry.sounds.push(soundObj);
  if (targetLang && transObj) {
    if (!entry.translations[targetLang]) entry.translations[targetLang] = [];
    entry.translations[targetLang].push(transObj);
  }

  if (batchBuffer.size >= BATCH_SIZE) {
    flushBatch();
  }
}

async function parseCCCedict() {
  const filePath = path.join(RAW_DIR, 'CC-CEDICT.txt.gz');
  if (!fs.existsSync(filePath)) return;
  console.log('\n[1/3] Parsing CC-CEDICT (120K entries)...');

  const fileStream = fs.createReadStream(filePath);
  const gunzip = zlib.createGunzip();
  const rl = readline.createInterface({ input: fileStream.pipe(gunzip), crlfDelay: Infinity });

  let lineCount = 0;
  for await (const line of rl) {
    if (line.startsWith('#')) continue;
    const match = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\//);
    if (match) {
      const simplified = match[2];
      const pinyin = match[3];
      const glosses = match[4].split('/');

      queueUpdate(simplified, { type: 'pinyin', value: pinyin }, null, null);

      for (const gloss of glosses) {
        const mainWordMatch = gloss.match(/[a-zA-Z]+/);
        if (mainWordMatch) {
          const mainWord = mainWordMatch[0].toLowerCase();
          queueUpdate(simplified, null, 'en', {
            word: mainWord,
            pos: 'unknown',
            gloss: gloss,
            examples: []
          });
          queueUpdate(mainWord, null, 'zh', {
            word: simplified,
            pos: 'unknown',
            gloss: gloss,
            examples: []
          });
        }
      }
      lineCount++;
      if (lineCount % 10000 === 0) process.stdout.write(`\rProcessed ${lineCount} lines...`);
    }
  }
  flushBatch();
  console.log(`\rCC-CEDICT complete. Total: ${lineCount} lines.`);
}

async function parseECDICT() {
  const filePath = path.join(RAW_DIR, 'ecdict.csv');
  if (!fs.existsSync(filePath)) return;
  console.log('\n[2/3] Parsing ECDICT (3.4M entries)...');

  let lineCount = 0;
  return new Promise((resolve) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        const word = (row.word || '').toLowerCase();
        if (!word) return;

        let soundObj = null;
        if (row.phonetic) {
          soundObj = { type: 'ipa', value: row.phonetic };
        }

        const transString = row.translation || '';
        if (soundObj || transString) {
          queueUpdate(word, soundObj, null, null);

          if (transString) {
            const lines = transString.split('\\n');
            for (const line of lines) {
              const parts = line.split('.');
              let pos = 'unknown';
              let glosses = line;
              if (parts.length > 1 && parts[0].length < 10) {
                pos = parts[0].trim();
                glosses = parts.slice(1).join('.').trim();
              }
              // Extract a clean Chinese word if possible
              const zhMatch = glosses.match(/[\u4e00-\u9fa5]+/);
              if (zhMatch) {
                queueUpdate(word, null, 'zh', {
                  word: zhMatch[0],
                  pos: pos,
                  gloss: glosses,
                  examples: []
                });
              }
            }
          }
        }

        lineCount++;
        if (lineCount % 100000 === 0) process.stdout.write(`\rProcessed ${lineCount} lines...`);
      })
      .on('end', () => {
        flushBatch();
        console.log(`\rECDICT complete. Total: ${lineCount} lines.`);
        resolve();
      });
  });
}

async function parseKaikkiChinese() {
  const filePath = path.join(RAW_DIR, 'kaikki_Chinese.jsonl');
  if (!fs.existsSync(filePath)) return;
  console.log('\n[3/3] Parsing Kaikki Chinese (100K entries)...');

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let lineCount = 0;
  for await (const line of rl) {
    try {
      const entry = JSON.parse(line);
      const word = entry.word;
      if (!word) continue;

      const pos = entry.pos || 'unknown';
      const senses = entry.senses || [];

      for (const sense of senses) {
        const glosses = sense.glosses || [];
        for (const gloss of glosses) {
          const mainWordMatch = gloss.match(/[a-zA-Z]+/);
          if (mainWordMatch) {
            const mainWord = mainWordMatch[0].toLowerCase();
            queueUpdate(word, null, 'en', {
              word: mainWord,
              pos: pos,
              gloss: gloss,
              examples: (sense.examples || []).map((e) => ({ text: e.text, translation: e.english || '' }))
            });
          }
        }
      }
      lineCount++;
      if (lineCount % 10000 === 0) process.stdout.write(`\rProcessed ${lineCount} lines...`);
    } catch (e) {}
  }
  flushBatch();
  console.log(`\rKaikki complete. Total: ${lineCount} lines.`);
}

async function main() {
  console.time('Full Fusion Time');
  await parseCCCedict();
  await parseECDICT();
  await parseKaikkiChinese();
  console.timeEnd('Full Fusion Time');

  // Compact DB
  console.log('\nCompacting SQLite Database (VACUUM)...');
  db.exec('VACUUM');

  console.log(`\n✅ Ultimate Full Fusion to SQLite complete!`);
}

main().catch(console.error);
