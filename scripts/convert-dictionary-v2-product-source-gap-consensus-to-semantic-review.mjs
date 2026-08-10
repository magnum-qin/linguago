import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const dbPath = requiredPath(args.db, 'db');
const consensusPath = requiredPath(args.consensus, 'consensus');
const outPath = requiredPath(args.out, 'out');
const writesReportPath = args['writes-report']
  ? requiredPath(args['writes-report'], 'writes-report')
  : null;
const excludedSourceEntryIds = new Set(
  String(args['exclude-source-entry-ids'] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isInteger)
);
const consensus = readJson(consensusPath);
const generationPath = consensus?.generation_report
  ? path.resolve(consensus.generation_report)
  : null;
const generation = generationPath && fs.existsSync(generationPath) ? readJson(generationPath) : null;
const sourceSenseByCandidate = new Map(
  (generation?.generated || [])
    .filter(
      (row) =>
        Number.isInteger(Number(row?.source_entry_id)) &&
        Number.isInteger(Number(row?.output?.source_sense_id))
    )
    .map((row) => [candidateKey(row), Number(row.output.source_sense_id)])
);
const writtenSenseByCandidate = writesReportPath
  ? new Map(
      (readJson(writesReportPath).writes || [])
        .filter(
          (row) =>
            Number.isInteger(Number(row?.source_entry_id)) &&
            Number.isInteger(Number(row?.product_sense_id))
        )
        .map((row) => [candidateKey(row), Number(row.product_sense_id)])
    )
  : new Map();

if (consensus?.policy?.independent_model_families !== true) {
  throw new Error('Consensus report does not certify independent model families');
}

const accepted = (consensus.reviews || []).filter(
  (row) =>
    !excludedSourceEntryIds.has(Number(row?.source_entry_id)) &&
    row?.valid === true &&
    row?.consensus_accepted === true &&
    row?.decision === 'accept' &&
    Number(row?.confidence) >= Number(consensus.policy.confidence_threshold || 0.9) &&
    Array.isArray(row?.corrections) &&
    row.corrections.length === 0
);
if (!accepted.length) throw new Error('Consensus report contains no accepted rows');

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
db.pragma('query_only = ON');
const findDraft = db.prepare(`
  SELECT DISTINCT
    ps.id AS sense_id,
    pe.id AS entry_id,
    pe.headword,
    ps.gloss_key
  FROM product_sense_source_links pssl
  JOIN product_senses ps ON ps.id = pssl.product_sense_id
  JOIN product_entries pe ON pe.id = ps.product_entry_id
  WHERE pssl.source_sense_id = ?
    AND pe.group_method = 'source_gap_unsloth'
    AND ps.status = 'draft_single_source'
`);
const findDraftById = db.prepare(`
  SELECT ps.id AS sense_id, pe.id AS entry_id, pe.headword, ps.gloss_key
  FROM product_senses ps
  JOIN product_entries pe ON pe.id = ps.product_entry_id
  WHERE ps.id = ?
    AND pe.group_method = 'source_gap_unsloth'
    AND ps.status = 'draft_single_source'
`);

const reviews = accepted.map((row) => {
  const key = candidateKey(row);
  const sourceSenseId = sourceSenseByCandidate.get(key) || Number(row.source_sense_id);
  const writtenSenseId = writtenSenseByCandidate.get(key);
  const matches = writtenSenseId
    ? [findDraftById.get(writtenSenseId)].filter(Boolean)
    : findDraft.all(sourceSenseId);
  if (matches.length !== 1) {
    throw new Error(
      `Expected one draft for source ${key}, found ${matches.length}`
    );
  }
  const match = matches[0];
  return {
    valid: true,
    decision: 'accept_synonym',
    confidence: Number(row.confidence),
    risk_flags: [],
    sense_id: Number(match.sense_id),
    entry_id: Number(match.entry_id),
    source_entry_id: Number(row.source_entry_id),
    source_sense_id: sourceSenseId,
    headword: match.headword,
    gloss_key: match.gloss_key,
    reason: row.reason,
    reviewer_model: consensus.policy.reviewer_model,
    generation_model: consensus.policy.generation_model
  };
});
db.close();

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  consensus_report: path.relative(process.cwd(), consensusPath),
  db: path.relative(process.cwd(), dbPath),
  policy: {
    independent_model_families: true,
    automatic_promotion: false
  },
  summary: {
    consensus_accepted: accepted.length,
    uniquely_mapped_drafts: reviews.length,
    excluded_source_entry_ids: excludedSourceEntryIds.size
  },
  items: Object.fromEntries(
    reviews.map((row) => [
      candidateKey(row),
      {
        status: 'accepted',
        source_entry_id: row.source_entry_id,
        product_sense_id: row.sense_id
      }
    ])
  ),
  reviews
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(
  JSON.stringify(
    {
      ok: true,
      out: path.relative(process.cwd(), outPath),
      summary: output.summary
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
