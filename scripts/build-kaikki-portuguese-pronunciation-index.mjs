import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const DEFAULT_URL = 'https://kaikki.org/dictionary/Portuguese/kaikki.org-dictionary-Portuguese.jsonl';
const DEFAULT_INPUT = 'data/raw/kaikki_Portuguese.jsonl';
const DEFAULT_OUTPUT = 'data/processed/kaikki_portuguese_pronunciations.db';

const args = parseArgs(process.argv.slice(2));
const inputPath = path.resolve(args.input || DEFAULT_INPUT);
const outputPath = path.resolve(args.out || DEFAULT_OUTPUT);
const sourceUrl = args.url || DEFAULT_URL;
const download = args.download === 'true';
const forceDownload = args['force-download'] === 'true';
const limit = Number(args.limit || 0);

if (!Number.isInteger(limit) || limit < 0) throw new Error(`Invalid --limit: ${args.limit}`);

if (download && (forceDownload || !fs.existsSync(inputPath))) {
  await downloadFile(sourceUrl, inputPath);
}
if (!fs.existsSync(inputPath)) {
  throw new Error(`Kaikki Portuguese JSONL not found: ${inputPath}. Run with --download true.`);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.rmSync(outputPath, { force: true });
const db = new Database(outputPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.exec(`
  CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE portuguese_pronunciations (
    normalized_key TEXT NOT NULL,
    word TEXT NOT NULL,
    ipa TEXT NOT NULL,
    region TEXT NOT NULL,
    priority INTEGER NOT NULL,
    source_entry_id TEXT,
    PRIMARY KEY (normalized_key, ipa, region)
  );
  CREATE INDEX idx_portuguese_pronunciations_lookup
    ON portuguese_pronunciations (normalized_key, priority, ipa);
`);

const insert = db.prepare(`
  INSERT INTO portuguese_pronunciations
    (normalized_key, word, ipa, region, priority, source_entry_id)
  VALUES
    (@normalized_key, @word, @ipa, @region, @priority, @source_entry_id)
  ON CONFLICT(normalized_key, ipa, region) DO UPDATE SET
    priority = MIN(priority, excluded.priority),
    source_entry_id = COALESCE(source_entry_id, excluded.source_entry_id)
`);
const insertBatch = db.transaction((rows) => rows.forEach((row) => insert.run(row)));

let lines = 0;
let parsedEntries = 0;
let malformedLines = 0;
let entriesWithBrazilianIpa = 0;
let pronunciationRows = 0;
let batch = [];
const stream = fs.createReadStream(inputPath, { encoding: 'utf8' });
const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

for await (const line of rl) {
  lines++;
  if (limit && parsedEntries >= limit) break;
  if (!line.trim()) continue;
  let item;
  try {
    item = JSON.parse(line);
  } catch {
    malformedLines++;
    continue;
  }
  parsedEntries++;
  const word = String(item.word || '').normalize('NFC').trim();
  if (!word) continue;
  const sounds = Array.isArray(item.sounds) ? item.sounds : [];
  const rows = sounds
    .map((sound) => normalizeBrazilianSound(word, item.id, sound))
    .filter(Boolean);
  if (!rows.length) continue;
  entriesWithBrazilianIpa++;
  batch.push(...rows);
  pronunciationRows += rows.length;
  if (batch.length >= 5000) {
    insertBatch(batch);
    batch = [];
  }
}
if (batch.length) insertBatch(batch);

const metadata = {
  source_url: sourceUrl,
  source_file: path.relative(process.cwd(), inputPath),
  generated_at: new Date().toISOString(),
  selection_policy: 'Explicit Brazilian-region IPA only; generic Brazil before named Brazilian regions.',
  parsed_entries: parsedEntries,
  entries_with_brazilian_ipa: entriesWithBrazilianIpa,
  pronunciation_rows_seen: pronunciationRows
};
const insertMetadata = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(metadata)) insertMetadata.run(key, String(value));
const indexedRows = db.prepare('SELECT COUNT(*) AS count FROM portuguese_pronunciations').get().count;
const indexedTerms = db.prepare('SELECT COUNT(DISTINCT normalized_key) AS count FROM portuguese_pronunciations').get().count;
db.pragma('wal_checkpoint(TRUNCATE)');
db.close();

console.log(
  JSON.stringify(
    {
      ok: true,
      input: path.relative(process.cwd(), inputPath),
      out: path.relative(process.cwd(), outputPath),
      lines,
      parsed_entries: parsedEntries,
      malformed_lines: malformedLines,
      entries_with_brazilian_ipa: entriesWithBrazilianIpa,
      indexed_terms: indexedTerms,
      indexed_rows: indexedRows
    },
    null,
    2
  )
);

function normalizeBrazilianSound(word, sourceEntryId, sound) {
  const ipa = String(sound?.ipa || '').normalize('NFC').trim();
  if (!ipa || ipa.length > 100 || !/^[\/\[]/u.test(ipa) || !/[\p{Letter}]/u.test(ipa)) return null;
  const tags = Array.isArray(sound.tags) ? sound.tags.map((tag) => String(tag).trim()).filter(Boolean) : [];
  const region = preferredBrazilianRegion(tags);
  if (!region) return null;
  return {
    normalized_key: normalizeKey(word),
    word,
    ipa,
    region: region.name,
    priority: region.priority + (ipa.startsWith('[') ? 10 : 0),
    source_entry_id: sourceEntryId ? String(sourceEntryId) : null
  };
}

function preferredBrazilianRegion(tags) {
  const priorities = [
    ['Brazil', 0],
    ['Sao-Paulo', 1],
    ['São-Paulo', 1],
    ['Rio-de-Janeiro', 2],
    ['Caipira', 3],
    ['Southern-Brazil', 4]
  ];
  for (const [name, priority] of priorities) {
    if (tags.includes(name)) return { name, priority };
  }
  const tagged = tags.find((tag) => /brazil/iu.test(tag));
  return tagged ? { name: tagged, priority: 5 } : null;
}

function normalizeKey(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('pt-BR');
}

async function downloadFile(url, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const partial = `${destination}.part`;
  fs.rmSync(partial, { force: true });
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status} ${url}`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partial));
  fs.rmSync(destination, { force: true });
  fs.renameSync(partial, destination);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) result[key] = 'true';
    else {
      result[key] = next;
      index++;
    }
  }
  return result;
}
