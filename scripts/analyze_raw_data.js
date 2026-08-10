import fs from 'fs';
import zlib from 'zlib';
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAW_DIR = path.join(__dirname, '../data/raw');

async function analyzeKaikki() {
  console.log('=== KAIKKI CHINESE (JSONL) ===');
  const filePath = path.join(RAW_DIR, 'kaikki_Chinese.jsonl');
  if (!fs.existsSync(filePath)) return;

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let count = 0;
  for await (const line of rl) {
    if (count > 2) break;
    const entry = JSON.parse(line);
    // Print a truncated version to avoid huge terminal output
    console.log(JSON.stringify(entry, null, 2).substring(0, 500) + '...\n');
    count++;
  }
  rl.close();
}

async function analyzeCCCedict() {
  console.log('=== CC-CEDICT (TXT.GZ) ===');
  const filePath = path.join(RAW_DIR, 'CC-CEDICT.txt.gz');
  if (!fs.existsSync(filePath)) return;

  const fileStream = fs.createReadStream(filePath);
  const gunzip = zlib.createGunzip();
  const rl = readline.createInterface({ input: fileStream.pipe(gunzip), crlfDelay: Infinity });

  let count = 0;
  for await (const line of rl) {
    if (line.startsWith('#')) continue; // skip comments
    if (count > 5) break;
    console.log(line);
    count++;
  }
  rl.close();
}

async function main() {
  await analyzeKaikki();
  await analyzeCCCedict();
}

main().catch(console.error);
