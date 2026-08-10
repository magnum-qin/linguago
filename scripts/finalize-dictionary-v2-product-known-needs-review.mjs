import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB = 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const dryRun = args['dry-run'] !== 'false';

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000');

const source = 'known-needs-review-finalize-20260620';

const localizationFixes = [
  {
    sense_id: 1487,
    lang: 'ja',
    term: '〜士',
    reading: '〜し',
    reading_system: 'kana',
    pronunciation: null,
    pronunciation_system: null,
    definition: '職業・専門・信奉者などを表す接尾辞。'
  },
  {
    sense_id: 2572,
    lang: 'pt-BR',
    term: 'cão',
    reading: null,
    reading_system: null,
    pronunciation: '/kɐ̃w/',
    pronunciation_system: 'IPA',
    definition: 'Mamífero carnívoro domesticado, geralmente criado como animal de companhia, guarda ou trabalho.'
  }
];

const notPublishableSenseIds = [
  292, // Japanese suffix -人 as "-ian"; no clean standalone Chinese term.
  841, // Japanese familiar name suffix べ; no clean standalone Chinese term.
  1922 // Japanese 妻 as sashimi garnish; Chinese equivalent is descriptive rather than a stable lexical term.
];

const statements = {
  findLocalization: db.prepare('SELECT id FROM product_localizations WHERE product_sense_id = ? AND lang = ?'),
  updateLocalization: db.prepare(`
    UPDATE product_localizations
    SET term = @term,
        reading = @reading,
        reading_system = @reading_system,
        pronunciation = @pronunciation,
        pronunciation_system = @pronunciation_system,
        definition = @definition,
        source = @source,
        confidence = 0.99,
        needs_review = 0
    WHERE id = @id
  `),
  insertLocalization: db.prepare(`
    INSERT INTO product_localizations
      (product_sense_id, lang, term, reading, reading_system, pronunciation, pronunciation_system, definition, source, confidence, needs_review)
    VALUES
      (@product_sense_id, @lang, @term, @reading, @reading_system, @pronunciation, @pronunciation_system, @definition, @source, 0.99, 0)
  `),
  markSenseNeedsReview: db.prepare(`
    UPDATE product_senses
    SET status = 'needs_review'
    WHERE id = ?
      AND status <> 'accepted'
  `),
  markBadLocalizationsNeedsReview: db.prepare(`
    UPDATE product_localizations
    SET needs_review = 1,
        confidence = MIN(confidence, 0.2),
        source = @source
    WHERE product_sense_id = @sense_id
      AND lang = @lang
  `),
  latestNeedsReviewJobs: db.prepare(`
    SELECT id
    FROM product_llm_completion_jobs
    WHERE prompt_version = 'dictionary-v2-product-needs-review-repair-v2'
      AND status = 'needs_review'
      AND target_id = ?
  `),
  markJobAccepted: db.prepare(`
    UPDATE product_llm_completion_jobs
    SET status = 'accepted',
        error = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `)
};

const stats = {
  db: path.relative(process.cwd(), dbPath),
  dry_run: dryRun,
  localization_fixes: 0,
  localizations_inserted: 0,
  localizations_updated: 0,
  senses_left_for_review: 0,
  jobs_marked_accepted: 0,
  missing_localization_senses: []
};

if (!dryRun) {
  db.transaction(() => {
    applyFixes();
    leaveNonPublishableForReview();
  })();
} else {
  for (const fix of localizationFixes) {
    const existing = statements.findLocalization.get(fix.sense_id, fix.lang);
    if (!existing) stats.missing_localization_senses.push(`${fix.sense_id}:${fix.lang}`);
    else stats.localizations_updated++;
    stats.localization_fixes++;
  }
  stats.senses_left_for_review = notPublishableSenseIds.length;
}

console.log(JSON.stringify(stats, null, 2));
db.close();

function applyFixes() {
  for (const fix of localizationFixes) {
    const payload = { ...fix, product_sense_id: fix.sense_id, source };
    const existing = statements.findLocalization.get(fix.sense_id, fix.lang);
    if (existing) {
      statements.updateLocalization.run({ ...payload, id: existing.id });
      stats.localizations_updated++;
    } else {
      statements.insertLocalization.run(payload);
      stats.localizations_inserted++;
    }
    stats.localization_fixes++;
    for (const job of statements.latestNeedsReviewJobs.all(fix.sense_id)) {
      statements.markJobAccepted.run(job.id);
      stats.jobs_marked_accepted++;
    }
  }
}

function leaveNonPublishableForReview() {
  for (const senseId of notPublishableSenseIds) {
    statements.markSenseNeedsReview.run(senseId);
    statements.markBadLocalizationsNeedsReview.run({
      sense_id: senseId,
      lang: 'zh',
      source
    });
    stats.senses_left_for_review++;
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) parsed[key] = 'true';
    else {
      parsed[key] = next;
      index++;
    }
  }
  return parsed;
}
