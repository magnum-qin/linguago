import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const evidencePath = requiredPath(args.evidence, 'evidence');
const discoveryPath = requiredPath(args.discovery, 'discovery');
const outPath = path.resolve(args.out || 'logs/localized-sense-expanded-source-review-input.json');
const evidence = readJson(evidencePath);
const discovery = readJson(discoveryPath);
const discoveryBySense = new Map((discovery.repairs || []).map((row) => [Number(row.sense_id), row]));
const candidates = [];
const seen = new Set();

for (const repair of evidence.repairs || []) {
  const expectedExistingSourceSenseIds = (repair.source_evidence || [])
    .map((row) => Number(row.source_sense_id)).filter(Number.isInteger).sort((a, b) => a - b);
  for (const source of repair.source_evidence || []) {
    if (!source.link_valid || source.source_needs_review) continue;
    addCandidate(repair, sourceRecord(source), 'existing_link', expectedExistingSourceSenseIds);
  }
  for (const source of discoveryBySense.get(Number(repair.sense_id))?.suggestions || []) {
    if (source.needs_review) continue;
    addCandidate(repair, sourceRecord(source), 'discovered_suggestion', expectedExistingSourceSenseIds);
  }
}

const output = {
  ok: true, created_at: new Date().toISOString(), database_write: false,
  evidence: relative(evidencePath), discovery: relative(discoveryPath),
  summary: {
    repairs: (evidence.repairs || []).length,
    candidates: candidates.length,
    existing_links: candidates.filter((row) => row.origin === 'existing_link').length,
    discovered_suggestions: candidates.filter((row) => row.origin === 'discovered_suggestion').length
  },
  candidates
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary: output.summary }, null, 2));

function addCandidate(repair, source, origin, expectedExistingSourceSenseIds) {
  const candidateId = `product:${Number(repair.sense_id)}:source:${Number(source.sense_id)}`;
  if (seen.has(candidateId)) return;
  seen.add(candidateId);
  candidates.push({
    candidate_id: candidateId, origin,
    expected_existing_source_sense_ids: expectedExistingSourceSenseIds,
    product_sense: repair.product_sense,
    product_localizations: repair.product_localizations,
    target_localizations: repair.target_localizations,
    query_forms: repair.query_forms,
    proposed_source_link: {
      product_sense_id: Number(repair.sense_id), product_entry_id: Number(repair.entry_id), headword: repair.headword,
      source_entry_id: Number(source.entry_id), source_sense_id: Number(source.sense_id), source_family: source.source_family,
      source_lang: source.source_lang, source_word: source.word, source_frequency_rank: source.frequency_rank, origin
    },
    proposed_source_sense: {
      sense_id: Number(source.sense_id), entry_id: Number(source.entry_id), sense_order: source.sense_order,
      part_of_speech: source.part_of_speech, gloss_key: source.gloss_key, source: source.source,
      confidence: source.confidence, needs_review: source.needs_review, word: source.word,
      source_lang: source.source_lang, frequency_rank: source.frequency_rank
    },
    proposed_source_localizations: source.localizations || []
  });
}
function sourceRecord(row) { return { sense_id: row.source_sense_id ?? row.sense_id, entry_id: row.source_entry_id ?? row.entry_id, sense_order: row.sense_order, part_of_speech: row.part_of_speech, gloss_key: row.gloss_key, source: row.source, confidence: row.source_confidence ?? row.confidence, needs_review: row.source_needs_review ?? row.needs_review, word: row.source_word ?? row.word, source_lang: row.source_lang, frequency_rank: row.source_frequency_rank ?? row.frequency_rank, source_family: row.source_family, localizations: row.localizations || [] }; }
function relative(file) { return path.relative(process.cwd(), file); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function requiredPath(value, name) { if (!value) throw new Error(`Missing --${name}`); const file = path.resolve(value); if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`); return file; }
function parseArgs(argv) { const out = {}; for (let i = 0; i < argv.length; i++) { if (!argv[i].startsWith('--')) continue; const key = argv[i].slice(2), next = argv[i + 1]; out[key] = next && !next.startsWith('--') ? argv[++i] : 'true'; } return out; }
