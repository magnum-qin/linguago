import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const sourceDbPath = path.resolve(args['source-db'] || 'data/processed/linguago_v2_full.db');
const productDbPath = path.resolve(
  args['product-db'] || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db'
);
const configPath = path.resolve(
  args.config || 'config/dictionary-overrides/source-gap-targeted-canonical-senses-v90.json'
);
const outPath = path.resolve(args.out || 'logs/product-source-gap-v90-targeted-canonical-senses.json');

for (const filePath of [sourceDbPath, productDbPath, configPath]) {
  if (!fs.existsSync(filePath)) throw new Error(`Required file not found: ${filePath}`);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
if (!Array.isArray(config.candidates) || !config.candidates.length) {
  throw new Error('Targeted candidate config must contain candidates[]');
}

const sourceDb = new Database(sourceDbPath, { readonly: true, fileMustExist: true });
const productDb = new Database(productDbPath, { readonly: true, fileMustExist: true });
sourceDb.pragma('query_only = ON');
productDb.pragma('query_only = ON');

const loadCandidate = sourceDb.prepare(`
  SELECT e.id AS source_entry_id, e.word, e.normalized_key, e.source_lang,
         e.frequency_rank, e.status AS source_status, s.id AS source_sense_id,
         s.sense_order, s.part_of_speech, s.gloss_key, s.source,
         s.confidence, s.needs_review
  FROM entries e
  JOIN senses s ON s.entry_id = e.id
  WHERE e.id = ? AND s.id = ?
`);
const loadLocalizations = sourceDb.prepare(`
  SELECT lang, term, reading, reading_system, pronunciation,
         pronunciation_system, definition, source, confidence, needs_review
  FROM sense_localizations
  WHERE sense_id = ?
  ORDER BY needs_review, lang, id
`);
const loadExamples = sourceDb.prepare(`
  SELECT id, example_order, source_lang, source_text, source_reading,
         source, confidence, needs_review
  FROM examples
  WHERE sense_id = ? AND needs_review = 0
  ORDER BY example_order, id
  LIMIT 2
`);
const loadExampleLocalizations = sourceDb.prepare(`
  SELECT lang, text, reading, source, confidence, needs_review
  FROM example_localizations
  WHERE example_id = ? AND needs_review = 0
  ORDER BY lang, id
`);
const loadSourceLinks = sourceDb.prepare(`
  SELECT ssl.source_sense_id, ssl.match_method, ssl.confidence,
         ds.source_key, se.word AS source_word, se.lang AS source_lang,
         ss.part_of_speech, ss.gloss
  FROM sense_source_links ssl
  JOIN source_senses ss ON ss.id = ssl.source_sense_id
  JOIN source_entries se ON se.id = ss.source_entry_id
  JOIN dictionary_sources ds ON ds.id = se.source_id
  WHERE ssl.sense_id = ?
  ORDER BY ds.source_key, ss.id
`);
const findProductCoverage = productDb.prepare(`
  SELECT pe.id AS product_entry_id, pe.headword, pe.primary_lang, 'entry' AS match_type
  FROM product_entries pe
  WHERE pe.primary_lang = ? AND lower(trim(pe.normalized_key)) = lower(trim(?))
  UNION ALL
  SELECT pe.id, pe.headword, pe.primary_lang, 'localization'
  FROM product_localizations pl
  JOIN product_senses ps ON ps.id = pl.product_sense_id
  JOIN product_entries pe ON pe.id = ps.product_entry_id
  WHERE pl.lang = ? AND lower(trim(pl.term)) = lower(trim(?)) AND pl.needs_review = 0
  LIMIT 1
`);

const selected = [];
const rejected = [];
for (const requested of config.candidates) {
  const entryId = positiveInteger(requested.source_entry_id, 'source_entry_id');
  const senseId = positiveInteger(requested.source_sense_id, 'source_sense_id');
  const row = loadCandidate.get(entryId, senseId);
  if (!row) {
    rejected.push({ source_entry_id: entryId, source_sense_id: senseId, reason: 'source_sense_not_found' });
    continue;
  }
  if (normalize(row.word) !== normalize(requested.word) || row.source_lang !== requested.lang) {
    rejected.push({
      source_entry_id: entryId,
      source_sense_id: senseId,
      reason: 'configured_identity_mismatch',
      actual_word: row.word,
      actual_lang: row.source_lang
    });
    continue;
  }
  const covered = findProductCoverage.get(row.source_lang, row.normalized_key, row.source_lang, row.word);
  if (covered) {
    rejected.push({
      source_entry_id: entryId,
      source_sense_id: senseId,
      reason: 'already_covered_in_product',
      product_match: covered
    });
    continue;
  }
  const localizations = loadLocalizations.all(senseId).filter(isCleanLocalization).map(compactLocalization);
  const cleanLangs = [...new Set(localizations.map((localization) => localization.lang))].sort();
  const sourceLinks = loadSourceLinks.all(senseId);
  if (!sourceLinks.length) {
    rejected.push({ source_entry_id: entryId, source_sense_id: senseId, reason: 'missing_source_links' });
    continue;
  }
  const examples = loadExamples.all(senseId).map((example) => ({
    ...example,
    localizations: loadExampleLocalizations.all(example.id)
  }));
  selected.push({
    source_entry_id: entryId,
    word: row.word,
    normalized_key: row.normalized_key,
    source_lang: row.source_lang,
    frequency_rank: row.frequency_rank,
    source_status: row.source_status,
    first_sense_id: senseId,
    candidate_key: `${entryId}:${senseId}`,
    first_sense_order: row.sense_order,
    part_of_speech: row.part_of_speech || null,
    gloss_key: row.gloss_key,
    gloss_preview: preview(row.gloss_key, 180),
    first_sense_clean_localization_langs: cleanLangs,
    first_sense_clean_localization_lang_count: cleanLangs.length,
    first_sense_localizations: localizations,
    example_samples: examples,
    targeted_source_links: sourceLinks,
    reviewed_form_evidence: requested.reviewed_form_evidence || [],
    quality_bucket: 'targeted_reviewed_source_sense',
    quality_reasons: ['exact_source_sense_config', 'product_coverage_missing', 'source_links_present'],
    sense_alignment: {
      status: 'aligned',
      policy: 'configured_exact_source_sense',
      original_sense_id: senseId,
      aligned_sense_id: senseId,
      changed: false,
      eligible_sense_count: 1,
      aligned_clean_lang_count: cleanLangs.length,
      candidates: [
        {
          sense_id: senseId,
          sense_order: row.sense_order,
          source: row.source,
          confidence: Number(row.confidence || 0),
          gloss_key: row.gloss_key,
          clean_langs: cleanLangs,
          clean_lang_count: cleanLangs.length,
          source_term_exact: localizations.some(
            (localization) => localization.lang === row.source_lang && normalize(localization.term) === normalize(row.word)
          ),
          accepted_product_link: null
        }
      ]
    }
  });
}

sourceDb.close();
productDb.close();

const report = {
  ok: rejected.length === 0,
  generated_at: new Date().toISOString(),
  source_db: path.relative(process.cwd(), sourceDbPath),
  product_db: path.relative(process.cwd(), productDbPath),
  config: path.relative(process.cwd(), configPath),
  policy: {
    exact_source_entry_and_sense_required: true,
    existing_product_coverage_rejected: true,
    source_links_required: true,
    reviewed_form_evidence_is_metadata_only: true,
    writes_database: false
  },
  summary: { requested: config.candidates.length, selected: selected.length, rejected: rejected.length },
  selected_count: selected.length,
  selected,
  rejected
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ ok: report.ok, out: path.relative(process.cwd(), outPath), summary: report.summary, rejected }, null, 2));
if (!report.ok) process.exitCode = 1;

function isCleanLocalization(row) {
  return !row.needs_review && clean(row.term) && clean(row.definition);
}

function compactLocalization(row) {
  return {
    lang: row.lang,
    term: clean(row.term),
    reading: clean(row.reading) || null,
    reading_system: clean(row.reading_system) || null,
    pronunciation: clean(row.pronunciation) || null,
    pronunciation_system: clean(row.pronunciation_system) || null,
    definition: clean(row.definition),
    source: clean(row.source) || null,
    confidence: Number(row.confidence || 0),
    needs_review: Number(row.needs_review || 0)
  };
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer`);
  return number;
}

function normalize(value) {
  return clean(value).normalize('NFKC').toLowerCase();
}

function clean(value) {
  return String(value || '').trim();
}

function preview(value, maxLength) {
  const text = clean(value);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return parsed;
}
