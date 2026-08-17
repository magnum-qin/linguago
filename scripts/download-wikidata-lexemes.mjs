#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const args = parseArgs(process.argv.slice(2));
const url = String(
  args.url || 'https://dumps.wikimedia.org/wikidatawiki/entities/latest-lexemes.json.gz'
);
const outPath = path.resolve(args.out || 'data/raw/wikidata-latest-lexemes.json.gz');
const metadataPath = path.resolve(args.metadata || `${outPath}.metadata.json`);
const partialPath = `${outPath}.part`;
const resume = args.resume !== 'false';
const timeoutMs = boundedInteger(args['timeout-ms'], 3_600_000, 1_000);
const userAgent = 'LinguaGo-dictionary-source-import/1.0 (Wikidata Lexeme CC0)';

fs.mkdirSync(path.dirname(outPath), { recursive: true });

const head = await fetchWithTimeout(url, { method: 'HEAD', headers: { 'user-agent': userAgent } });
if (!head.ok) throw new Error(`Wikidata Lexeme HEAD failed: HTTP ${head.status}`);
const expectedBytes = Number(head.headers.get('content-length')) || null;
const remoteModified = head.headers.get('last-modified');
const remoteEtag = head.headers.get('etag');

if (fs.existsSync(outPath) && (!expectedBytes || fs.statSync(outPath).size === expectedBytes)) {
  writeMetadata({ status: 'already_complete', bytes: fs.statSync(outPath).size });
  console.log(JSON.stringify({ ok: true, skipped: true, out: relative(outPath), bytes: fs.statSync(outPath).size }, null, 2));
  process.exit(0);
}

let offset = resume && fs.existsSync(partialPath) ? fs.statSync(partialPath).size : 0;
if (expectedBytes && offset > expectedBytes) {
  fs.rmSync(partialPath, { force: true });
  offset = 0;
}

const headers = { 'user-agent': userAgent };
if (offset > 0) headers.range = `bytes=${offset}-`;
const response = await fetchWithTimeout(url, { headers });
if (!response.ok) throw new Error(`Wikidata Lexeme download failed: HTTP ${response.status}`);
if (!response.body) throw new Error('Wikidata Lexeme download returned no body');

const contentRange = parseContentRange(response.headers.get('content-range'));
const append =
  offset > 0 &&
  response.status === 206 &&
  contentRange?.start === offset &&
  (!expectedBytes || contentRange.total === expectedBytes);
if (offset > 0 && response.status === 206 && !append) {
  response.body.cancel();
  throw new Error(
    `Unsafe resume response: requested=${offset}, content-range=${response.headers.get('content-range') || 'missing'}`
  );
}
if (offset > 0 && !append) offset = 0;
await pipeline(
  Readable.fromWeb(response.body),
  fs.createWriteStream(partialPath, { flags: append ? 'a' : 'w' })
);

const downloadedBytes = fs.statSync(partialPath).size;
if (expectedBytes && downloadedBytes !== expectedBytes) {
  writeMetadata({ status: 'partial', bytes: downloadedBytes });
  throw new Error(`Incomplete Wikidata Lexeme dump: ${downloadedBytes}/${expectedBytes} bytes`);
}
fs.renameSync(partialPath, outPath);
writeMetadata({ status: 'complete', bytes: downloadedBytes });
console.log(JSON.stringify({ ok: true, out: relative(outPath), bytes: downloadedBytes, expected_bytes: expectedBytes }, null, 2));

async function fetchWithTimeout(target, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(target, { ...options, signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

function writeMetadata(extra) {
  fs.writeFileSync(
    metadataPath,
    `${JSON.stringify({
      source: 'Wikidata Lexeme JSON dump',
      source_family: 'wikidata-lexeme',
      license: 'CC0-1.0',
      url,
      retrieved_at: new Date().toISOString(),
      remote_last_modified: remoteModified,
      remote_etag: remoteEtag,
      expected_bytes: expectedBytes,
      ...extra
    }, null, 2)}\n`,
    'utf8'
  );
}

function boundedInteger(value, fallback, minimum) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < minimum) throw new Error(`Invalid integer: ${value}`);
  return number;
}
function parseContentRange(value) {
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/iu.exec(String(value || '').trim());
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === '*' ? null : Number(match[3])
  };
}
function relative(filePath) {
  return path.relative(process.cwd(), filePath);
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
