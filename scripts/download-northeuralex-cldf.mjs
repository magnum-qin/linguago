#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const args = parseArgs(process.argv.slice(2));
const outDir = path.resolve(args['out-dir'] || 'data/raw/northeuralex-cldf');
const revision = String(args.revision || 'master');
const baseUrl = `https://raw.githubusercontent.com/lexibank/northeuralex/${revision}/cldf`;
const files = ['languages.csv', 'parameters.csv', 'forms.csv', 'cldf-metadata.json'];
const timeoutMs = Number(args['timeout-ms'] || 300_000);

fs.mkdirSync(outDir, { recursive: true });
const manifest = {
  source: 'NorthEuraLex CLDF',
  source_family: 'northeuralex',
  repository: 'https://github.com/lexibank/northeuralex',
  revision,
  license: 'CC-BY-4.0',
  downloaded_at: new Date().toISOString(),
  files: []
};

for (const file of files) {
  const url = `${baseUrl}/${file}`;
  const response = await fetchWithTimeout(url);
  if (!response.ok || !response.body) throw new Error(`${file} download failed: HTTP ${response.status}`);
  const partial = path.join(outDir, `${file}.part`);
  const output = path.join(outDir, file);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partial));
  fs.renameSync(partial, output);
  manifest.files.push({ file, url, bytes: fs.statSync(output).size });
}

fs.writeFileSync(path.join(outDir, 'linguago-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out_dir: path.relative(process.cwd(), outDir), files: manifest.files }, null, 2));

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'LinguaGo-dictionary-source-import/1.0' }
    });
  } finally {
    clearTimeout(timer);
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith('--') ? argv[++index] : true;
  }
  return parsed;
}
