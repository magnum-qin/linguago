import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const triagePath = requiredPath(args.triage, 'triage');
const checkpointPath = requiredPath(args.checkpoint, 'checkpoint');
const outPath = path.resolve(required(args.out, 'out'));
const triage = readJson(triagePath);
const checkpoint = readJson(checkpointPath);

const checkpointSenseIds = new Set(
  checkpointItems(checkpoint)
    .map((row) => Number(row.product_sense_id))
    .filter(Number.isInteger)
);
const pairs = new Map();

for (const group of triage.groups || []) {
  for (const pair of group.pair_reviews || []) {
    if (pair.recommendation !== 'safe_auto_merge') continue;
    const left = Number(pair.left_sense_id);
    const right = Number(pair.right_sense_id);
    if (!checkpointSenseIds.has(left) || !checkpointSenseIds.has(right)) continue;
    const key = [left, right].sort((a, b) => a - b).join(':');
    const current = pairs.get(key) || {
      entry_id: Number(pair.entry_id),
      headword: pair.headword,
      left_sense_id: Math.min(left, right),
      right_sense_id: Math.max(left, right),
      reading_differs: false,
      duplicate_langs: new Set()
    };
    current.reading_differs ||= pair.metrics?.duplicate_lang_reading_differs === true;
    current.duplicate_langs.add(pair.duplicate_lang);
    pairs.set(key, current);
  }
}

const eligiblePairs = [...pairs.values()].filter(
  (pair) => !pair.reading_differs && pair.duplicate_langs.size === 4
);
const components = connectedComponents(eligiblePairs);
const candidates = [];

for (const component of components) {
  const senseIds = [...component.sense_ids].sort((a, b) => a - b);
  const keepSenseId = senseIds[0];
  for (const removeSenseId of senseIds.slice(1)) {
    candidates.push({
      entry_id: component.entry_id,
      headword: component.headword,
      keep_sense_id: keepSenseId,
      remove_sense_id: removeSenseId,
      reason: 'checkpoint_exact_four_language_duplicate_without_reading_difference'
    });
  }
}

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  sources: {
    triage: relative(triagePath),
    checkpoint: relative(checkpointPath)
  },
  policy: {
    checkpoint_senses_only: true,
    recommendation: 'safe_auto_merge',
    required_duplicate_languages: 4,
    reject_any_reading_difference: true
  },
  summary: {
    checkpoint_senses: checkpointSenseIds.size,
    unique_safe_pairs: pairs.size,
    eligible_pairs: eligiblePairs.length,
    merge_components: components.length,
    candidates: candidates.length
  },
  candidates
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary: output.summary }, null, 2));

function connectedComponents(inputPairs) {
  const byEntry = new Map();
  for (const pair of inputPairs) {
    const bucket = byEntry.get(pair.entry_id) || [];
    bucket.push(pair);
    byEntry.set(pair.entry_id, bucket);
  }
  const result = [];
  for (const [entryId, entryPairs] of byEntry) {
    const adjacency = new Map();
    for (const pair of entryPairs) {
      connect(adjacency, pair.left_sense_id, pair.right_sense_id);
      connect(adjacency, pair.right_sense_id, pair.left_sense_id);
    }
    const visited = new Set();
    for (const senseId of adjacency.keys()) {
      if (visited.has(senseId)) continue;
      const stack = [senseId];
      const senseIds = new Set();
      while (stack.length) {
        const current = stack.pop();
        if (visited.has(current)) continue;
        visited.add(current);
        senseIds.add(current);
        for (const next of adjacency.get(current) || []) stack.push(next);
      }
      result.push({
        entry_id: entryId,
        headword: entryPairs.find((pair) => senseIds.has(pair.left_sense_id))?.headword || '',
        sense_ids: senseIds
      });
    }
  }
  return result;
}

function connect(adjacency, from, to) {
  const values = adjacency.get(from) || new Set();
  values.add(to);
  adjacency.set(from, values);
}

function checkpointItems(value) {
  return [
    ...Object.values(value?.items || {}),
    ...(Array.isArray(value?.writes) ? value.writes : [])
  ];
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
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index++;
    } else {
      parsed[key] = 'true';
    }
  }
  return parsed;
}
