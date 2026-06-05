import fs from 'fs';
import zlib from 'zlib';
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';
import csv from 'csv-parser';
import { XMLParser } from 'fast-xml-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAW_DIR = path.join(__dirname, '../data/raw');
const PROCESSED_DIR = path.join(__dirname, '../data/processed');

// Core sample words for testing
const TARGET_WORDS = new Set([
  'hello', 'apple', 'water', 'book',
  '你好', '苹果', '水', '书',
  'こんにちは', 'りんご', '本', 'みず',
  'olá', 'maçã', 'água', 'livro'
]);

const goldenDatabase = {};

// Initialize database
for (const word of TARGET_WORDS) {
  goldenDatabase[word] = {
    word: word,
    translations: { zh: [], en: [], ja: [], pt: [] }
  };
}

function addTranslation(sourceWord, targetLang, targetWord, sourceLang) {
  if (goldenDatabase[sourceWord] && targetWord) {
    if (!goldenDatabase[sourceWord].translations[targetLang].includes(targetWord)) {
      goldenDatabase[sourceWord].translations[targetLang].push(targetWord);
    }
  }
  if (goldenDatabase[targetWord] && sourceWord) {
    if (!goldenDatabase[targetWord].translations[sourceLang].includes(sourceWord)) {
      goldenDatabase[targetWord].translations[sourceLang].push(sourceWord);
    }
  }
}

async function parseCCCedict() {
  const filePath = path.join(RAW_DIR, 'CC-CEDICT.txt.gz');
  if (!fs.existsSync(filePath)) return;
  console.log("Parsing CC-CEDICT (ZH <-> EN)...");
  
  const fileStream = fs.createReadStream(filePath);
  const gunzip = zlib.createGunzip();
  const rl = readline.createInterface({ input: fileStream.pipe(gunzip), crlfDelay: Infinity });
  
  for await (const line of rl) {
    if (line.startsWith('#')) continue;
    const match = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\//);
    if (match) {
      const simplified = match[2];
      const glosses = match[4].split('/');
      
      if (TARGET_WORDS.has(simplified)) {
        for (const gloss of glosses) {
          const mainWord = gloss.split(' ')[0].toLowerCase().replace(/[^a-z]/g, ''); // Rough extraction
          if (TARGET_WORDS.has(mainWord)) {
             addTranslation(simplified, 'en', mainWord, 'zh');
          }
        }
      }
    }
  }
}

async function parseECDICT() {
  const filePath = path.join(RAW_DIR, 'ecdict.csv');
  if (!fs.existsSync(filePath)) return;
  console.log("Parsing ECDICT (EN <-> ZH)...");
  
  return new Promise((resolve) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        const word = (row.word || '').toLowerCase();
        if (TARGET_WORDS.has(word)) {
          const transString = row.translation || '';
          // ECdict translations often look like "n. 苹果\nv. 苹果"
          for (const target of TARGET_WORDS) {
            if (transString.includes(target)) {
               addTranslation(word, 'zh', target, 'en');
            }
          }
        }
      })
      .on('end', resolve);
  });
}

async function parseJMdict() {
  const filePath = path.join(RAW_DIR, 'JMdict_e.gz');
  if (!fs.existsSync(filePath)) return;
  console.log("Parsing JMdict (JA <-> EN)...");
  
  // XML streaming is hard, we will do a fast line-by-line regex hack just for our target words to avoid OOM
  const fileStream = fs.createReadStream(filePath);
  const gunzip = zlib.createGunzip();
  const rl = readline.createInterface({ input: fileStream.pipe(gunzip), crlfDelay: Infinity });
  
  let currentKeb = null;
  let currentReb = null;
  
  for await (const line of rl) {
    if (line.includes('<keb>')) {
      currentKeb = line.match(/<keb>(.*?)<\/keb>/)?.[1];
    } else if (line.includes('<reb>')) {
      currentReb = line.match(/<reb>(.*?)<\/reb>/)?.[1];
    } else if (line.includes('<gloss>')) {
      const gloss = line.match(/<gloss>(.*?)<\/gloss>/)?.[1]?.toLowerCase();
      if (gloss && TARGET_WORDS.has(gloss)) {
        if (currentKeb && TARGET_WORDS.has(currentKeb)) {
          addTranslation(currentKeb, 'en', gloss, 'ja');
        }
        if (currentReb && TARGET_WORDS.has(currentReb)) {
          addTranslation(currentReb, 'en', gloss, 'ja');
        }
      }
    } else if (line.includes('</entry>')) {
      currentKeb = null;
      currentReb = null;
    }
  }
}

async function parseKaikkiChinese() {
  const filePath = path.join(RAW_DIR, 'kaikki_Chinese.jsonl');
  if (!fs.existsSync(filePath)) return;
  console.log("Parsing Kaikki Chinese (ZH <-> EN)...");
  
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  
  for await (const line of rl) {
    try {
      const entry = JSON.parse(line);
      const word = entry.word;
      if (!TARGET_WORDS.has(word)) continue;
      
      const senses = entry.senses || [];
      for (const sense of senses) {
        const glosses = sense.glosses || [];
        for (const gloss of glosses) {
          const mainWord = gloss.split(';')[0].toLowerCase().trim();
          if (TARGET_WORDS.has(mainWord)) {
             addTranslation(word, 'en', mainWord, 'zh');
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

  // Parse all 4 data sources
  await parseCCCedict();
  await parseECDICT();
  await parseJMdict();
  await parseKaikkiChinese();
  
  // Clean up empty arrays
  const cleanDb = {};
  for (const [key, val] of Object.entries(goldenDatabase)) {
    let hasTrans = false;
    for (const lang of ['zh', 'en', 'ja', 'pt']) {
      if (val.translations[lang].length > 0) hasTrans = true;
    }
    if (hasTrans) cleanDb[key] = val;
  }
  
  const outputPath = path.join(PROCESSED_DIR, 'fusion_v1_sample.json');
  fs.writeFileSync(outputPath, JSON.stringify(cleanDb, null, 2));
  
  console.log(`Fusion v1 complete! Merged translations for ${Object.keys(cleanDb).length} core words.`);
  console.log(`Saved to: ${outputPath}`);
}

main().catch(console.error);
