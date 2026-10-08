import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = parseArgs(process.argv.slice(2));
const inputs = String(args.inputs || '').split(',').map((value) => value.trim()).filter(Boolean).map((value) => path.resolve(value));
const out = path.resolve(String(args.out || ''));
if (inputs.length < 2 || !args.out) throw new Error('Usage: --inputs <a,b,...> --out <path>');

const selected = [];
const identities = new Set();
const inputSha256 = {};
for (const input of inputs) {
  const bytes = fs.readFileSync(input);
  inputSha256[path.relative(process.cwd(), input)] = crypto.createHash('sha256').update(bytes).digest('hex');
  const report = JSON.parse(bytes.toString('utf8'));
  for (const row of report.selected || []) {
    const identity = `${Number(row.source_entry_id)}:${Number(row.source_sense_id ?? row.first_sense_id)}`;
    if (identities.has(identity)) throw new Error(`Duplicate selected identity: ${identity}`);
    identities.add(identity);
    selected.push(row);
  }
}

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  purpose: 'frozen_source_review_consensus_union',
  automatic_publication: false,
  inputs: inputSha256,
  selected_count: selected.length,
  selected,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), out), selected: selected.length }, null, 2));

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const name = argv[index].slice(2);
    const next = argv[index + 1];
    result[name] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return result;
}
