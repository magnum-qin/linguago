import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const planPath = requiredPath(args.plan, 'plan');
const productDb = requiredPath(args.db, 'db');
const sourceDb = requiredPath(args['source-db'], 'source-db');
const outPath = path.resolve(args.out || 'logs/localized-sense-repair-evidence.json');
const semanticReviewPath = args['semantic-evidence-plan']
  ? requiredPath(args['semantic-evidence-plan'], 'semantic-evidence-plan')
  : null;
const semanticReview = semanticReviewPath ? readJson(semanticReviewPath) : null;
const semanticallyApprovedPairs = semanticReview
  ? new Set((semanticReview.approved || []).map((row) => `${Number(row.product_sense_id)}:${Number(row.source_sense_id)}`))
  : null;

const plan = readJson(planPath);
const db = new Database(productDb, { readonly: true });
db.pragma('busy_timeout = 30000');
db.prepare('ATTACH DATABASE ? AS source_db').run(sourceDb);

const getProductSense = db.prepare(`
  SELECT ps.id AS sense_id, ps.product_entry_id AS entry_id, pe.headword,
         pe.primary_lang, ps.sense_order, ps.part_of_speech, ps.gloss_key,
         ps.status, ps.confidence
  FROM product_senses ps
  JOIN product_entries pe ON pe.id = ps.product_entry_id
  WHERE ps.id = ?
`);
const getProductLocalizations = db.prepare(`
  SELECT lang, term, reading, reading_system, pronunciation,
         pronunciation_system, definition, source, confidence, needs_review
  FROM product_localizations
  WHERE product_sense_id = ?
  ORDER BY lang
`);
const getSourceEvidence = db.prepare(`
  SELECT l.id AS link_id, l.source_entry_id AS snapshot_entry_id,
         l.source_sense_id AS snapshot_sense_id, l.source_lang AS snapshot_lang,
         l.source_word AS snapshot_word, l.match_method, l.confidence AS link_confidence,
         e.id AS source_entry_id, e.word AS source_word, e.source_lang,
         e.frequency_rank AS source_frequency_rank,
         s.id AS source_sense_id, s.sense_order, s.part_of_speech,
         s.gloss_key, s.source, s.confidence AS source_confidence,
         s.needs_review AS source_needs_review
  FROM product_sense_source_links l
  LEFT JOIN source_db.senses s ON s.id = l.source_sense_id
  LEFT JOIN source_db.entries e ON e.id = s.entry_id
  WHERE l.product_sense_id = ?
  ORDER BY l.confidence DESC, l.id
`);
const getSourceLocalizations = db.prepare(`
  SELECT lang, term, reading, reading_system, pronunciation,
         pronunciation_system, definition, usage_note, source,
         confidence, needs_review
  FROM source_db.sense_localizations
  WHERE sense_id = ?
  ORDER BY lang
`);

