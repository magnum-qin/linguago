import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const generationPath = requiredPath(args.generation, 'generation');
const consensusPath = requiredPath(args.consensus, 'consensus');
const outPath = requiredPath(args.out, 'out');
const excludedSourceEntryIds = new Set(
  String(args['exclude-source-entry-ids'] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);
const generation = readJson(generationPath);
const consensus = readJson(consensusPath);

if (consensus?.policy?.independent_model_families !== true) {
  throw new Error('Consensus report does not certify independent model families');
}
if (consensus?.policy?.automatic_promotion !== false) {
  throw new Error('Consensus report has an unsafe automatic-promotion policy');
}

const acceptedKeys = new Set(
  (consensus.reviews || [])
    .filter(
      (row) =>
        !excludedSourceEntryIds.has(String(row?.source_entry_id)) &&
        row?.valid === true &&
        row?.consensus_accepted === true &&
        row?.decision === 'accept' &&
        Number(row?.confidence) >= Number(consensus.policy.confidence_threshold || 0.9) &&
        Array.isArray(row?.corrections) &&
        row.corrections.length === 0
    )
    .map(candidateKey)
    .filter(Boolean)
);
const generated = (generation.generated || []).filter(
  (row) => row?.valid === true && acceptedKeys.has(candidateKey(row))
);

if (generated.length !== acceptedKeys.size) {
  throw new Error(
    `Consensus/generation mismatch: accepted=${acceptedKeys.size}, generated=${generated.length}`
  );
}

const output = {
  ...generation,
  generated_at: new Date().toISOString(),
  derived_from: {
    generation: path.relative(process.cwd(), generationPath),
    consensus: path.relative(process.cwd(), consensusPath),
    excluded_source_entry_ids: [...excludedSourceEntryIds]
  },
  stats: {
    ...(generation.stats || {}),
    generated: generated.length,
    accepted: generated.length,
    rejected: 0,
    consensus_filtered: true,
    consensus_accepted: acceptedKeys.size
  },
  generated
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(
  JSON.stringify(
    {
      ok: true,
      out: path.relative(process.cwd(), outPath),
      consensus_accepted: acceptedKeys.size,
      generated: generated.length,
      excluded_source_entry_ids: excludedSourceEntryIds.size
    },
    null,
    2
  )
);

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return path.resolve(value);
}

function candidateKey(row) {
  if (/^\d+:\d+$/.test(String(row?.candidate_key || ''))) return String(row.candidate_key);
  const entryId = Number(row?.source_entry_id);
  const senseId = Number(
    row?.source_sense_id ?? row?.output?.source_sense_id ?? row?.first_sense_id
  );
  if (!Number.isInteger(entryId) || !Number.isInteger(senseId)) return null;
  return `${entryId}:${senseId}`;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}
