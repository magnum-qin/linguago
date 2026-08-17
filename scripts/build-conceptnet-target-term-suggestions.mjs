import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const probePath = requiredPath(args.probe, 'probe');
const outPath = path.resolve(args.out || 'logs/product-conceptnet-target-term-suggestions.json');
const maxTerms = Number(args['max-terms'] || 5);
const probe = JSON.parse(fs.readFileSync(probePath, 'utf8'));
const grouped = new Map();

for (const row of probe.matches || []) {
  const key = `${row.candidate_key}\0${row.target_lang}`;
  if (!grouped.has(key)) grouped.set(key, { ...row, terms: new Map(), source_families: new Set() });
  const group = grouped.get(key);
  const normalized = normalizeTerm(row.target_term);
  if (!group.terms.has(normalized)) group.terms.set(normalized, { term: row.target_term, weight: row.weight || 0 });
  else group.terms.get(normalized).weight = Math.max(group.terms.get(normalized).weight, row.weight || 0);
  for (const family of row.source_families || []) group.source_families.add(family);
}

const suggestions = [...grouped.values()].map((row) => ({
  candidate_key: row.candidate_key,
  word: row.word,
  source_lang: row.source_lang,
  target_lang: row.target_lang,
  english_anchor: row.english_anchor,
  frequency_rank: row.frequency_rank,
  part_of_speech: null,
  existing_terms: [],
  observed_families: [],
  endpoint: null,
  model: null,
  valid: true,
  terms: [...row.terms.values()]
    .sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term))
    .slice(0, maxTerms)
    .map((item) => item.term),
  discovery_source: 'conceptnet-5.7-synonym',
  discovery_families: [...row.source_families].sort(),
  reason: 'candidate discovery only; ConceptNet is not evidence'
})).sort((a, b) =>
  (a.frequency_rank ?? 1e9) - (b.frequency_rank ?? 1e9) || a.candidate_key.localeCompare(b.candidate_key)
);

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  policy: { discovery_only: true, conceptnet_is_not_evidence: true, local_reverse_validation_required: true },
  summary: {
    input_matches: (probe.matches || []).length,
    candidate_target_pairs: suggestions.length,
    candidates: new Set(suggestions.map((row) => row.candidate_key)).size,
    terms: suggestions.reduce((sum, row) => sum + row.terms.length, 0)
  },
  suggestions
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out: path.relative(process.cwd(), outPath), ...output.summary }, null, 2));

function normalizeTerm(value) {
  return String(value || '').normalize('NFKC').toLowerCase().trim();
}
function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const result = path.resolve(value);
  if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`);
  return result;
}
function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      index += 1;
    } else out[key] = true;
  }
  return out;
}