const repairs = (plan.repairs || []).map((repair) => {
  const productSense = getProductSense.get(repair.sense_id) || null;
  const links = getSourceEvidence.all(repair.sense_id).map((link) => {
    const valid = Boolean(link.source_sense_id) &&
      link.snapshot_entry_id === link.source_entry_id &&
      normalize(link.snapshot_word) === normalize(link.source_word) &&
      normalize(link.snapshot_lang) === normalize(link.source_lang);
    return {
      ...link,
      source_family: sourceFamily(link.source),
      link_valid: valid,
      semantic_alignment_approved: !semanticallyApprovedPairs ||
        semanticallyApprovedPairs.has(`${Number(repair.sense_id)}:${Number(link.source_sense_id)}`),
      localizations: link.source_sense_id ? getSourceLocalizations.all(link.source_sense_id) : []
    };
  });
  const validLinks = links.filter((link) => link.link_valid && !link.source_needs_review &&
    link.semantic_alignment_approved);
  const families = [...new Set(validLinks.map((link) => link.source_family).filter(Boolean))];
  const productLocalizations = getProductLocalizations.all(repair.sense_id);
  const languageFamilies = {};
  for (const link of validLinks) {
    if (link.source_lang) {
      const sourceLanguageBucket = languageFamilies[link.source_lang] ||= new Set();
      sourceLanguageBucket.add(link.source_family);
    }
    for (const localization of link.localizations) {
      const bucket = languageFamilies[localization.lang] ||= new Set();
      bucket.add(link.source_family);
    }
  }
  const structuredTargets = (repair.target_localizations || []).map((target) => target.lang).filter(Boolean);
  const targetLanguages = [...new Set(structuredTargets.length
    ? structuredTargets
    : (repair.query_forms || []).map((form) => form.lang).filter(Boolean))];
  const replacementTermCandidates = Object.fromEntries(targetLanguages.map((lang) => {
    const support = new Map();
    const addTermSupport = (term, link) => {
      const key = normalize(term);
      if (!key) return;
      const row = support.get(key) || { term, source_families: new Set(), evidence_link_ids: new Set() };
      row.source_families.add(link.source_family);
      row.evidence_link_ids.add(link.link_id);
      support.set(key, row);
    };
    for (const link of validLinks) {
      if (link.source_lang === lang) {
        for (const term of splitTerms(link.source_word)) addTermSupport(term, link);
      }
      for (const localization of link.localizations.filter((row) => row.lang === lang)) {
        for (const term of splitTerms(localization.term)) addTermSupport(term, link);
      }
    }
    return [lang, [...support.values()]
      .filter((row) => row.source_families.size >= 2 || [...row.source_families].some(isAuthoritativeFamily))
      .map((row) => ({
        term: row.term,
        source_families: [...row.source_families].sort(),
        evidence_link_ids: [...row.evidence_link_ids].sort((a,b)=>a-b),
        support_policy: row.source_families.size >= 2
          ? 'dual_family'
          : 'semantically_aligned_authoritative_source'
      }))];
  }));
  return {
    ...repair,
    product_sense: productSense,
    product_identity_matches_plan: Boolean(productSense) &&
      productSense.entry_id === repair.entry_id &&
      normalize(productSense.headword) === normalize(repair.headword),
    product_localizations: productLocalizations,
    source_evidence: links,
    evidence_summary: {
      links: links.length,
      valid_links: validLinks.length,
      independent_source_families: families,
      source_family_count: families.length,
      language_source_families: Object.fromEntries(
        Object.entries(languageFamilies).map(([lang, values]) => [lang, [...values]])
      ),
      replacement_term_candidates: replacementTermCandidates,
      eligible_for_model_patch_proposal: Boolean(productSense) &&
        families.length >= 2 &&
        targetLanguages.length > 0 &&
        targetLanguages.every((lang) => replacementTermCandidates[lang]?.length > 0)
    }
  };
});

const output = {
  ok: repairs.every((repair) => repair.product_identity_matches_plan),
  created_at: new Date().toISOString(),
  database_write: false,
  inputs: {
    plan: relative(planPath),
    product_db: relative(productDb),
    source_db: relative(sourceDb),
    semantic_evidence_plan: semanticReviewPath ? relative(semanticReviewPath) : null
  },
  summary: {
    repairs: repairs.length,
    identity_matches: repairs.filter((repair) => repair.product_identity_matches_plan).length,
    with_valid_source_evidence: repairs.filter((repair) => repair.evidence_summary.valid_links > 0).length,
    with_two_independent_families: repairs.filter(
      (repair) => repair.evidence_summary.source_family_count >= 2
    ).length,
    eligible_for_model_patch_proposal: repairs.filter(
      (repair) => repair.evidence_summary.eligible_for_model_patch_proposal
    ).length
  },
  repairs
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

function isAuthoritativeFamily(family) {
  return ['cc-cedict', 'jmdict', 'wordnet', 'freedict'].includes(family);
}

function normalize(value) { return String(value || '').trim().toLowerCase(); }
function splitTerms(value) { return String(value || '').split(/[;,；、|/]+/u).map((item) => item.trim()).filter(Boolean); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function relative(file) { return path.relative(process.cwd(), file); }
function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const file = path.resolve(value);
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  return file;
}
function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) parsed[key] = argv[++index];
    else parsed[key] = 'true';
  }
  return parsed;
}
