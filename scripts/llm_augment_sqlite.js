import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, '../data/processed/linguago.db');

// We use the two IDLE nodes detected by nvidia-smi
const ENDPOINTS = [
  'http://192.168.2.143:11434/api/chat',
  'http://172.23.4.48:11434/api/chat'
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

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const updateStmt = db.prepare('UPDATE dictionary SET data = ? WHERE word = ?');

// We filter for common words by ensuring there is an English translation, 
// and that Japanese or Portuguese is missing.
const queryStmt = db.prepare(`
  SELECT word, data FROM dictionary 
  WHERE json_array_length(json_extract(data, '$.translations.en')) > 0
  AND (
    json_array_length(json_extract(data, '$.translations.ja')) = 0 OR 
    json_array_length(json_extract(data, '$.translations.pt')) = 0
  )
  LIMIT 50
`);

async function getTranslation(wordInfo, targetLangName) {
  const endpoint = ENDPOINTS[endpointIndex];
  endpointIndex = (endpointIndex + 1) % ENDPOINTS.length;

  let prompt = `You are an expert bilingual lexicographer.
We have the following dictionary entry:
Word: "${wordInfo.word}"
Context (English translations/senses): ${JSON.stringify(wordInfo.translations.en || [])}
Context (Chinese translations/senses): ${JSON.stringify(wordInfo.translations.zh || [])}

Please translate this word into ${targetLangName}.
Return a JSON array of senses. For each sense, provide the translated word, part of speech (pos), a gloss (explanation), and 0 or more examples.`;

  if (targetLangName === 'Japanese') {
    prompt += `\nIMPORTANT: For any Japanese text you output (including translated word, gloss, and examples), you MUST attach phonetic readings (Furigana) to all Kanji characters using the format Kanji[hiragana]. Examples: 漢字[かんじ], 私[わたし], 日本語[にほんご]. Do not use HTML <ruby> tags, strictly use Kanji[hiragana] format!`;
  }

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
      signal: AbortSignal.timeout(60000) // 60s timeout for large generation
    });
    
    if (res.ok) {
      const data = await res.json();
      return JSON.parse(data.message.content);
    }
  } catch(e) {
    console.error(`Error on ${endpoint}: ${e.message}`);
  }
  return null;
}

async function processBatch() {
  const rows = queryStmt.all();
  if (rows.length === 0) {
    console.log("No more words to process. Worker finished!");
    return false;
  }
  
  console.log(`Processing batch of ${rows.length} words...`);
  const promises = rows.map(async (row) => {
    let data;
    try {
      data = JSON.parse(row.data);
    } catch(e) { return; }
    
    let updated = false;
    
    // Japanese
    if (!data.translations.ja || data.translations.ja.length === 0) {
      const res = await getTranslation(data, 'Japanese');
      if (res && Array.isArray(res)) {
        data.translations.ja = res;
        updated = true;
      }
    }
    
    // Portuguese
    if (!data.translations.pt || data.translations.pt.length === 0) {
      const res = await getTranslation(data, 'Portuguese');
      if (res && Array.isArray(res)) {
        data.translations.pt = res;
        updated = true;
      }
    }
    
    if (updated) {
      updateStmt.run(JSON.stringify(data), row.word);
      console.log(`[OK] Augmented: ${row.word}`);
    }
  });
  
  await Promise.all(promises);
  return true;
}

async function main() {
  console.log("Starting SQLite Distributed LLM Worker...");
  console.log(`Loaded endpoints: ${ENDPOINTS.join(', ')}`);
  
  let keepGoing = true;
  while(keepGoing) {
    keepGoing = await processBatch();
  }
}

main().catch(console.error);
