import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const inputPath = requiredPath(args.input, 'input');
const dbPath = requiredPath(args.db, 'db');
const sourceDbPath = requiredPath(args['source-db'], 'source-db');
const outPath = path.resolve(args.out || 'logs/localized-sense-repair-source-link-plan.json');
const minimumExactLanguages = integer(args['minimum-exact-languages'], 2, 2);
const allowCrossLingual = boolean(args['allow-cross-lingual'], false);
const input = readJson(inputPath);
const db = new Database(dbPath, { readonly: true });
const sourceDb = new Database(sourceDbPath, { readonly: true });

const getTarget = db.prepare(`
  SELECT ps.id AS sense_id, ps.product_entry_id AS entry_id, pe.headword, pe.primary_lang
  FROM product_senses ps JOIN product_entries pe ON pe.id=ps.product_entry_id
  WHERE ps.id=?
`);
const getExistingLinks = db.prepare(`
  SELECT source_sense_id FROM product_sense_source_links
  WHERE product_sense_id=? ORDER BY source_sense_id
`);
const getProductLocalizations = db.prepare(`
  SELECT lang, term
  FROM product_localizations
  WHERE product_sense_id=?
  ORDER BY lang
`);
const getSource = sourceDb.prepare(`
  SELECT s.id AS sense_id, s.entry_id, e.word, e.source_lang,
         e.frequency_rank, s.source, s.needs_review
  FROM senses s JOIN entries e ON e.id=s.entry_id WHERE s.id=?
`);
const getSourceLocalizations = sourceDb.prepare(`
  SELECT lang, term
  FROM sense_localizations
  WHERE sense_id=?
  ORDER BY lang
`);

const links = [];
const rejected = [];
for (const repair of input.repairs || []) {
  const target = getTarget.get(repair.sense_id);
  if (!target || target.entry_id !== repair.entry_id || normalize(target.headword) !== normalize(repair.headword)) {
    rejected.push({ sense_id: repair.sense_id, reason: 'target_snapshot_mismatch' });
    continue;
  }
  const existingSourceSenseIds = getExistingLinks.all(target.sense_id).map((row) => row.source_sense_id);
  const targetLanguages = new Set(
    (repair.target_localizations || []).map((row) => row.lang).filter(Boolean)
  );
  const currentTargetTerms = new Set(getProductLocalizations.all(target.sense_id)
    .filter((row) => targetLanguages.has(row.lang))
    .flatMap((row) => splitTerms(row.term).map((term) => `${row.lang}:${normalize(term)}`)));
  const existingSourceSenseIdSet = new Set(existingSourceSenseIds);
  const eligible = (repair.suggestions || []).filter((suggestion) => {
    const source = getSource.get(suggestion.sense_id);
    return source && source.needs_review === 0 &&
      (allowCrossLingual || normalize(source.word) === normalize(target.headword)) &&
      sourceFamily(source.source) === suggestion.source_family &&
      !existingSourceSenseIdSet.has(suggestion.sense_id) &&
      (suggestion.exact_term_languages || []).length >= minimumExactLanguages;
  }).sort((a, b) => b.discovery_score - a.discovery_score || a.sense_id - b.sense_id);

  const evidenceRows = [
    ...existingSourceSenseIds.map((senseId) => {
      const source = getSource.get(senseId);
      return source ? {
        sense_id: senseId,
        source_family: sourceFamily(source.source),
        source_lang: source.source_lang,
        word: source.word,
        localizations: getSourceLocalizations.all(senseId)
      } : null;
    }).filter(Boolean),
    ...eligible.map((suggestion) => ({
      ...suggestion,
      localizations: suggestion.localizations || getSourceLocalizations.all(suggestion.sense_id)
    }))
  ];
  const supportedTerms = collectDualFamilyTargetTerms(evidenceRows, targetLanguages, currentTargetTerms);
  const selected = selectMinimalSupportingSuggestions(eligible, supportedTerms, getSourceLocalizations);
  if (!selected.length) {
    rejected.push({
      sense_id: repair.sense_id,
      headword: repair.headword,
      reason: eligible.length ? 'no_dual_family_target_term' : 'no_strict_independent_source'
    });
    continue;
  }
  for (const selection of selected) {
    const source = getSource.get(selection.sense_id);
    links.push({
      product_sense_id: target.sense_id,
      product_entry_id: target.entry_id,
      headword: target.headword,
      expected_existing_source_sense_ids: existingSourceSenseIds,
      source_entry_id: source.entry_id,
      source_sense_id: source.sense_id,
      source_lang: source.source_lang,
      source_word: source.word,
      source_frequency_rank: source.frequency_rank,
      source_name: source.source,
      source_family: selection.source_family,
      exact_term_languages: selection.exact_term_languages,
      supported_target_terms: supportedTerms,
      discovery_score: selection.discovery_score,
      match_method: 'deterministic_native_target_headword_dual_family',
      confidence: 0.95
    });
  }
}

