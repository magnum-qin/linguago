import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const LANGS = ['en', 'pt-BR', 'zh', 'ja'];
const DEFAULT_SOURCE_DB = 'data/processed/linguago_v2_full.db';
const DEFAULT_PRODUCT_DB = 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const DEFAULT_REPORT = 'logs/product-incomplete-gap-senses-20260622.json';
const SOURCE = 'deterministic:incomplete-gap-repair';

const args = parseArgs(process.argv.slice(2));
const sourceDbPath = path.resolve(args['source-db'] || DEFAULT_SOURCE_DB);
const productDbPath = path.resolve(args['product-db'] || DEFAULT_PRODUCT_DB);
const reportPath = path.resolve(args.report || DEFAULT_REPORT);
const outPath = path.resolve(
  args.out || `logs/product-incomplete-gap-repair-${args.apply ? 'apply' : 'dry-run'}-20260622.json`
);
const limit = Number(args.limit || 20);
const apply = args.apply === true || args.apply === 'true';
const now = new Date().toISOString();

if (!fs.existsSync(sourceDbPath)) throw new Error(`Source DB not found: ${sourceDbPath}`);
if (!fs.existsSync(productDbPath)) throw new Error(`Product DB not found: ${productDbPath}`);
if (!fs.existsSync(reportPath)) throw new Error(`Report not found: ${reportPath}`);

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const selected = (report.selected || []).filter((row) => row.repairable_from_same_entry).slice(0, limit);

const sourceDb = new Database(sourceDbPath, { readonly: true });
sourceDb.pragma('busy_timeout = 30000');

const entryById = sourceDb.prepare(`
  SELECT id, word, normalized_key, source_lang, frequency_rank, status
  FROM entries
  WHERE id = ?
`);
const senseById = sourceDb.prepare(`
  SELECT id, entry_id, sense_order, part_of_speech, gloss_key, source, confidence, needs_review
  FROM senses
  WHERE id = ?
`);
const usefulSensesByEntry = sourceDb.prepare(`
  SELECT id, entry_id, sense_order, part_of_speech, gloss_key, source, confidence, needs_review
  FROM senses
  WHERE entry_id = ?
    AND NULLIF(TRIM(gloss_key), '') IS NOT NULL
    AND lower(TRIM(gloss_key)) <> 'missing gloss'
  ORDER BY sense_order, id
`);
const localizationsBySense = sourceDb.prepare(`
  SELECT lang, term, reading, reading_system, pronunciation, pronunciation_system, definition, source, confidence, needs_review
  FROM sense_localizations
  WHERE sense_id = ?
  ORDER BY needs_review, lang
`);

const candidates = selected.map(buildCandidate);
sourceDb.close();

const accepted = candidates.filter((item) => item.valid);
const rejected = candidates.filter((item) => !item.valid);

const stats = {
  source_db: path.relative(process.cwd(), sourceDbPath),
  product_db: path.relative(process.cwd(), productDbPath),
  report: path.relative(process.cwd(), reportPath),
  apply,
  selected: selected.length,
  accepted: accepted.length,
  rejected: rejected.length,
  entries_inserted: 0,
  entries_reused: 0,
  senses_inserted: 0,
  senses_reused: 0,
  source_links_inserted: 0,
  localizations_upserted: 0
};

if (apply && accepted.length) applyRepairs(accepted, stats);

