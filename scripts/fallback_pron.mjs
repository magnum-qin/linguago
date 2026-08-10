import Database from 'better-sqlite3';
import fs from 'fs';

const DB_PATH = 'data/processed/linguago_d1_ready.db';
const MULTI_PRON_PATH = 'data/processed/multi_pron_entries.json';

const db = new Database(DB_PATH);
const entries = JSON.parse(fs.readFileSync(MULTI_PRON_PATH, 'utf8'));
const updateStmt = db.prepare('UPDATE senses SET pronunciation = ? WHERE entry_id = ? AND sense_order = ?');

console.log(`Processing ${entries.length} multi-pronunciation entries...`);

db.exec('BEGIN TRANSACTION');

for (const entry of entries) {
  const sounds = entry.sounds;
  const defaultPron = sounds[0];

  for (const sense of entry.senses) {
    let bestPron = defaultPron;

    // Try to extract pinyin hint from gloss like [zha4] or pr. [zhang3]
    const gloss = sense.gloss || '';
    const hintMatch = gloss.match(/\[([a-zA-Z]+\d)\]/);
    if (hintMatch) {
      const hint = hintMatch[1].toLowerCase();
      const match = sounds.find((s) => s.toLowerCase() === hint);
      if (match) bestPron = match;
    }

    updateStmt.run(bestPron, entry.entryId, sense.sense_order);
  }
}

db.exec('COMMIT');
db.close();

console.log(`Done! All ${entries.length} multi-pronunciation entries processed.`);
