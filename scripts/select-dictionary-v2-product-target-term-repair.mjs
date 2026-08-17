import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const evidencePath = requiredPath(args.evidence, 'evidence');
const deficitsPath = requiredPath(args.deficits, 'deficits');
const intersectionsPath = args.intersections ? requiredPath(args.intersections, 'intersections') : null;
const outPath = path.resolve(args.out || 'logs/product-target-term-repair-selected.json');
const perLang = Number(args['per-lang'] || 10);
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
const deficits = JSON.parse(fs.readFileSync(deficitsPath, 'utf8'));
const eligibleIntersectionKeys = intersectionsPath
  ? new Set(
      (JSON.parse(fs.readFileSync(intersectionsPath, 'utf8')).candidates || [])
        .filter((row) => row.repair_tier === 'single_one_family_gap')
        .map((row) => row.candidate_key)
    )
  : null;
const validationByKey = new Map((evidence.validations || []).map((row) => [row.candidate_key, row]));
const pools = { zh: [], ja: [] };

for (const deficit of deficits.insufficient_targets || []) {
  if (!pools[deficit.target_lang] || (deficit.observed_families || []).length !== 1) continue;
  if (eligibleIntersectionKeys && !eligibleIntersectionKeys.has(deficit.candidate_key)) continue;
  const row = validationByKey.get(deficit.candidate_key);
  if (!row || (row.evidence?.matching_source_families || []).length < 2) continue;
  pools[deficit.target_lang].push({
    candidate_key: row.candidate_key,
    source_entry_id: row.source_entry_id,
    source_sense_id: row.source_sense_id,
    word: row.word,
    source_lang: row.source_lang,
    frequency_rank: row.frequency_rank,
    part_of_speech: row.part_of_speech || null,
    english_anchor: row.evidence.anchor,
    target_lang: deficit.target_lang,
    existing_terms: deficit.terms,
    observed_families: deficit.observed_families,
    source_families: row.evidence.matching_source_families
  });
}
for (const rows of Object.values(pools)) rows.sort((a, b) => (a.frequency_rank ?? 1e9) - (b.frequency_rank ?? 1e9));
const selected = [...pools.zh.slice(0, perLang), ...pools.ja.slice(0, perLang)];
const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  policy: {
    one_existing_target_family: true,
    minimum_source_families: 2,
    balanced_target_languages: true,
    single_target_deficit_only: Boolean(eligibleIntersectionKeys)
  },
  summary: { eligible_zh: pools.zh.length, eligible_ja: pools.ja.length, selected_zh: selected.filter((r) => r.target_lang === 'zh').length, selected_ja: selected.filter((r) => r.target_lang === 'ja').length },
  selected
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), ...output.summary }, null, 2));

function requiredPath(value, name) { if (!value) throw new Error(`Missing --${name}`); const result = path.resolve(value); if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`); return result; }
function parseArgs(argv) { const out = {}; for (let i = 0; i < argv.length; i += 1) { if (!argv[i].startsWith('--')) continue; const key = argv[i].slice(2); const next = argv[i + 1]; if (next && !next.startsWith('--')) { out[key] = next; i += 1; } else out[key] = true; } return out; }
