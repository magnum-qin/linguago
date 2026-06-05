import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, '../data/processed/fusion_ultimate_sample.json');

const ENDPOINTS = [
  'http://100.99.99.99:11435/api/chat',
  'http://100.99.99.99:11436/api/chat',
  'http://100.99.99.99:11437/api/chat'
];
let endpointIndex = 0;

const JSON_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      word: { type: "string" },
      pos: { type: "string" },
      gloss: { type: "string" },
      examples: { 
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            translation: { type: "string" }
          },
          required: ["text", "translation"]
        }
      }
    },
    required: ["word", "pos", "gloss", "examples"]
  }
};

async function getTranslation(wordInfo, targetLangName) {
  const endpoint = ENDPOINTS[endpointIndex];
  endpointIndex = (endpointIndex + 1) % ENDPOINTS.length;

  const prompt = `You are an expert bilingual lexicographer.
We have the following dictionary entry:
Word: "${wordInfo.word}"
Context (English translations/senses): ${JSON.stringify(wordInfo.translations.en || [])}
Context (Chinese translations/senses): ${JSON.stringify(wordInfo.translations.zh || [])}

Please translate this word into ${targetLangName}.
Return a JSON array of senses. For each sense, provide the translated word, part of speech (pos), a gloss (explanation), and 0 or more examples.`;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3.6:latest',
        messages: [{ role: 'system', content: 'You are a JSON assistant. Output valid JSON array.'}, { role: 'user', content: prompt }],
        format: JSON_SCHEMA,
        stream: false,
        options: { temperature: 0.1 }
      }),
      signal: AbortSignal.timeout(30000)
    });
    
    if (res.ok) {
      const data = await res.json();
      return JSON.parse(data.message.content);
    } else {
      console.error(`Error from ${endpoint}: ${res.status}`);
      return null;
    }
  } catch(e) {
    console.error(`Failed to reach ${endpoint}:`, e.message);
    return null;
  }
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error("DB not found!");
    return;
  }
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  
  const entries = Object.values(db);
  console.log(`Starting augmentation for ${entries.length} entries...`);
  
  // We process in batches of 3 to utilize all 3 servers concurrently
  for (let i = 0; i < entries.length; i += 3) {
    const batch = entries.slice(i, i + 3);
    const promises = batch.map(async (entry) => {
      let updated = false;
      
      // Need Japanese?
      if (!entry.translations.ja || entry.translations.ja.length === 0) {
        console.log(`[JA] Augmenting: ${entry.word}`);
        const jaResult = await getTranslation(entry, 'Japanese');
        if (jaResult && Array.isArray(jaResult)) {
          entry.translations.ja = jaResult;
          updated = true;
        }
      }
      
      // Need Portuguese?
      if (!entry.translations.pt || entry.translations.pt.length === 0) {
        console.log(`[PT] Augmenting: ${entry.word}`);
        const ptResult = await getTranslation(entry, 'Portuguese');
        if (ptResult && Array.isArray(ptResult)) {
          entry.translations.pt = ptResult;
          updated = true;
        }
      }
      return updated;
    });
    
    const results = await Promise.all(promises);
    if (results.some(r => r)) {
      // Save progressively
      fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
      console.log(`Progress saved at index ${Math.min(i + 3, entries.length)}`);
    }
  }
  
  console.log("Augmentation Complete!");
}

main().catch(console.error);
