import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const LANGS = ['en', 'pt-BR', 'zh', 'ja'];
const DEFAULT_DB = 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const DEFAULT_REPORT = 'logs/product-coverage-gaps-autopromote-top50-20260622.json';
const SOURCE = 'deterministic:coverage-gap-promote';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const reportPath = path.resolve(args.report || DEFAULT_REPORT);
const limit = Number(args.limit || 20);
const apply = args.apply === true || args.apply === 'true';
const outPath = path.resolve(
  args.out || `logs/product-coverage-gap-promote-${apply ? 'apply' : 'dry-run'}-20260622.json`
);

if (!fs.existsSync(dbPath)) throw new Error(`Product DB not found: ${dbPath}`);
if (!fs.existsSync(reportPath)) throw new Error(`Gap report not found: ${reportPath}`);

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const selected = (report.selected || []).slice(0, limit);
const now = new Date().toISOString();

const candidates = selected.map(validateCandidate);
const accepted = candidates.filter((item) => item.valid);
const rejected = candidates.filter((item) => !item.valid);

const stats = {
  db: path.relative(process.cwd(), dbPath),
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
  localizations_upserted: 0,
  examples_inserted: 0,
  examples_reused: 0,
  example_localizations_upserted: 0
};

if (apply && accepted.length) applyPromotions(accepted, stats);

