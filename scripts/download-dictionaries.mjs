import dns from 'node:dns';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';

const RAW_DIR = path.resolve('data/raw');
const MANIFEST_FILE = path.join(RAW_DIR, 'manifest.json');
const args = parseArgs(process.argv.slice(2));
const requestedSources = new Set(
  String(args.sources || '')
    .split(',')
    .map((source) => source.trim())
    .filter(Boolean)
);

dns.setDefaultResultOrder('ipv4first');
net.setDefaultAutoSelectFamily(false);

const sources = [
  {
    id: 'cc-cedict',
    name: 'CC-CEDICT',
    url: 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz',
    file: 'cc-cedict.txt',
    compressed: true,
    license: 'CC BY-SA 4.0',
    homepage: 'https://cc-cedict.org/wiki/'
  },
  {
    id: 'jmdict',
    name: 'JMdict English',
    url: 'http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz',
    file: 'jmdict_e.xml',
    compressed: true,
    license: 'CC BY-SA 4.0',
    homepage: 'https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project'
  },
  {
    id: 'freedict-eng-por',
    name: 'FreeDict English-Portuguese',
    url: 'https://raw.githubusercontent.com/freedict/fd-dictionaries/master/eng-por/eng-por.tei',
    file: 'freedict-eng-por.tei',
    compressed: false,
    license: 'FreeDict project license; verify dictionary metadata before redistribution',
    homepage: 'https://github.com/freedict/fd-dictionaries'
  },
  {
    id: 'freedict-por-eng',
    name: 'FreeDict Portuguese-English',
    url: 'https://raw.githubusercontent.com/freedict/fd-dictionaries/master/por-eng/por-eng.tei',
    file: 'freedict-por-eng.tei',
    compressed: false,
    license: 'FreeDict project license; verify dictionary metadata before redistribution',
    homepage: 'https://github.com/freedict/fd-dictionaries'
  },
  {
    id: 'kaikki-ja',
    name: 'Kaikki English Wiktionary Japanese entries',
    url: 'https://kaikki.org/dictionary/Japanese/kaikki.org-dictionary-Japanese.jsonl',
    file: 'kaikki_Japanese.jsonl',
    compressed: false,
    stream: true,
    license: 'CC BY-SA 4.0 and GFDL',
    homepage: 'https://kaikki.org/dictionary/Japanese/'
  },
  {
    id: 'kaikki-pt',
    name: 'Kaikki English Wiktionary Portuguese entries',
    url: 'https://kaikki.org/dictionary/Portuguese/kaikki.org-dictionary-Portuguese.jsonl',
    file: 'kaikki_Portuguese.jsonl',
    compressed: false,
    stream: true,
    license: 'CC BY-SA 4.0 and GFDL',
    homepage: 'https://kaikki.org/dictionary/Portuguese/'
  }
];

fs.mkdirSync(RAW_DIR, { recursive: true });

const previousManifest = readManifest(MANIFEST_FILE);
const manifest = {
  downloaded_at: new Date().toISOString(),
  sources: Array.isArray(previousManifest?.sources) ? previousManifest.sources : []
};

async function download(source) {
  const outPath = path.join(RAW_DIR, source.file);
  console.log(`[download] ${source.id} -> ${path.relative(process.cwd(), outPath)}`);

  const response = await fetchWithRetry(source.url, 4);
  if (!response.ok) {
    throw new Error(`${source.id} failed: HTTP ${response.status}`);
  }

  if (source.stream) {
    if (!response.body) throw new Error(`${source.id} failed: response body is empty`);
    const partPath = `${outPath}.part`;
    try {
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partPath));
      fs.renameSync(partPath, outPath);
    } catch (error) {
      fs.rmSync(partPath, { force: true });
      throw error;
    }
  } else {
    const bytes = Buffer.from(await response.arrayBuffer());
    const content = source.compressed ? zlib.gunzipSync(bytes) : bytes;
    fs.writeFileSync(outPath, content);
  }

  const stat = fs.statSync(outPath);
  manifest.sources = manifest.sources.filter((item) => item.id !== source.id);
  manifest.sources.push({
    id: source.id,
    name: source.name,
    url: source.url,
    file: source.file,
    bytes: stat.size,
    license: source.license,
    homepage: source.homepage
  });
}

for (const source of sources) {
  if (requestedSources.size && !requestedSources.has(source.id)) continue;
  await download(source);
}

fs.writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[done] wrote ${path.relative(process.cwd(), MANIFEST_FILE)}`);

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      result[key] = 'true';
    } else {
      result[key] = next;
      i++;
    }
  }
  return result;
}

function readManifest(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

async function fetchWithRetry(url, maxAttempts) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetch(url);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      const delayMs = 1000 * 2 ** (attempt - 1);
      console.warn(`[retry] fetch attempt ${attempt}/${maxAttempts} failed; retrying in ${delayMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
