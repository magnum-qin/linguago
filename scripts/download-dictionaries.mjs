import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const RAW_DIR = path.resolve("data/raw");
const MANIFEST_FILE = path.join(RAW_DIR, "manifest.json");
const args = parseArgs(process.argv.slice(2));
const requestedSources = new Set(
  String(args.sources || "")
    .split(",")
    .map((source) => source.trim())
    .filter(Boolean)
);

const sources = [
  {
    id: "cc-cedict",
    name: "CC-CEDICT",
    url: "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz",
    file: "cc-cedict.txt",
    compressed: true,
    license: "CC BY-SA 4.0",
    homepage: "https://cc-cedict.org/wiki/"
  },
  {
    id: "jmdict",
    name: "JMdict English",
    url: "http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz",
    file: "jmdict_e.xml",
    compressed: true,
    license: "CC BY-SA 4.0",
    homepage: "https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project"
  },
  {
    id: "freedict-eng-por",
    name: "FreeDict English-Portuguese",
    url: "https://raw.githubusercontent.com/freedict/fd-dictionaries/master/eng-por/eng-por.tei",
    file: "freedict-eng-por.tei",
    compressed: false,
    license: "FreeDict project license; verify dictionary metadata before redistribution",
    homepage: "https://github.com/freedict/fd-dictionaries"
  },
  {
    id: "freedict-por-eng",
    name: "FreeDict Portuguese-English",
    url: "https://raw.githubusercontent.com/freedict/fd-dictionaries/master/por-eng/por-eng.tei",
    file: "freedict-por-eng.tei",
    compressed: false,
    license: "FreeDict project license; verify dictionary metadata before redistribution",
    homepage: "https://github.com/freedict/fd-dictionaries"
  }
];

fs.mkdirSync(RAW_DIR, { recursive: true });

const manifest = {
  downloaded_at: new Date().toISOString(),
  sources: []
};

async function download(source) {
  const outPath = path.join(RAW_DIR, source.file);
  console.log(`[download] ${source.id} -> ${path.relative(process.cwd(), outPath)}`);

  const response = await fetch(source.url);
  if (!response.ok) {
    throw new Error(`${source.id} failed: HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const content = source.compressed ? zlib.gunzipSync(bytes) : bytes;
  fs.writeFileSync(outPath, content);

  const stat = fs.statSync(outPath);
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
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      result[key] = "true";
    } else {
      result[key] = next;
      i++;
    }
  }
  return result;
}
