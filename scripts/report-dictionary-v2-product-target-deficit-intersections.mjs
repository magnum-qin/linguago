import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const deficitsPath = requiredPath(args.deficits, 'deficits');
const evidencePath = requiredPath(args.evidence, 'evidence');
const outPath = path.resolve(args.out || 'logs/product-target-deficit-intersections.json');
const deficits = JSON.parse(fs.readFileSync(deficitsPath, 'utf8'));
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
const evidenceByKey = new Map((evidence.validations || []).map((row) => [row.candidate_key, row]));
const grouped = new Map();

for (const row of deficits.insufficient_targets || []) {
  if (!grouped.has(row.candidate_key)) grouped.set(row.candidate_key, []);
  grouped.get(row.candidate_key).push(row);
}

const candidates = [...grouped.entries()].map(([candidateKey, rows]) => {
  const source = evidenceByKey.get(candidateKey);
  const targets = rows
    .map((row) => ({
      lang: row.target_lang,
      family_count: (row.observed_families || []).length,
      observed_families: row.observed_families || [],
      terms: row.terms || []
    }))
    .sort((a, b) => a.lang.localeCompare(b.lang));
  const oneFamily = targets.filter((row) => row.family_count === 1).length;
  const zeroFamily = targets.filter((row) => row.family_count === 0).length;
  return {
    candidate_key: candidateKey,
    word: source?.word || rows[0]?.word || null,
    source_lang: source?.source_lang || rows[0]?.source_lang || null,
    frequency_rank: source?.frequency_rank ?? null,
    source_family_count: source?.evidence?.matching_source_families?.length || 0,
    missing_target_count: targets.length,
    one_family_target_count: oneFamily,
    zero_family_target_count: zeroFamily,
    repair_tier: zeroFamily === 0 && oneFamily === 1
      ? 'single_one_family_gap'
      : zeroFamily === 0
        ? 'multiple_one_family_gaps'
        : oneFamily > 0
          ? 'mixed_one_and_zero_family_gaps'
          : 'zero_family_only',
    targets
  };
}).sort((a, b) =>
  tierOrder(a.repair_tier) - tierOrder(b.repair_tier) ||
  (a.frequency_rank ?? 1e9) - (b.frequency_rank ?? 1e9) ||
  a.candidate_key.localeCompare(b.candidate_key)
);

const tiers = Object.fromEntries(
  ['single_one_family_gap', 'multiple_one_family_gaps', 'mixed_one_and_zero_family_gaps', 'zero_family_only']
    .map((tier) => [tier, candidates.filter((row) => row.repair_tier === tier).length])
);
const patterns = {};
for (const row of candidates) {
  const key = row.targets.map((target) => `${target.lang}:${target.family_count}`).join('|');
  patterns[key] = (patterns[key] || 0) + 1;
}

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_reports: { deficits: deficitsPath, evidence: evidencePath },
  summary: {
    candidates: candidates.length,
    tiers,
    patterns: Object.fromEntries(Object.entries(patterns).sort((a, b) => b[1] - a[1]))
  },
  candidates
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), ...output.summary }, null, 2));

function tierOrder(value) {
  return ['single_one_family_gap', 'multiple_one_family_gaps', 'mixed_one_and_zero_family_gaps', 'zero_family_only'].indexOf(value);
}
function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const result = path.resolve(value);
  if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`);
  return result;
}
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else out[key] = true;
  }
  return out;
}
