import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const basePath = requiredPath(args.base, 'base');
const correctionPath = requiredPath(args.correction, 'correction');
const replayPath = requiredPath(args.replay, 'replay');
const baseReplayPath = args['base-replay'] ? requiredPath(args['base-replay'], 'base-replay') : null;
const skipMissingReplay = args['skip-missing-replay'] === 'true';
const outPath = path.resolve(required(args.out, 'out'));
const base = readJson(basePath);
const correction = readJson(correctionPath);
const replay = readJson(replayPath);
const baseReplay = baseReplayPath ? readJson(baseReplayPath) : null;

const replayBySource = new Map(
  (replay.writes || []).map((row) => [candidateKey(row), row])
);
const baseReplayBySource = new Map(
  (baseReplay?.writes || []).map((row) => [candidateKey(row), row])
);
const items = {};
const skipped = [];

for (const row of base.generated || []) {
  const write = baseReplayBySource.get(candidateKey(row));
  if (baseReplay && !write) {
    if (!skipMissingReplay) throw new Error(`Missing base replay write for ${candidateKey(row)}`);
    skipped.push({ lane: 'base_consensus', candidate: candidateKey(row) });
    continue;
  }
  addItem(
    row,
    Number(write?.product_entry_id ?? row.product_entry_id),
    Number(write?.product_sense_id ?? row.product_sense_id),
    'base_consensus'
  );
}
for (const row of correction.generated || []) {
  const write = replayBySource.get(candidateKey(row));
  if (!write) {
    if (!skipMissingReplay) throw new Error(`Missing correction replay write for ${candidateKey(row)}`);
    skipped.push({ lane: 'correction_consensus', candidate: candidateKey(row) });
    continue;
  }
  addItem(row, Number(write.product_entry_id), Number(write.product_sense_id), 'correction_consensus');
}

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  sources: {
    base: relative(basePath),
    base_replay: baseReplayPath ? relative(baseReplayPath) : null,
    correction: relative(correctionPath),
    replay: relative(replayPath)
  },
  summary: {
    base: (base.generated || []).length,
    correction: (correction.generated || []).length,
    total: Object.keys(items).length,
    unique_product_senses: new Set(Object.values(items).map((row) => row.product_sense_id)).size,
    skipped_missing_replay: skipped.length
  },
  items,
  skipped
};

if (output.summary.total !== output.summary.unique_product_senses) {
  throw new Error('Controlled promotion checkpoint contains duplicate product_sense_id values');
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary: output.summary }, null, 2));

function addItem(row, productEntryId, productSenseId, lane) {
  const key = candidateKey(row);
  if (!key) throw new Error('Controlled row is missing source IDs');
  if (!Number.isInteger(productEntryId) || !Number.isInteger(productSenseId)) {
    throw new Error(`Controlled row ${key} is missing product IDs`);
  }
  if (items[`${lane}:${key}`]) throw new Error(`Duplicate controlled row ${lane}:${key}`);
  items[`${lane}:${key}`] = {
    status: 'accepted',
    source_entry_id: Number(row.source_entry_id),
    source_sense_id: Number(row.output?.source_sense_id ?? row.source_sense_id),
    product_entry_id: productEntryId,
    product_sense_id: productSenseId,
    lane
  };
}

function candidateKey(row) {
  const entryId = Number(row?.source_entry_id);
  const senseId = Number(row?.output?.source_sense_id ?? row?.source_sense_id);
  return Number.isInteger(entryId) && Number.isInteger(senseId) ? `${entryId}:${senseId}` : null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function required(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return String(value);
}

function requiredPath(value, name) {
  const result = path.resolve(required(value, name));
  if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`);
  return result;
}

function relative(filePath) {
  return path.relative(process.cwd(), filePath);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) parsed[key] = argv[++index];
    else parsed[key] = 'true';
  }
  return parsed;
}
