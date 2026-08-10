import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB = 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const DEFAULT_OUT = 'logs/product-duplicate-sense-report.json';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const outPath = path.resolve(args.out || DEFAULT_OUT);
const sampleLimit = Number.parseInt(args.samples || '80', 10);

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath, { readonly: true });

const duplicateRows = db
  .prepare(
    `
      SELECT pe.id AS entry_id,
             pe.headword,
             pe.primary_lang,
             pe.frequency_rank,
             pl.lang,
             lower(trim(pl.term)) AS term_key,
             lower(trim(pl.definition)) AS definition_key,
             COUNT(*) AS duplicate_count,
             group_concat(ps.id, ',') AS sense_ids
      FROM product_entries pe
      JOIN product_senses ps ON ps.product_entry_id = pe.id
      JOIN product_localizations pl ON pl.product_sense_id = ps.id
      WHERE ps.status = 'accepted'
        AND COALESCE(pl.needs_review, 0) = 0
        AND COALESCE(trim(pl.term), '') <> ''
        AND COALESCE(trim(pl.definition), '') <> ''
      GROUP BY pe.id, pl.lang, term_key, definition_key
      HAVING COUNT(*) > 1
      ORDER BY pe.frequency_rank IS NULL,
               pe.frequency_rank,
               pe.id,
               pl.lang,
               term_key,
               definition_key
    `
  )
  .all();

const senseById = db.prepare(
  `
    SELECT id, product_entry_id, sense_order, part_of_speech, gloss_key, status
    FROM product_senses
    WHERE id = ?
  `
);
const localizationsBySense = db.prepare(
  `
    SELECT lang, term, reading, reading_system, pronunciation, pronunciation_system, definition, source
    FROM product_localizations
    WHERE product_sense_id = ?
    ORDER BY lang
  `
);
const sourceLinksBySense = db.prepare(
  `
    SELECT source_lang, source_word, source_sense_id, match_method, source_frequency_rank
    FROM product_sense_source_links
    WHERE product_sense_id = ?
    ORDER BY source_lang, lower(source_word), source_sense_id, id
  `
);

const groups = duplicateRows.map((row) => {
  const senseIds = unique(row.sense_ids.split(',').map((id) => Number.parseInt(id, 10))).sort((a, b) => a - b);
  const senses = senseIds.map((id) => describeSense(id));
  const localizationSignatures = unique(senses.map((sense) => sense.localization_signature));
  const sourceSignatures = unique(senses.map((sense) => sense.source_signature));
  const sourceOverlaps = countSourceOverlaps(senses);
  const classification =
    localizationSignatures.length === 1
      ? 'full_duplicate'
      : sourceOverlaps > 0
        ? 'partial_duplicate_with_source_overlap'
        : 'partial_duplicate';

  return {
    classification,
    entry_id: row.entry_id,
    headword: row.headword,
    primary_lang: row.primary_lang,
    frequency_rank: row.frequency_rank,
    duplicate_lang: row.lang,
    duplicate_term: row.term_key,
    duplicate_definition: row.definition_key,
    duplicate_count: row.duplicate_count,
    source_overlaps: sourceOverlaps,
    localization_signature_count: localizationSignatures.length,
    source_signature_count: sourceSignatures.length,
    senses
  };
});

const classificationCounts = countBy(groups, 'classification');
const affectedSenseIds = new Set(groups.flatMap((group) => group.senses.map((sense) => sense.id)));
const affectedEntries = new Set(groups.map((group) => group.entry_id));

const report = {
  ok: true,
  db: path.relative(process.cwd(), dbPath),
  generated_at: new Date().toISOString(),
  summary: {
    duplicate_localization_groups: groups.length,
    affected_entries: affectedEntries.size,
    affected_senses: affectedSenseIds.size,
    classifications: classificationCounts,
    safe_auto_merge_groups: classificationCounts.full_duplicate || 0,
    needs_review_groups:
      (classificationCounts.partial_duplicate || 0) + (classificationCounts.partial_duplicate_with_source_overlap || 0)
  },
  samples: groups.slice(0, Number.isFinite(sampleLimit) ? sampleLimit : 80),
  groups
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

db.close();

console.log(
  JSON.stringify(
    {
      ok: true,
      out: path.relative(process.cwd(), outPath),
      summary: report.summary
    },
    null,
    2
  )
);

function describeSense(id) {
  const sense = senseById.get(id);
  if (!sense) throw new Error(`Missing product_sense ${id}`);
  const localizations = localizationsBySense.all(id);
  const sourceLinks = sourceLinksBySense.all(id);
  return {
    ...sense,
    localizations,
    source_links: sourceLinks,
    localization_signature: localizations.map(localizationSignature).join('||'),
    source_signature: sourceLinks.map(sourceSignature).join('||')
  };
}

function localizationSignature(row) {
  return [
    normalize(row.lang),
    normalize(row.term),
    normalize(row.reading),
    normalize(row.reading_system),
    normalize(row.pronunciation),
    normalize(row.pronunciation_system),
    normalize(row.definition)
  ].join('\t');
}

function sourceSignature(row) {
  return [normalize(row.source_lang), normalize(row.source_word), normalize(row.source_sense_id)].join('\t');
}

function countSourceOverlaps(senses) {
  const seen = new Map();
  let overlaps = 0;
  for (const sense of senses) {
    for (const link of sense.source_links) {
      const key = sourceSignature(link);
      if (!key.trim()) continue;
      if (seen.has(key) && seen.get(key) !== sense.id) overlaps++;
      else seen.set(key, sense.id);
    }
  }
  return overlaps;
}

function normalize(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase();
}

function unique(values) {
  return [...new Set(values)];
}

function countBy(rows, field) {
  return rows.reduce((acc, row) => {
    acc[row[field]] = (acc[row[field]] || 0) + 1;
    return acc;
  }, {});
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      i++;
    } else {
      parsed[key] = 'true';
    }
  }
  return parsed;
}
