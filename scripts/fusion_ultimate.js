import fs from 'fs';
import zlib from 'zlib';
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';
import csv from 'csv-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAW_DIR = path.join(__dirname, '../data/raw');
const PROCESSED_DIR = path.join(__dirname, '../data/processed');

const TARGET_WORDS = new Set([
  'hello', 'apple', 'water', 'book', 'bank',
  '你好', '苹果', '水', '书', '银行', '河岸',
  'こんにちは', 'りんご', '本', 'みず', '銀行', '土手',
  'olá', 'maçã', 'água', 'livro', 'banco'
]);

const goldenDatabase = {};

for (const word of TARGET_WORDS) {
  goldenDatabase[word] = {
    word: word,
    sounds: [],
    translations: { zh: [], en: [], ja: [], pt: [] }
  };
}

// Helper to add a rich translation sense
function addTranslation(sourceWord, targetLang, targetObj) {
  if (goldenDatabase[sourceWord]) {
    const list = goldenDatabase[sourceWord].translations[targetLang];
    // Avoid exact duplicates
    const exists = list.find(t => t.word === targetObj.word && t.pos === targetObj.pos && t.gloss === targetObj.gloss);
    if (!exists) {
      list.push(targetObj);
    }
  }
}

// Helper to add sound to source word
function addSound(word, soundObj) {
  if (goldenDatabase[word]) {
    const exists = goldenDatabase[word].sounds.find(s => s.value === soundObj.value && s.type === soundObj.type);
    if (!exists) {
      goldenDatabase[word].sounds.push(soundObj);
    }
  }
}

async function parseCCCedict() {
  const filePath = path.join(RAW_DIR, 'CC-CEDICT.txt.gz');
  if (!fs.existsSync(filePath)) return;
  console.log("Parsing CC-CEDICT...");
  
  const fileStream = fs.createReadStream(filePath);
  const gunzip = zlib.createGunzip();
  const rl = readline.createInterface({ input: fileStream.pipe(gunzip), crlfDelay: Infinity });
  
  for await (const line of rl) {
    if (line.startsWith('#')) continue;
    const match = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\//);
    if (match) {
      const simplified = match[2];
      const pinyin = match[3];
      const glosses = match[4].split('/');
      
      if (TARGET_WORDS.has(simplified)) {
        addSound(simplified, { type: 'pinyin', value: pinyin });
        
        for (const gloss of glosses) {
          const mainWord = gloss.split(/[,;\s]/)[0].toLowerCase().replace(/[^a-z]/g, '');
          if (TARGET_WORDS.has(mainWord)) {
             addTranslation(simplified, 'en', {
               word: mainWord,
               pos: "unknown",
               gloss: gloss,
               examples: []
             });
             addTranslation(mainWord, 'zh', {
               word: simplified,
               pos: "unknown",
               gloss: gloss,
               examples: []
             });
          }
        }
      }
    }
  }
}

async function parseECDICT() {
  const filePath = path.join(RAW_DIR, 'ecdict.csv');
  if (!fs.existsSync(filePath)) return;
  console.log("Parsing ECDICT...");
  
  return new Promise((resolve) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        const word = (row.word || '').toLowerCase();
        if (TARGET_WORDS.has(word)) {
          if (row.phonetic) {
            addSound(word, { type: 'ipa', value: row.phonetic });
          }
          const transString = row.translation || '';
          const lines = transString.split('\\n');
          for (const line of lines) {
             const parts = line.split('.');
             let pos = "unknown";
             let glosses = line;
             if (parts.length > 1 && parts[0].length < 10) {
                pos = parts[0].trim();
                glosses = parts[1].trim();
             }
             
             for (const target of TARGET_WORDS) {
                if (glosses.includes(target)) {
                  addTranslation(word, 'zh', {
                    word: target,
                    pos: pos,
                    gloss: glosses,
                    examples: []
                  });
                  addTranslation(target, 'en', {
                    word: word,
                    pos: pos,
                    gloss: glosses,
                    examples: []
                  });
                }
             }
          }
        }
      })
      .on('end', resolve);
  });
}

async function parseKaikkiChinese() {
  const filePath = path.join(RAW_DIR, 'kaikki_Chinese.jsonl');
  if (!fs.existsSync(filePath)) return;
  console.log("Parsing Kaikki Chinese...");
  
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  
  for await (const line of rl) {
    try {
      const entry = JSON.parse(line);
      const word = entry.word;
      if (!TARGET_WORDS.has(word)) continue;
      
      const pos = entry.pos || "unknown";
      const senses = entry.senses || [];
      
      for (const sense of senses) {
        const glosses = sense.glosses || [];
        for (const gloss of glosses) {
          const mainWord = gloss.split(/[,;\s]/)[0].toLowerCase().trim();
          if (TARGET_WORDS.has(mainWord)) {
             addTranslation(word, 'en', {
               word: mainWord,
               pos: pos,
               gloss: gloss,
               examples: (sense.examples || []).map(e => ({ text: e.text, translation: e.english }))
             });
             addTranslation(mainWord, 'zh', {
               word: word,
               pos: pos,
               gloss: gloss,
               examples: (sense.examples || []).map(e => ({ text: e.english, translation: e.text }))
             });
          }
        }
      }
    } catch (e) {}
  }
}

async function main() {
  if (!fs.existsSync(PROCESSED_DIR)) {
    fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  }

  await parseCCCedict();
  await parseECDICT();
  await parseKaikkiChinese();
  
  // Strip empty entries for cleaner output
  const cleanDb = {};
  for (const [key, val] of Object.entries(goldenDatabase)) {
    let hasData = val.sounds.length > 0;
    for (const lang of ['zh', 'en', 'ja', 'pt']) {
      if (val.translations[lang].length > 0) hasData = true;
    }
    if (hasData) cleanDb[key] = val;
  }
  
  const outputPath = path.join(PROCESSED_DIR, 'fusion_ultimate_sample.json');
  fs.writeFileSync(outputPath, JSON.stringify(cleanDb, null, 2));
  
  console.log(`Ultimate Fusion complete!`);
  console.log(`Saved to: ${outputPath}`);
}

main().catch(console.error);
