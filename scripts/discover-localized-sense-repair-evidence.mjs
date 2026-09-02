import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const inputPath = requiredPath(args.input, 'input');
const sourceDbPath = requiredPath(args['source-db'], 'source-db');
const outPath = path.resolve(args.out || 'logs/localized-sense-repair-evidence-discovery.json');
const perRepairLimit = integer(args['per-repair-limit'], 20, 1);
const input = readJson(inputPath);
const db = new Database(sourceDbPath, { readonly: true });
db.pragma('busy_timeout = 30000');
const findByEntry = db.prepare(`
  SELECT s.id AS sense_id, s.entry_id, e.word, e.source_lang, s.part_of_speech,
         s.gloss_key, s.source, s.confidence, s.needs_review
  FROM entries e JOIN senses s ON s.entry_id=e.id
  WHERE e.normalized_key=? AND s.needs_review=0
  LIMIT 200
`);
const findByLocalization = db.prepare(`
  SELECT DISTINCT s.id AS sense_id, s.entry_id, e.word, e.source_lang,
         s.part_of_speech, s.gloss_key, s.source, s.confidence, s.needs_review
  FROM sense_localizations sl
  JOIN senses s ON s.id=sl.sense_id
  JOIN entries e ON e.id=s.entry_id
  WHERE sl.lang=? AND sl.term=? AND s.needs_review=0 AND sl.needs_review=0
  LIMIT 200
`);
const getLocalizations = db.prepare(`
  SELECT lang, term, reading, reading_system, pronunciation,
         pronunciation_system, definition, source, confidence, needs_review
  FROM sense_localizations WHERE sense_id=? ORDER BY lang
`);

const repairs = (input.repairs || []).map((repair) => {
  const seedRows = uniqueSeeds([
    { lang: repair.product_sense?.primary_lang, term: repair.headword },
    ...(repair.query_forms || []),
    ...(repair.product_localizations || []).map((row) => ({ lang: row.lang, term: row.term })),
    ...(repair.source_evidence || []).flatMap((row) => [
      { lang: row.source_lang, term: row.source_word },
      ...row.localizations.map((loc) => ({ lang: loc.lang, term: loc.term }))
    ])
  ]);
  const seeds = seedRows.map((row) => normalize(row.term));
  const existingFamilies = new Set(repair.evidence_summary?.independent_source_families || []);
  const candidates = new Map();
  for (const seed of seedRows) {
    const normalizedSeed = normalize(seed.term);
    for (const row of [...findByEntry.all(normalizedSeed), ...findByLocalization.all(seed.lang, seed.term)]) {
      const family = sourceFamily(row.source);
      if (existingFamilies.has(family)) continue;
      if (!candidates.has(row.sense_id)) candidates.set(row.sense_id, { ...row, source_family: family, matched_seeds: new Set() });
      candidates.get(row.sense_id).matched_seeds.add(`${seed.lang}:${seed.term}`);
    }
  }
  const productDefinitions = (repair.product_localizations || []).map((row) => row.definition).filter(Boolean);
  const suggestions = [...candidates.values()].map((candidate) => {
    const localizations = getLocalizations.all(candidate.sense_id);
    const exactTermLanguages = unique(localizations.filter((loc) => seeds.includes(normalize(loc.term))).map((loc) => loc.lang));
    const definitionSimilarity = Math.max(0, ...localizations.flatMap((loc) => productDefinitions.map((definition) => similarity(loc.definition, definition))));
    const headwordMatch = seeds.includes(normalize(candidate.word));
    const score = (headwordMatch ? 3 : 0) + exactTermLanguages.length * 2 + definitionSimilarity * 4;
    const eligible = exactTermLanguages.length >= 2 ||
      (headwordMatch && definitionSimilarity >= 0.2) ||
      (exactTermLanguages.length >= 1 && definitionSimilarity >= 0.3);
    return {
      ...candidate,
      matched_seeds: [...candidate.matched_seeds],
      localizations,
      discovery_score: Number(score.toFixed(4)),
      exact_term_languages: exactTermLanguages,
      max_definition_similarity: Number(definitionSimilarity.toFixed(4)),
      eligible_for_manual_link_review: eligible
    };
  }).filter((row) => row.eligible_for_manual_link_review)
    .sort((a, b) => b.discovery_score - a.discovery_score || a.sense_id - b.sense_id)
    .slice(0, perRepairLimit);
  return {
    entry_id: repair.entry_id,
    headword: repair.headword,
    sense_id: repair.sense_id,
    current_source_families: [...existingFamilies],
    seeds: seedRows,
    suggestions
  };
});

const output = {
  ok: true,
  created_at: new Date().toISOString(),
  database_write: false,
  input: path.relative(process.cwd(), inputPath),
  source_db: path.relative(process.cwd(), sourceDbPath),
  summary: {
    repairs: repairs.length,
    with_suggestions: repairs.filter((row) => row.suggestions.length).length,
    suggested_source_senses: repairs.reduce((sum, row) => sum + row.suggestions.length, 0)
  },
  repairs
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2));
db.close();

function similarity(left, right) {
  const a = shingles(left), b = shingles(right);
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const token of a) if (b.has(token)) common++;
  return common / (a.size + b.size - common);
}
function shingles(value) {
  const normalized = normalize(value).replace(/[^\p{L}\p{N}]+/gu, ' ');
  const words = normalized.split(/\s+/u).filter(Boolean);
  if (words.length > 1) return new Set(words);
  const compact = normalized.replace(/\s+/gu, '');
  return new Set([...compact].map((char, index, chars) => chars.slice(index, index + 2).join('')).filter((item) => item.length > 1));
}
function sourceFamily(source) { const v=normalize(source); if(v.includes('kaikki')||v.includes('wikdict')||v.includes('wiktionary'))return 'wiktionary'; if(v.includes('wordnet')||v.includes('omw')||v.includes('openhownet'))return 'wordnet'; if(v.includes('cedict'))return 'cc-cedict'; if(v.includes('jmdict'))return 'jmdict'; if(v.includes('freedict'))return 'freedict'; if(v.includes('ecdict'))return 'ecdict'; return v.split(':')[0]||'unknown'; }
function unique(values){return [...new Set(values)];}
function uniqueSeeds(values){return [...new Map(values.filter((row)=>row?.lang&&String(row?.term||'').trim()).map((row)=>[`${row.lang}:${normalize(row.term)}`,{lang:row.lang,term:String(row.term).trim()}])).values()];}
function normalize(value){return String(value||'').trim().toLowerCase();}
function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function requiredPath(value,name){if(!value)throw new Error(`Missing --${name}`);const file=path.resolve(value);if(!fs.existsSync(file))throw new Error(`File not found: ${file}`);return file;}
function integer(value,fallback,minimum){const parsed=value==null?fallback:Number(value);if(!Number.isInteger(parsed)||parsed<minimum)throw new Error(`Invalid integer: ${value}`);return parsed;}
function parseArgs(argv){const out={};for(let i=0;i<argv.length;i++){if(!argv[i].startsWith('--'))continue;const key=argv[i].slice(2),next=argv[i+1];out[key]=next&&!next.startsWith('--')?argv[++i]:'true';}return out;}
