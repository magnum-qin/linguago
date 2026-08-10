import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const dbPath = requiredPath(args.db, 'db');
const checkpointPath = requiredPath(args.checkpoint, 'checkpoint');
const outPath = path.resolve(args.out || 'logs/product-source-gap-checkpoint-generation.json');
const reportPath = args.report ? requiredPath(args.report, 'report') : null;
const checkpoint = readJson(checkpointPath);
const checkpointItems = Object.values(checkpoint.items || {});
const acceptedItems = checkpointItems.filter(
  (item) => item?.status === 'accepted' && item?.promote_allowed !== false
);
const noPromoteAcceptedItems = checkpointItems.filter(
  (item) => item?.status === 'accepted' && item?.promote_allowed === false
);
const reviewedAnchors = reportPath
  ? new Map(
      (readJson(reportPath).selected || [])
        .filter((row) => row?.source_entry_id && row?.candidate_evidence_review?.english_anchor)
        .map((row) => [Number(row.source_entry_id), row.candidate_evidence_review.english_anchor])
    )
  : new Map();

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
db.pragma('query_only = ON');
const loadSense = db.prepare(`
  SELECT pe.id AS product_entry_id, pe.headword, pe.normalized_key, pe.primary_lang,
         pe.frequency_rank, pe.status AS entry_status, ps.id AS product_sense_id,
         ps.part_of_speech, ps.gloss_key, ps.status AS sense_status
  FROM product_senses ps
  JOIN product_entries pe ON pe.id = ps.product_entry_id
  WHERE ps.id = ?
`);
const loadLocalizations = db.prepare(`
  SELECT lang, term, reading, reading_system, pronunciation, pronunciation_system,
         definition, source, confidence, needs_review
  FROM product_localizations
  WHERE product_sense_id = ?
  ORDER BY lang
`);
const loadLinks = db.prepare(`
  SELECT source_entry_id, source_sense_id, source_lang, source_word,
         source_frequency_rank, confidence, match_method
  FROM product_sense_source_links
  WHERE product_sense_id = ?
  ORDER BY id
`);

const generated = [];
const errors = [];
for (const item of acceptedItems) {
  const sense = loadSense.get(Number(item.product_sense_id));
  const localizations = sense ? loadLocalizations.all(sense.product_sense_id) : [];
  const links = sense ? loadLinks.all(sense.product_sense_id) : [];
  const sourceLink = links.find((link) => Number(link.source_entry_id) === Number(item.source_entry_id)) || links[0];
  const rowErrors = [];
  if (!sense) rowErrors.push('missing_product_sense');
  if (sense && sense.sense_status !== 'draft_single_source') rowErrors.push('sense_not_draft');
  // A new draft sense may legitimately attach to an existing published entry.
  // Only the sense/localizations must remain unpublished until promotion.
  if (sense && !new Set(['draft_single_source', 'accepted']).has(sense.entry_status)) {
    rowErrors.push('entry_not_draft_or_accepted');
  }
  if (!sourceLink) rowErrors.push('missing_source_link');
  if (localizations.length !== 4 || new Set(localizations.map((row) => row.lang)).size !== 4) {
    rowErrors.push('localization_count_not_four');
  }
  if (localizations.some((row) => Number(row.needs_review) !== 1)) rowErrors.push('draft_localization_not_review');
  if (rowErrors.length) {
    errors.push({ source_entry_id: item.source_entry_id, product_sense_id: item.product_sense_id, errors: rowErrors });
    continue;
  }
  generated.push({
    source_entry_id: Number(item.source_entry_id),
    word: sense.headword,
    source_lang: sense.primary_lang,
    frequency_rank: sense.frequency_rank,
    endpoint: item.endpoint || null,
    attempts: item.attempts || 1,
    seconds: item.seconds ?? null,
    infrastructure_failure: false,
    valid: true,
    errors: [],
    product_entry_id: Number(sense.product_entry_id),
    product_sense_id: Number(sense.product_sense_id),
    output: {
      headword: sense.headword,
      normalized_key: sense.normalized_key,
      primary_lang: sense.primary_lang,
      frequency_rank: sense.frequency_rank,
      part_of_speech: sense.part_of_speech,
      gloss_key: sense.gloss_key,
      source_evidence_valid: true,
      source_evidence_reason: null,
      localizations: Object.fromEntries(
        localizations.map((row) => [
          row.lang,
          {
            term: row.term,
            reading: row.reading,
            reading_system: row.reading_system,
            pronunciation: row.pronunciation,
            pronunciation_system: row.pronunciation_system,
            definition: row.definition,
            source: row.source,
            confidence: row.confidence
          }
        ])
      ),
      source_entry_id: Number(sourceLink.source_entry_id),
      source_sense_id: Number(sourceLink.source_sense_id),
      source_word: sourceLink.source_word,
      source_frequency_rank: sourceLink.source_frequency_rank,
      source_meaning_anchor: reviewedAnchors.get(Number(sourceLink.source_entry_id)) || sense.gloss_key
    }
  });
}
db.close();

if (errors.length) throw new Error(`Checkpoint export found ${errors.length} invalid drafts: ${JSON.stringify(errors.slice(0, 5))}`);
const uniqueSenseIds = new Set(generated.map((row) => row.product_sense_id));
const uniqueSourceSenseIds = new Set(generated.map((row) => row.output.source_sense_id));
if (uniqueSenseIds.size !== generated.length || uniqueSourceSenseIds.size !== generated.length) {
  throw new Error('Checkpoint export contains duplicate product or source sense IDs');
}

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  db: path.relative(process.cwd(), dbPath),
  checkpoint: path.relative(process.cwd(), checkpointPath),
  source_review_report: reportPath ? path.relative(process.cwd(), reportPath) : null,
  stats: {
    checkpoint_completed: Object.keys(checkpoint.items || {}).length,
    checkpoint_accepted: acceptedItems.length + noPromoteAcceptedItems.length,
    checkpoint_publishable_accepted: acceptedItems.length,
    checkpoint_no_promote_accepted: noPromoteAcceptedItems.length,
    generated: generated.length,
    accepted: generated.length,
    rejected: 0,
    unique_product_sense_ids: uniqueSenseIds.size,
    unique_source_sense_ids: uniqueSourceSenseIds.size
  },
  generated
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), stats: output.stats }, null, 2));

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) throw new Error(`${name} not found: ${resolved}`);
  return resolved;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index += 1;
    } else parsed[key] = true;
  }
  return parsed;
}