const output = {
  ok: rejected.length === 0,
  generated_at: now,
  stats,
  rejected: rejected.map(({ row, errors }) => ({
    source_entry_id: row?.source_entry_id,
    word: row?.word,
    source_lang: row?.source_lang,
    errors
  })),
  accepted_preview: accepted.map(({ candidate }) => ({
    source_entry_id: candidate.entry.id,
    word: candidate.entry.word,
    source_lang: candidate.entry.source_lang,
    frequency_rank: candidate.entry.frequency_rank,
    first_sense_id: candidate.firstSense.id,
    borrowed_from_sense_ids: [...new Set(candidate.localizations.map((loc) => loc.source_sense_id))],
    localizations: candidate.localizations.map((loc) => ({
      lang: loc.lang,
      term: loc.term,
      reading: loc.reading,
      source_sense_id: loc.source_sense_id,
      definition: preview(loc.definition, 140)
    }))
  }))
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
console.log(JSON.stringify({ ok: output.ok, out: path.relative(process.cwd(), outPath), stats }, null, 2));

function buildCandidate(row) {
  const errors = [];
  const entry = entryById.get(row.source_entry_id);
  if (!entry) errors.push('missing_source_entry');
  const firstSense = senseById.get(row.first_sense_id);
  if (!firstSense) errors.push('missing_first_sense');
  if (entry && firstSense && firstSense.entry_id !== entry.id) errors.push('first_sense_entry_mismatch');
  if (entry && !sourceScriptOk(entry.word, entry.source_lang)) errors.push('source_script_mismatch');

  if (errors.length) return { row, valid: false, errors };

  const senses = usefulSensesByEntry.all(entry.id);
  const firstLocs = cleanLocalizations(localizationsBySense.all(firstSense.id), firstSense.id);
  const localizations = [];
  for (const lang of LANGS) {
    const firstLoc = firstLocs.find((loc) => loc.lang === lang);
    if (firstLoc) {
      localizations.push(firstLoc);
      continue;
    }
    const borrowed = findBorrowedLocalization(lang, firstSense, senses);
    if (!borrowed) {
      errors.push(`missing_repair_loc_${lang}`);
      continue;
    }
    localizations.push(borrowed);
  }

  for (const lang of LANGS) {
    const loc = localizations.find((item) => item.lang === lang);
    if (!loc) continue;
    if (!nonEmpty(loc.term)) errors.push(`missing_term_${lang}`);
    if (!nonEmpty(loc.definition)) errors.push(`missing_definition_${lang}`);
    if ((lang === 'zh' || lang === 'ja') && !nonEmpty(loc.reading)) errors.push(`missing_reading_${lang}`);
  }

  const sourceLoc = localizations.find((loc) => loc.lang === entry.source_lang);
  if (sourceLoc && normalize(sourceLoc.term) !== normalize(entry.word)) {
    errors.push('source_term_does_not_match_headword');
  }

  return {
    row,
    valid: errors.length === 0,
    errors,
    candidate: {
      entry,
      firstSense,
      localizations
    }
  };
}

function findBorrowedLocalization(lang, firstSense, senses) {
  for (const sense of senses) {
    if (!compatibleGloss(firstSense.gloss_key, sense.gloss_key)) continue;
    const loc = cleanLocalizations(localizationsBySense.all(sense.id), sense.id).find((item) => item.lang === lang);
    if (loc) return loc;
  }
  return null;
}

function cleanLocalizations(rows, senseId) {
  return rows
    .filter((row) => !row.needs_review && LANGS.includes(row.lang) && nonEmpty(row.term) && nonEmpty(row.definition))
    .map((row) => ({
      ...row,
      source_sense_id: senseId,
      needs_review: 0
    }));
}

function applyRepairs(items, stats) {
  const db = new Database(productDbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 30000');

  const statements = {
    getEntry: db.prepare('SELECT id FROM product_entries WHERE group_key = ?'),
    insertEntry: db.prepare(`
      INSERT INTO product_entries
        (headword, normalized_key, primary_lang, frequency_rank, group_key, group_method, status, source_count, lang_count, created_at)
      VALUES
        (@headword, @normalized_key, @primary_lang, @frequency_rank, @group_key, 'incomplete_gap_repair', 'accepted', 1, 4, @created_at)
    `),
    getSense: db.prepare('SELECT id FROM product_senses WHERE product_entry_id = ? AND gloss_key = ?'),
    insertSense: db.prepare(`
      INSERT INTO product_senses
        (product_entry_id, sense_order, part_of_speech, gloss_key, status, confidence, created_at)
      VALUES
        (@product_entry_id, 1, @part_of_speech, @gloss_key, 'accepted', @confidence, @created_at)
    `),
    insertLink: db.prepare(`
      INSERT OR IGNORE INTO product_sense_source_links
        (product_sense_id, source_entry_id, source_sense_id, source_lang, source_word, source_frequency_rank, match_method, confidence)
      VALUES
        (@product_sense_id, @source_entry_id, @source_sense_id, @source_lang, @source_word, @source_frequency_rank, 'incomplete_gap_repair', @confidence)
    `),
    upsertLocalization: db.prepare(`
      INSERT INTO product_localizations
        (product_sense_id, lang, term, reading, reading_system, pronunciation, pronunciation_system, definition, source, confidence, needs_review)
      VALUES
        (@product_sense_id, @lang, @term, @reading, @reading_system, @pronunciation, @pronunciation_system, @definition, @source, @confidence, 0)
      ON CONFLICT(product_sense_id, lang) DO UPDATE SET
        term = excluded.term,
        reading = excluded.reading,
        reading_system = excluded.reading_system,
        pronunciation = excluded.pronunciation,
        pronunciation_system = excluded.pronunciation_system,
        definition = excluded.definition,
        source = excluded.source,
        confidence = excluded.confidence,
        needs_review = 0
    `)
  };

  db.transaction(() => {
    for (const { candidate } of items) {
      const groupKey = `incomplete-gap:${candidate.entry.source_lang}:${normalize(candidate.entry.normalized_key || candidate.entry.word)}`;
      let entryId = statements.getEntry.get(groupKey)?.id;
      if (entryId) {
        stats.entries_reused++;
      } else {
        entryId = Number(
          statements.insertEntry.run({
            headword: candidate.entry.word,
            normalized_key: normalize(candidate.entry.normalized_key || candidate.entry.word),
            primary_lang: candidate.entry.source_lang,
            frequency_rank: candidate.entry.frequency_rank,
            group_key: groupKey,
            created_at: now
          }).lastInsertRowid
        );
        stats.entries_inserted++;
      }

      let senseId = statements.getSense.get(entryId, candidate.firstSense.gloss_key)?.id;
      if (senseId) {
        stats.senses_reused++;
      } else {
        senseId = Number(
          statements.insertSense.run({
            product_entry_id: entryId,
            part_of_speech: candidate.firstSense.part_of_speech,
            gloss_key: candidate.firstSense.gloss_key,
            confidence: 0.78,
            created_at: now
          }).lastInsertRowid
        );
        stats.senses_inserted++;
      }

      const linkIds = [...new Set(candidate.localizations.map((loc) => loc.source_sense_id))];
      for (const sourceSenseId of linkIds) {
        stats.source_links_inserted += statements.insertLink.run({
          product_sense_id: senseId,
          source_entry_id: candidate.entry.id,
          source_sense_id: sourceSenseId,
          source_lang: candidate.entry.source_lang,
          source_word: candidate.entry.word,
          source_frequency_rank: candidate.entry.frequency_rank,
          confidence: 0.78
        }).changes;
      }

      for (const loc of candidate.localizations) {
        statements.upsertLocalization.run({
          product_sense_id: senseId,
          lang: loc.lang,
          term: loc.term,
          reading: loc.reading || null,
          reading_system: loc.reading_system || null,
          pronunciation: loc.pronunciation || null,
          pronunciation_system: loc.pronunciation_system || null,
          definition: loc.definition,
          source: `${SOURCE}:${loc.source_sense_id}`,
          confidence: 0.78
        });
        stats.localizations_upserted++;
      }
    }
  })();

  db.close();
}

function compatibleGloss(a, b) {
  const left = normalizeGloss(a);
  const right = normalizeGloss(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 5 && right.includes(left)) return true;
  if (right.length >= 5 && left.includes(right)) return true;
  return false;
}

function normalizeGloss(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/gu, ' ')
    .trim();
}

function sourceScriptOk(word, lang) {
  const text = String(word || '').trim();
  if (!text) return false;
  const hasLatin = /\p{Script=Latin}/u.test(text);
  const hasHan = /\p{Script=Han}/u.test(text);
  const hasHiragana = /\p{Script=Hiragana}/u.test(text);
  const hasKatakana = /\p{Script=Katakana}/u.test(text);
  const hasKana = hasHiragana || hasKatakana || /[\u30fc\uff70]/u.test(text);
  if (lang === 'zh') return hasHan && !hasKana;
  if (lang === 'ja') return hasHan || hasKana;
  if (lang === 'en' || lang === 'pt-BR') return !hasHan && !hasKana && hasLatin;
  return true;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase();
}

function preview(value, length) {
  const text = String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const keyName = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) result[keyName] = true;
    else {
      result[keyName] = next;
      index++;
    }
  }
  return result;
}
