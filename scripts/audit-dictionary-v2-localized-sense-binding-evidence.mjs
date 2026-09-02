import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const triagePath = requiredPath(args.triage, 'triage');
const productDbPath = requiredPath(args.db, 'db');
const sourceDbPath = requiredPath(args['source-db'], 'source-db');
const outPath = path.resolve(args.out || 'logs/product-localized-sense-binding-evidence.json');
const triage = readJson(triagePath);
const db = new Database(productDbPath, { readonly: true, fileMustExist: true });
db.pragma('busy_timeout = 30000');
db.prepare('ATTACH DATABASE ? AS source_db').run(sourceDbPath);

const productSense = db.prepare(`
  SELECT ps.id, ps.product_entry_id AS entry_id, pe.headword, ps.sense_order,
         ps.part_of_speech, ps.gloss_key, ps.status
  FROM product_senses ps JOIN product_entries pe ON pe.id=ps.product_entry_id
  WHERE ps.id=?
`);
const links = db.prepare(`
  SELECT l.id AS link_id, l.source_entry_id AS snapshot_entry_id,
         l.source_sense_id AS snapshot_sense_id, l.source_lang AS snapshot_lang,
         l.source_word AS snapshot_word, l.match_method, l.confidence,
         e.id AS source_entry_id, e.word AS source_word, e.source_lang,
         s.id AS source_sense_id, s.source, s.needs_review
  FROM product_sense_source_links l
  LEFT JOIN source_db.senses s ON s.id=l.source_sense_id
  LEFT JOIN source_db.entries e ON e.id=s.entry_id
  WHERE l.product_sense_id=?
  ORDER BY l.confidence DESC, l.id
`);
const localizations = db.prepare(`
  SELECT lang, term, definition, source, confidence, needs_review
  FROM source_db.sense_localizations WHERE sense_id=? AND lang=?
`);

const proposals = [];
for (const row of triage.independent_evidence_required || []) {
  for (const senseId of row.add_sense_ids || []) {
    const sense = productSense.get(senseId) || null;
    const evidence = [];
    for (const link of links.all(senseId)) {
      const linkValid = Boolean(link.source_sense_id)
        && link.snapshot_entry_id === link.source_entry_id
        && normalize(link.snapshot_word) === normalize(link.source_word)
        && normalize(link.snapshot_lang) === normalize(link.source_lang)
        && !link.needs_review;
      if (!linkValid) continue;
      for (const localization of localizations.all(link.source_sense_id, row.query_lang)) {
        if (localization.needs_review || normalize(localization.term) !== normalize(row.query_term)) continue;
        evidence.push({
          link_id: link.link_id,
          source_sense_id: link.source_sense_id,
          source_family: sourceFamily(link.source || localization.source),
          source_word: link.source_word,
          lang: localization.lang,
          term: localization.term,
          definition: localization.definition,
          confidence: Math.min(Number(link.confidence) || 0, Number(localization.confidence) || 0)
        });
      }
    }
    const families = [...new Set(evidence.map((item) => item.source_family).filter((value) => value !== 'unknown'))].sort();
    proposals.push({
      candidate_id: row.candidate_id,
      entry_id: row.entry_id,
      headword: row.headword,
      query_lang: row.query_lang,
      query_term: row.query_term,
      proposed_sense_id: senseId,
      product_sense: sense,
      identity_valid: Boolean(sense) && sense.entry_id === row.entry_id && sense.status === 'accepted',
      exact_evidence: evidence,
      independent_source_families: families,
      eligible: Boolean(sense) && sense.entry_id === row.entry_id && sense.status === 'accepted' && families.length >= 2
    });
  }
}
const output = {
  ok: proposals.every((row) => row.identity_valid),
  created_at: new Date().toISOString(),
  database_write: false,
  inputs: { triage: relative(triagePath), product_db: relative(productDbPath), source_db: relative(sourceDbPath) },
  policy: 'exact_target_term_on_linked_source_sense_from_two_independent_families',
  summary: {
    proposals: proposals.length,
    identity_valid: proposals.filter((row) => row.identity_valid).length,
    with_any_exact_evidence: proposals.filter((row) => row.exact_evidence.length > 0).length,
    eligible: proposals.filter((row) => row.eligible).length,
    rejected: proposals.filter((row) => !row.eligible).length
  },
  proposals
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: output.ok, out: relative(outPath), summary: output.summary }, null, 2));
db.close();
process.exitCode = output.ok ? 0 : 2;

function sourceFamily(source) {
  const value = normalize(source);
  if (!value) return 'unknown';
  if (value.includes('kaikki') || value.includes('wikdict') || value.includes('wiktionary')) return 'wiktionary';
  if (value.includes('wordnet') || value.includes('omw') || value.includes('openhownet')) return 'wordnet';
  if (value.includes('cedict')) return 'cc-cedict';
  if (value.includes('jmdict')) return 'jmdict';
  if (value.includes('freedict')) return 'freedict';
  if (value.includes('ecdict')) return 'ecdict';
  return value.split(':')[0];
}
function normalize(value) { return String(value || '').trim().toLocaleLowerCase(); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function relative(file) { return path.relative(process.cwd(), file); }
function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const file = path.resolve(value);
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  return file;
}
function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index++) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    output[key] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return output;
}
