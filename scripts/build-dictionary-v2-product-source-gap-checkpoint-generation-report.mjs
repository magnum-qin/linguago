import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const checkpointPath = requiredPath(args.checkpoint, 'checkpoint');
const outPath = path.resolve(required(args.out, 'out'));
const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
const items = Object.values(checkpoint.items || {});
const generated = items
  .filter((row) => row?.generated_item && typeof row.generated_item === 'object')
  .map((row) => ({
    ...row.generated_item,
    source_sense_id: Number(row.source_sense_id),
    product_entry_id: Number(row.product_entry_id) || null,
    product_sense_id: Number(row.product_sense_id) || null
  }));

const output = {
  ok: items.length > 0 && generated.length > 0,
  generated_at: new Date().toISOString(),
  checkpoint: path.relative(process.cwd(), checkpointPath),
  stats: {
    checkpoint_items: items.length,
    accepted: items.filter((row) => row?.status === 'accepted').length,
    rejected: items.filter((row) => row?.status === 'rejected').length,
    generated: generated.length,
    valid: generated.filter((row) => row?.valid === true).length
  },
  generated
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: output.ok, out: path.relative(process.cwd(), outPath), stats: output.stats }, null, 2));

function required(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return String(value);
}

function requiredPath(value, name) {
  const result = path.resolve(required(value, name));
  if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`);
  return result;
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
