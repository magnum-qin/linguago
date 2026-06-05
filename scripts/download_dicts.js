import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAW_DIR = path.join(__dirname, '../data/raw');

const FILES = [
  {
    name: 'CC-CEDICT.txt.gz',
    url: 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz',
  },
  {
    name: 'JMdict_e.gz',
    url: 'http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz',
  },
  {
    name: 'kaikki_Chinese.jsonl',
    url: 'https://kaikki.org/dictionary/Chinese/kaikki.org-dictionary-Chinese.jsonl',
  },
  {
    name: 'ecdict.csv',
    url: 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv',
  }
];

async function downloadFile(file) {
  const destPath = path.join(RAW_DIR, file.name);
  if (fs.existsSync(destPath)) {
    console.log(`[SKIPPED] ${file.name} already exists.`);
    return;
  }

  console.log(`[DOWNLOADING] ${file.name} from ${file.url}...`);
  try {
    const response = await fetch(file.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${file.url}: ${response.statusText}`);
    }
    const fileStream = fs.createWriteStream(destPath);
    await pipeline(response.body, fileStream);
    console.log(`[SUCCESS] ${file.name} downloaded successfully!`);
  } catch (err) {
    console.error(`[ERROR] Failed to download ${file.name}:`, err.message);
  }
}

async function main() {
  if (!fs.existsSync(RAW_DIR)) {
    fs.mkdirSync(RAW_DIR, { recursive: true });
  }

  for (const file of FILES) {
    await downloadFile(file);
  }
  console.log("All downloads finished!");
}

main();
