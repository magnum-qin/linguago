import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const inputPath = requiredPath(args.input, 'input');
const outPath = path.resolve(args.out || 'logs/localized-sense-manual-review-publication-blocks.json');
const input = readJson(inputPath);
const rows = (input.dispositions || []).filter((row) => row.disposition === 'manual_review_required');
const blocks = rows.map((row) => ({
  target: { sense_id: Number(row.sense_id) },
  block_code: 'blocked_source_ambiguous',
  rationale: 'Localized-sense quality review did not produce an evidence-locked, byte-identical Qwen/Gemma repair.',
  recommendation: 'Keep out of the published dictionary until authoritative dictionary evidence supports an exact four-language repair.',
  evidence: {
    entry_id: Number(row.entry_id),
    headword: row.headword,
    query_forms: row.query_forms,
    target_localizations: row.target_localizations,
    primary: row.primary,
    secondary: row.secondary
  }
}));
const senseIds = blocks.map((row) => row.target.sense_id);
const duplicates = senseIds.filter((id, index) => senseIds.indexOf(id) !== index);
if (!blocks.length) throw new Error('No manual_review_required dispositions found');
if (duplicates.length) throw new Error(`Duplicate sense ids: ${[...new Set(duplicates)].join(',')}`);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(blocks, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  ok: true,
  database_write: false,
  input: path.relative(process.cwd(), inputPath),
  out: path.relative(process.cwd(), outPath),
  manual_review_blocks: blocks.length
}, null, 2));

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const file = path.resolve(value);
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  return file;
}
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2), next = argv[i + 1];
    out[key] = next && !next.startsWith('--') ? argv[++i] : 'true';
  }
  return out;
}
