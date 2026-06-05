import fs from 'fs';
import zlib from 'zlib';
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAW_DIR = path.join(__dirname, '../data/raw');
const PROCESSED_DIR = path.join(__dirname, '../data/processed');

const goldenDatabase = {};

async function parseCCCedict() {
  const filePath = path.join(RAW_DIR, 'CC-CEDICT.txt.gz');
  if (!fs.existsSync(filePath)) return;
  
  const fileStream = fs.createReadStream(filePath);
  const gunzip = zlib.createGunzip();
  const rl = readline.createInterface({ input: fileStream.pipe(gunzip), crlfDelay: Infinity });
  
  console.log("Parsing CC-CEDICT...");
  let count = 0;
  for await (const line of rl) {
    if (line.startsWith('#')) continue;
    
    // Format: Traditional Simplified [pin1 yin1] /def 1/def 2/
    const match = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\//);
    if (match) {
      const simplified = match[2];
      const pinyin = match[3];
      const glosses = match[4].split('/');
      
      goldenDatabase[simplified] = {
        word: simplified,
        translations: {
          zh: {
            sounds: [{ type: "pinyin", value: pinyin }],
            senses: [
              { pos: "unknown", glosses: glosses, examples: [] }
            ]
          },
          en: { senses: [] },
          ja: null,
          "pt-BR": null
        }
      };
      count++;
    }
    if (count >= 1000) break; // Limit to 1000 for the sample
  }
}

async function parseKaikkiChinese() {
  const filePath = path.join(RAW_DIR, 'kaikki_Chinese.jsonl');
  if (!fs.existsSync(filePath)) return;
  
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  
  console.log("Parsing Kaikki Chinese & Merging...");
  let count = 0;
  for await (const line of rl) {
    try {
      const entry = JSON.parse(line);
      const word = entry.word;
      if (!word) continue;
      
      const pos = entry.pos || "unknown";
      const senses = entry.senses || [];
      const sounds = entry.sounds || [];
      
      let pinyin = null;
      for (const s of sounds) {
        if (s.tags && s.tags.includes("Pinyin") && s.zh_pron) {
          pinyin = s.zh_pron;
          break;
        }
      }
      
      const parsedSenses = senses.map(s => {
        return {
          pos: pos,
          glosses: s.glosses || [],
          examples: (s.examples || []).map(e => ({
            text: e.text,
            translation: e.english
          }))
        };
      });
      
      if (goldenDatabase[word]) {
        // Merge into existing CC-CEDICT entry
        // Override with Kaikki's superior senses and sounds
        if (pinyin) goldenDatabase[word].translations.zh.sounds = [{ type: "pinyin", value: pinyin }];
        // Append senses rather than overriding to keep CC-CEDICT fallback if needed, or just override
        goldenDatabase[word].translations.zh.senses = parsedSenses;
      } else if (count < 1000) {
        // Create new entry
        goldenDatabase[word] = {
          word: word,
          translations: {
            zh: {
              sounds: pinyin ? [{ type: "pinyin", value: pinyin }] : [],
              senses: parsedSenses
            },
            en: { senses: [] },
            ja: null,
            "pt-BR": null
          }
        };
        count++;
      }
    } catch (e) {
      // Ignore parse errors
    }
  }
}

async function main() {
  if (!fs.existsSync(PROCESSED_DIR)) {
    fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  }

  await parseCCCedict();
  await parseKaikkiChinese();
  
  const outputPath = path.join(PROCESSED_DIR, 'fusion_sample.json');
  fs.writeFileSync(outputPath, JSON.stringify(goldenDatabase, null, 2));
  
  console.log(`Fusion complete! Extracted ${Object.keys(goldenDatabase).length} words.`);
  console.log(`Saved to: ${outputPath}`);
}

main().catch(console.error);
