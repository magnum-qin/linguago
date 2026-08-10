import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const dbPath = requiredPath(args.db, 'db');
const evidencePath = requiredPath(args.evidence, 'evidence');
const outPath = requiredPath(args.out, 'out');
const evidence = readJson(evidencePath);
const supported = (evidence.validations || []).filter(
  (row) =>
    row?.generation_valid === true &&
    row?.decision === 'supported' &&
    Number.isInteger(Number(row?.source_sense_id))
);

if (!supported.length) throw new Error('Reverse-evidence report contains no supported source senses');

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
db.pragma('query_only = ON');
const findDraft = db.prepare(`
  SELECT DISTINCT
    ps.id AS product_sense_id,
    pe.id AS product_entry_id,
    pe.headword,
    ps.gloss_key
  FROM product_sense_source_links pssl
  JOIN product_senses ps ON ps.id = pssl.product_sense_id
  JOIN product_entries pe ON pe.id = ps.product_entry_id
  WHERE pssl.source_sense_id = ?
    AND pe.group_method = 'source_gap_unsloth'
    AND ps.status = 'draft_single_source'
`);

const items = {};
for (const row of supported) {
  const sourceSenseId = Number(row.source_sense_id);
  const matches = findDraft.all(sourceSenseId);
  if (matches.length !== 1) {
    throw new Error(`Expected one draft for source sense ${sourceSenseId}, found ${matches.length}`);
  }
  const match = matches[0];
  items[String(sourceSenseId)] = {
    status: 'accepted',
    source_entry_id: Number(row.source_entry_id),
    source_sense_id: sourceSenseId,
    product_entry_id: Number(match.product_entry_id),
    product_sense_id: Number(match.product_sense_id),
    headword: match.headword,
    gloss_key: match.gloss_key,
    evidence_decision: row.decision
  };
}
db.close();

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  db: path.relative(process.cwd(), dbPath),
  reverse_evidence: path.relative(process.cwd(), evidencePath),
  policy: {
    required_generation_valid: true,
    required_decision: 'supported',
    unique_draft_mapping: true
  },
  summary: {
    supported_source_senses: supported.length,
    uniquely_mapped_drafts: Object.keys(items).length
  },
  items
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
