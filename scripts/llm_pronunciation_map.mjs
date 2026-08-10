import Database from 'better-sqlite3';
import fs from 'fs';

// ─── Config: Round-robin across all available qwen3.6 nodes ───
const OLLAMA_NODES = [
  { host: 'http://100.99.99.99:11435', model: 'qwen3.6:latest' },
  { host: 'http://100.99.99.99:11436', model: 'qwen3.6:latest' },
  { host: 'http://100.99.99.99:11437', model: 'qwen3.6:latest' },
  { host: 'http://100.99.99.99:11438', model: 'qwen3.6:35b-a3b' }
];
const CONCURRENCY = 20; // 5 per node
const DB_PATH = 'data/processed/linguago_d1_ready.db';
const MULTI_PRON_PATH = 'data/processed/multi_pron_entries.json';

const db = new Database(DB_PATH);
const entries = JSON.parse(fs.readFileSync(MULTI_PRON_PATH, 'utf8'));
const updateStmt = db.prepare('UPDATE senses SET pronunciation = ? WHERE entry_id = ? AND sense_order = ?');

console.log(`Loaded ${entries.length} multi-pronunciation entries.`);
console.log(`Using ${OLLAMA_NODES.length} Ollama nodes, concurrency=${CONCURRENCY}`);

let nodeIdx = 0;
function getNode() {
  const node = OLLAMA_NODES[nodeIdx % OLLAMA_NODES.length];
  nodeIdx++;
  return node;
}

// ─── Ollama call ───
async function callOllama(entry) {
  const { word, sounds, senses } = entry;
  const node = getNode();

  const sensesText = senses.map((s) => `${s.sense_order}. ${s.gloss}`).join('\n');

  const prompt = `你是一名语言学家。以下是汉字"${word}"的多个读音和多个义项。请为每个义项分配最正确的读音。

可选读音: ${JSON.stringify(sounds)}

义项列表:
${sensesText}

严格以JSON数组返回，每项含sense_order和pronunciation。只返回JSON。
示例: [{"sense_order":1,"pronunciation":"zhá"}]`;

  try {
    const response = await fetch(`${node.host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: node.model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: { temperature: 0.1, num_predict: 2048 }
      }),
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const content = data.message?.content || '';

    // Extract JSON array
    const jsonMatch = content.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) throw new Error('No JSON found');

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    return null; // Will use fallback
  }
}

// ─── Process ───
async function processEntry(entry) {
  const result = await callOllama(entry);
  const sounds = entry.sounds;
  const defaultPron = sounds[0];

  if (result && Array.isArray(result)) {
    const validSounds = new Set(sounds.map((s) => s.toLowerCase()));
    const assigned = new Set();

    for (const item of result) {
      const so = item.sense_order;
      let pron = item.pronunciation;
      if (!entry.senses.find((s) => s.sense_order === so)) continue;
      if (pron && !validSounds.has(pron.toLowerCase())) pron = defaultPron;
      updateStmt.run(pron || defaultPron, entry.entryId, so);
      assigned.add(so);
    }

    // Fill any missing senses
    for (const sense of entry.senses) {
      if (!assigned.has(sense.sense_order)) {
        updateStmt.run(defaultPron, entry.entryId, sense.sense_order);
      }
    }
    return true;
  } else {
    // Fallback: first sound for all
    for (const sense of entry.senses) {
      updateStmt.run(defaultPron, entry.entryId, sense.sense_order);
    }
    return false;
  }
}

async function main() {
  let okCount = 0,
    failCount = 0;

  db.exec('BEGIN TRANSACTION');

  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(processEntry));
    results.forEach((ok) => (ok ? okCount++ : failCount++));

    const done = Math.min(i + CONCURRENCY, entries.length);
    if (done % 200 === 0 || done === entries.length) {
      console.log(`  ${done}/${entries.length} (LLM: ${okCount}, fallback: ${failCount})`);
    }
  }

  db.exec('COMMIT');
  db.close();

  console.log(`\n=== Done ===`);
  console.log(`LLM mapped: ${okCount}, Fallback: ${failCount}`);
}

main().catch(console.error);
