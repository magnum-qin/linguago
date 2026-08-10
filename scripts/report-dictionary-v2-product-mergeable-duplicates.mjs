import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB = 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const DEFAULT_OUT = 'logs/product-mergeable-duplicate-senses-20260624.json';
const LANGS = ['en', 'pt-BR', 'zh', 'ja'];

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const outPath = path.resolve(args.out || DEFAULT_OUT);

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath, { readonly: true });

const senses = db
  .prepare(
    `
    SELECT ps.id, ps.product_entry_id, ps.sense_order, ps.gloss_key, ps.part_of_speech,
           pe.headword, pe.primary_lang, pe.frequency_rank
    FROM product_senses ps
    JOIN product_entries pe ON pe.id = ps.product_entry_id
    WHERE ps.status = 'accepted'
    ORDER BY pe.frequency_rank IS NULL, pe.frequency_rank, pe.id, ps.sense_order, ps.id
  `
  )
  .all();

const localizationsStmt = db.prepare(`
  SELECT lang, term, definition, reading, reading_system, pronunciation, pronunciation_system
  FROM product_localizations
  WHERE product_sense_id = ?
    AND needs_review = 0
  ORDER BY lang
`);
const sourceLinksStmt = db.prepare(`
  SELECT source_lang, source_word, source_sense_id, match_method
  FROM product_sense_source_links
  WHERE product_sense_id = ?
  ORDER BY source_lang, source_word, source_sense_id
`);

const byEntry = new Map();
for (const sense of senses) {
  const localizations = localizationsStmt.all(sense.id);
  if (new Set(localizations.map((row) => row.lang)).size !== LANGS.length) continue;
  const item = {
    ...sense,
    localizations,
    source_links: sourceLinksStmt.all(sense.id),
    term_signature: LANGS.map((lang) => `${lang}:${norm(localizations.find((row) => row.lang === lang)?.term)}`).join(
      '|'
    ),
    semantic_signature: LANGS.map((lang) => {
      const loc = localizations.find((row) => row.lang === lang);
      return `${lang}:${norm(loc?.term)}=${norm(loc?.definition)}`;
    }).join('|')
  };
  if (!byEntry.has(sense.product_entry_id)) byEntry.set(sense.product_entry_id, []);
  byEntry.get(sense.product_entry_id).push(item);
}

const candidates = [];
for (const entrySenses of byEntry.values()) {
  for (let leftIndex = 0; leftIndex < entrySenses.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < entrySenses.length; rightIndex++) {
      const left = entrySenses[leftIndex];
      const right = entrySenses[rightIndex];
      const classification = classifyPair(left, right);
      if (!classification.mergeable) continue;
      candidates.push({
        entry_id: left.product_entry_id,
        headword: left.headword,
        primary_lang: left.primary_lang,
        frequency_rank: left.frequency_rank,
        keep_sense_id: chooseKeeper(left, right).id,
        remove_sense_id: chooseKeeper(left, right).id === left.id ? right.id : left.id,
        reason: classification.reason,
        confidence: classification.confidence,
        senses: [summarizeSense(left), summarizeSense(right)]
      });
    }
  }
}

const report = {
  ok: true,
  db: path.relative(process.cwd(), dbPath),
  generated_at: new Date().toISOString(),
  summary: {
    mergeable_pairs: candidates.length,
    affected_entries: new Set(candidates.map((row) => row.entry_id)).size,
    by_reason: countBy(candidates.map((row) => row.reason))
  },
  candidates
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
db.close();

console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary: report.summary }, null, 2));

function classifyPair(left, right) {
  if (left.semantic_signature === right.semantic_signature) {
    return { mergeable: true, reason: 'four_lang_term_definition_exact', confidence: 0.98 };
  }
  if (left.term_signature === right.term_signature && matchingDefinitions(left, right) >= 3) {
    return { mergeable: true, reason: 'four_lang_terms_and_three_definitions_match', confidence: 0.92 };
  }
  if (left.term_signature === right.term_signature && sourceOverlap(left, right)) {
    return { mergeable: true, reason: 'four_lang_terms_and_source_overlap', confidence: 0.88 };
  }
  return { mergeable: false, reason: '', confidence: 0 };
}

function matchingDefinitions(left, right) {
  let matches = 0;
  for (const lang of LANGS) {
    const a = left.localizations.find((row) => row.lang === lang);
    const b = right.localizations.find((row) => row.lang === lang);
    if (norm(a?.definition) === norm(b?.definition)) matches++;
  }
  return matches;
}

function sourceOverlap(left, right) {
  const leftKeys = new Set(
    left.source_links.map((row) => `${row.source_lang}:${norm(row.source_word)}:${row.source_sense_id}`)
  );
  return right.source_links.some((row) =>
    leftKeys.has(`${row.source_lang}:${norm(row.source_word)}:${row.source_sense_id}`)
  );
}

function chooseKeeper(left, right) {
  if (left.sense_order !== right.sense_order) return left.sense_order < right.sense_order ? left : right;
  return left.id < right.id ? left : right;
}

function summarizeSense(sense) {
  return {
    id: sense.id,
    sense_order: sense.sense_order,
    gloss_key: sense.gloss_key,
    source_links: sense.source_links,
    localizations: Object.fromEntries(
      sense.localizations.map((row) => [row.lang, { term: row.term, definition: row.definition }])
    )
  };
}

function norm(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase();
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index++;
    } else {
      parsed[key] = 'true';
    }
  }
  return parsed;
}