const output = {
  ok: rejected.length === 0,
  stats,
  rejected: rejected.map(({ candidate, errors }) => ({
    source_entry_id: candidate.source_entry_id,
    word: candidate.word,
    source_lang: candidate.source_lang,
    errors
  })),
  accepted_preview: accepted.slice(0, 30).map(({ candidate }) => ({
    source_entry_id: candidate.source_entry_id,
    word: candidate.word,
    source_lang: candidate.source_lang,
    frequency_rank: candidate.frequency_rank,
    first_sense_id: candidate.first_sense_id,
    gloss_key: candidate.gloss_key,
    localizations: candidate.first_sense_localizations.map((row) => ({
      lang: row.lang,
      term: row.term,
      reading: row.reading,
      definition: row.definition
    }))
  }))
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
console.log(JSON.stringify({ ok: output.ok, out: path.relative(process.cwd(), outPath), stats }, null, 2));

function validateCandidate(candidate) {
  const errors = [];
  if (!candidate?.source_entry_id) errors.push('missing_source_entry_id');
  if (!candidate?.first_sense_id) errors.push('missing_first_sense_id');
  if (!LANGS.includes(candidate.source_lang)) errors.push('invalid_source_lang');
  if (!nonEmpty(candidate.word)) errors.push('missing_word');
  if (!nonEmpty(candidate.normalized_key)) errors.push('missing_normalized_key');
  if (!nonEmpty(candidate.gloss_key)) errors.push('missing_gloss_key');
  const locs = candidate.first_sense_localizations || [];
  for (const lang of LANGS) {
    const loc = locs.find((row) => row.lang === lang && !row.needs_review);
    if (!loc) {
      errors.push(`missing_clean_loc_${lang}`);
      continue;
    }
    if (!nonEmpty(loc.term)) errors.push(`missing_term_${lang}`);
    if (!nonEmpty(loc.definition)) errors.push(`missing_definition_${lang}`);
    if (lang === 'zh' && !nonEmpty(loc.reading)) errors.push('missing_zh_reading');
    if (lang === 'ja' && !nonEmpty(loc.reading)) errors.push('missing_ja_reading');
  }
  const sourceLoc = locs.find((row) => row.lang === candidate.source_lang && !row.needs_review);
  if (sourceLoc && normalize(sourceLoc.term) !== normalize(candidate.word)) {
    errors.push('source_term_does_not_match_headword');
  }
  return { candidate, valid: errors.length === 0, errors };
}

function applyPromotions(items, stats) {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 30000');

  const statements = {
    getEntry: db.prepare('SELECT id FROM product_entries WHERE group_key = ?'),
    insertEntry: db.prepare(`
      INSERT INTO product_entries
        (headword, normalized_key, primary_lang, frequency_rank, group_key, group_method, status, source_count, lang_count, created_at)
      VALUES
        (@headword, @normalized_key, @primary_lang, @frequency_rank, @group_key, 'coverage_gap_promote', 'accepted', 1, 4, @created_at)
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
        (@product_sense_id, @source_entry_id, @source_sense_id, @source_lang, @source_word, @source_frequency_rank, 'coverage_gap_promote', @confidence)
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
    `),
    getExample: db.prepare('SELECT id FROM product_examples WHERE product_sense_id = ? AND source_example_id = ?'),
    insertExample: db.prepare(`
      INSERT INTO product_examples
        (product_sense_id, source_example_id, example_order, source_lang, source_text, source, confidence, needs_review)
      VALUES
        (@product_sense_id, @source_example_id, @example_order, @source_lang, @source_text, @source, @confidence, 0)
    `),
    upsertExampleLocalization: db.prepare(`
      INSERT INTO product_example_localizations
        (product_example_id, lang, text, reading, source, confidence, needs_review)
      VALUES
        (@product_example_id, @lang, @text, @reading, @source, @confidence, 0)
      ON CONFLICT(product_example_id, lang) DO UPDATE SET
        text = excluded.text,
        reading = excluded.reading,
        source = excluded.source,
        confidence = excluded.confidence,
        needs_review = 0
    `)
  };

  db.transaction(() => {
    for (const { candidate } of items) {
      const groupKey = `coverage-gap:${candidate.source_lang}:${candidate.normalized_key}`;
      let entryId = statements.getEntry.get(groupKey)?.id;
      if (entryId) {
        stats.entries_reused++;
      } else {
        entryId = Number(
          statements.insertEntry.run({
            headword: candidate.word,
            normalized_key: candidate.normalized_key,
            primary_lang: candidate.source_lang,
            frequency_rank: candidate.frequency_rank,
            group_key: groupKey,
            created_at: now
          }).lastInsertRowid
        );
        stats.entries_inserted++;
      }

      let senseId = statements.getSense.get(entryId, candidate.gloss_key)?.id;
      if (senseId) {
        stats.senses_reused++;
      } else {
        senseId = Number(
          statements.insertSense.run({
            product_entry_id: entryId,
            part_of_speech: candidate.part_of_speech,
            gloss_key: candidate.gloss_key,
            confidence: 0.8,
            created_at: now
          }).lastInsertRowid
        );
        stats.senses_inserted++;
      }

      const linkChanges = statements.insertLink.run({
        product_sense_id: senseId,
        source_entry_id: candidate.source_entry_id,
        source_sense_id: candidate.first_sense_id,
        source_lang: candidate.source_lang,
        source_word: candidate.word,
        source_frequency_rank: candidate.frequency_rank,
        confidence: 0.8
      }).changes;
      stats.source_links_inserted += linkChanges;

      for (const lang of LANGS) {
        const loc = candidate.first_sense_localizations.find((row) => row.lang === lang && !row.needs_review);
        statements.upsertLocalization.run({
          product_sense_id: senseId,
          lang,
          term: loc.term,
          reading: loc.reading || null,
          reading_system: loc.reading_system || null,
          pronunciation: loc.pronunciation || null,
          pronunciation_system: loc.pronunciation_system || null,
          definition: loc.definition,
          source: `${SOURCE}:${candidate.first_sense_id}`,
          confidence: 0.8
        });
        stats.localizations_upserted++;
      }

      const example = (candidate.example_samples || []).find((row) => !row.needs_review && nonEmpty(row.source_text));
      if (example) {
        let exampleId = statements.getExample.get(senseId, example.id)?.id;
        if (exampleId) {
          stats.examples_reused++;
        } else {
          exampleId = Number(
            statements.insertExample.run({
              product_sense_id: senseId,
              source_example_id: example.id,
              example_order: example.example_order || 1,
              source_lang: example.source_lang,
              source_text: example.source_text,
              source: `${SOURCE}:${candidate.first_sense_id}`,
              confidence: 0.75
            }).lastInsertRowid
          );
          stats.examples_inserted++;
        }
        for (const loc of example.localizations || []) {
          if (loc.needs_review || !nonEmpty(loc.text) || !LANGS.includes(loc.lang)) continue;
          statements.upsertExampleLocalization.run({
            product_example_id: exampleId,
            lang: loc.lang,
            text: loc.text,
            reading: loc.reading || null,
            source: `${SOURCE}:${candidate.first_sense_id}`,
            confidence: 0.75
          });
          stats.example_localizations_upserted++;
        }
      }
    }
  })();

  db.close();
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

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) result[key] = true;
    else {
      result[key] = next;
      index++;
    }
  }
  return result;
}