const output = {
  ok: true,
  created_at: new Date().toISOString(),
  apply_allowed: links.length > 0,
  database_write: false,
  input: path.relative(process.cwd(), inputPath),
  database: path.relative(process.cwd(), dbPath),
  source_db: path.relative(process.cwd(), sourceDbPath),
  policy: {
    minimum_exact_languages: minimumExactLanguages,
    exact_headword_required: !allowCrossLingual,
    cross_lingual_source_entries_allowed: allowCrossLingual,
    new_source_sense_required: true,
    dual_family_exact_target_term_required: true
  },
  summary: { targets: (input.repairs || []).length, approved_links: links.length, rejected: rejected.length },
  links,
  rejected
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2));
db.close();
sourceDb.close();

function sourceFamily(source) {
  const value = String(source || '').toLowerCase();
  if (value.includes('wikdict') || value.includes('kaikki') || value.includes('wiktionary')) return 'wiktionary';
  if (value.includes('wordnet') || value.includes('omw') || value.includes('openhownet')) return 'wordnet';
  if (value.includes('cc-cedict')) return 'cc-cedict';
  if (value.includes('jmdict')) return 'jmdict';
  if (value.includes('freedict')) return 'freedict';
  if (value.includes('ecdict')) return 'ecdict';
  return value || 'unknown';
}
function collectDualFamilyTargetTerms(rows, targetLanguages, excludedTerms) {
  const support = new Map();
  for (const row of rows) {
    if (!row.source_lang || !row.word || (targetLanguages.size && !targetLanguages.has(row.source_lang))) continue;
    const key = `${row.source_lang}:${normalize(row.word)}`;
    if (excludedTerms.has(key)) continue;
    const value = support.get(key) || { lang: row.source_lang, term: row.word, families: new Set() };
    value.families.add(row.source_family);
    support.set(key, value);
  }
  return [...support.values()]
    .filter((row) => row.families.size >= 2)
    .map((row) => ({ lang: row.lang, term: row.term, source_families: [...row.families].sort() }));
}
function selectMinimalSupportingSuggestions(suggestions, supportedTerms) {
  const selected = new Map();
  for (const candidate of supportedTerms) {
    for (const family of candidate.source_families) {
      const match = suggestions.find((suggestion) =>
        suggestion.source_family === family &&
        suggestion.source_lang === candidate.lang &&
        normalize(suggestion.word) === normalize(candidate.term)
      );
      if (match) selected.set(match.sense_id, match);
    }
  }
  return [...selected.values()];
}
function splitTerms(value) {
  return String(value || '').split(/[;,；、|/]+/u).map((item) => item.trim()).filter(Boolean);
}
function normalize(value) { return String(value || '').normalize('NFKC').trim().toLocaleLowerCase(); }
function integer(value, fallback, minimum) { const parsed=Number.parseInt(value ?? fallback,10); if(!Number.isInteger(parsed)||parsed<minimum)throw new Error(`Expected integer >= ${minimum}`); return parsed; }
function boolean(value, fallback) { if (value === undefined) return fallback; return !['false', '0', 'no'].includes(String(value).toLowerCase()); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function requiredPath(value,name){if(!value)throw new Error(`Missing --${name}`);const file=path.resolve(value);if(!fs.existsSync(file))throw new Error(`File not found: ${file}`);return file;}
function parseArgs(argv){const out={};for(let i=0;i<argv.length;i++){if(!argv[i].startsWith('--'))continue;const key=argv[i].slice(2),next=argv[i+1];out[key]=next&&!next.startsWith('--')?argv[++i]:'true';}return out;}
