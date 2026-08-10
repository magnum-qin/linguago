import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB = 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const dryRun = args['dry-run'] !== 'false';
const source = 'manual:ready-residual-finalize-20260621';

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const fixes = [
  {
    sense_id: 164,
    lang: 'ja',
    term: 'まだ',
    reading: 'まだ',
    reading_system: 'hiragana',
    pronunciation: null,
    pronunciation_system: null,
    definition: 'ある状態や動作が現在も続いていること、または期待される結果よりも遅く生じていることを示す副詞。'
  },
  {
    sense_id: 8439,
    lang: 'zh',
    term: '皇家',
    reading: 'huang jia',
    reading_system: 'pinyin',
    pronunciation: null,
    pronunciation_system: null,
    definition: '与君主、王室或皇室成员有关的。'
  },
  {
    sense_id: 8677,
    lang: 'zh',
    term: '印第安人',
    reading: 'yin di an ren',
    reading_system: 'pinyin',
    pronunciation: null,
    pronunciation_system: null,
    definition: '指美洲原住民，或与美洲原住民相关的人。'
  },
  {
    sense_id: 18425,
    lang: 'zh',
    term: 'Cookie 文件',
    reading: 'Cookie wen jian',
    reading_system: 'pinyin',
    pronunciation: null,
    pronunciation_system: null,
    definition: '网站存储在浏览器或设备上的小型数据文件，用于记住用户信息、偏好设置或登录状态。'
  }
];

const blocked = [
  {
    sense_id: 11949,
    block_code: 'blocked_source_ambiguous',
    rationale:
      'The sole Chinese source anchor is 觉, but the current sense is the textile meaning of nap. Do not publish until the sense is backed by a matching source or manually reviewed.',
    recommendation:
      'Either move this textile sense to a source-backed group with zh 绒毛/起毛, or keep it out of the published dictionary.'
  },
  {
    sense_id: 18316,
    block_code: 'blocked_source_ambiguous',
    rationale:
      'The entry headword is 変, but the sole Japanese source anchor is 釣り. The localization describes 変 rather than the source-backed sense.',
    recommendation: 'Relocate or rebuild this sense from matching Japanese source evidence before publication.'
  },
  {
    sense_id: 18320,
    block_code: 'blocked_source_ambiguous',
    rationale:
      'The entry headword is 姿, but the sole Japanese source anchor is 振り. The localization describes behavior/manner rather than a source-backed 姿 sense.',
    recommendation: 'Relocate or rebuild this sense from matching Japanese source evidence before publication.'
  }
];

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000');

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
        confidence = 0.9,
        needs_review = 0
    WHERE product_sense_id = @sense_id
      AND lang = @lang
  `),
  insertLocalization: db.prepare(`
    INSERT INTO product_localizations
      (product_sense_id, lang, term, reading, reading_system, pronunciation, pronunciation_system, definition, source, confidence, needs_review)
    VALUES
      (@sense_id, @lang, @term, @reading, @reading_system, @pronunciation, @pronunciation_system, @definition, @source, 0.9, 0)
  `),
  markLatestJobsAccepted: db.prepare(`
    UPDATE product_llm_completion_jobs
    SET status = 'accepted',
        error = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE target_type = 'product_sense_localization'
      AND target_id = @sense_id
      AND lang = @lang
      AND status = 'needs_review'
      AND id IN (
        SELECT id
        FROM product_llm_completion_jobs
        WHERE target_type = 'product_sense_localization'
          AND target_id = @sense_id
          AND lang = @lang
          AND status = 'needs_review'
        ORDER BY id DESC
        LIMIT 3
      )
  `),
  completedCleanLangCount: db.prepare(`
    SELECT COUNT(DISTINCT lang) AS count
    FROM product_localizations
    WHERE product_sense_id = ?
      AND needs_review = 0
  `),
  reviewLocalizationCount: db.prepare(`
    SELECT COUNT(*) AS count
    FROM product_localizations
    WHERE product_sense_id = ?
      AND needs_review = 1
  `),
  markSenseAccepted: db.prepare(`
    UPDATE product_senses
    SET status = 'accepted'
    WHERE id = ?
      AND status IN ('ready_for_llm', 'needs_review', 'draft_fused', 'draft_single_source')
  `),
  markSenseNeedsReview: db.prepare(`
    UPDATE product_senses
    SET status = 'needs_review'
    WHERE id = ?
      AND status <> 'accepted'
  `),
  markLocalizationsNeedsReview: db.prepare(`
    UPDATE product_localizations
    SET needs_review = 1,
        source = source || '+blocked-ready-residual-20260621'
    WHERE product_sense_id = ?
      AND needs_review = 0
  `),
  upsertBlock: db.prepare(`
    INSERT INTO product_sense_publication_blocks
      (product_sense_id, block_code, rationale, recommendation, updated_at)
    VALUES
      (@sense_id, @block_code, @rationale, @recommendation, CURRENT_TIMESTAMP)
    ON CONFLICT(product_sense_id) DO UPDATE SET
      block_code = excluded.block_code,
      rationale = excluded.rationale,
      recommendation = excluded.recommendation,
      updated_at = CURRENT_TIMESTAMP
  `),
  senseEntry: db.prepare('SELECT product_entry_id FROM product_senses WHERE id = ?'),
  entryStatusCounts: db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM product_senses
    WHERE product_entry_id = ?
    GROUP BY status
  `),
  setEntryStatus: db.prepare('UPDATE product_entries SET status = ? WHERE id = ?')
};

const touchedEntryIds = new Set();
const stats = {
  db: path.relative(process.cwd(), dbPath),
  dry_run: dryRun,
  fixes: fixes.length,
  inserted: 0,
  updated: 0,
  jobs_marked_accepted: 0,
  senses_marked_accepted: 0,
  blocked: blocked.length,
  senses_marked_needs_review: 0
};

function applyFix(fix) {
  const payload = { ...fix, source };
  if (statements.findLocalization.get(fix.sense_id, fix.lang)) {
    statements.updateLocalization.run(payload);
    stats.updated++;
  } else {
    statements.insertLocalization.run(payload);
    stats.inserted++;
  }
  stats.jobs_marked_accepted += statements.markLatestJobsAccepted.run(fix).changes;
  maybeMarkSenseAccepted(fix.sense_id);
}

function applyBlock(block) {
  stats.senses_marked_needs_review += statements.markSenseNeedsReview.run(block.sense_id).changes;
  statements.markLocalizationsNeedsReview.run(block.sense_id);
  statements.upsertBlock.run(block);
  const entry = statements.senseEntry.get(block.sense_id);
  if (entry) touchedEntryIds.add(entry.product_entry_id);
}

function maybeMarkSenseAccepted(senseId) {
  if (
    statements.completedCleanLangCount.get(senseId).count >= 4 &&
    statements.reviewLocalizationCount.get(senseId).count === 0
  ) {
    stats.senses_marked_accepted += statements.markSenseAccepted.run(senseId).changes;
    const entry = statements.senseEntry.get(senseId);
    if (entry) touchedEntryIds.add(entry.product_entry_id);
  }
}

function updateEntryStatus(entryId) {
  const statuses = statements.entryStatusCounts.all(entryId);
  const total = statuses.reduce((sum, row) => sum + Number(row.count), 0);
  const accepted = statuses.find((row) => row.status === 'accepted')?.count || 0;
  const needsReview = statuses.find((row) => row.status === 'needs_review')?.count || 0;
  const ready = statuses.find((row) => row.status === 'ready_for_llm')?.count || 0;
  const status =
    accepted === total
      ? 'accepted'
      : needsReview > 0
        ? 'needs_review'
        : ready > 0
          ? 'ready_for_llm'
          : 'draft_single_source';
  statements.setEntryStatus.run(status, entryId);
}

if (!dryRun) {
  db.transaction(() => {
    for (const fix of fixes) applyFix(fix);
    for (const block of blocked) applyBlock(block);
    for (const entryId of touchedEntryIds) updateEntryStatus(entryId);
  })();
} else {
  for (const fix of fixes) {
    if (statements.findLocalization.get(fix.sense_id, fix.lang)) stats.updated++;
    else stats.inserted++;
  }
}

console.log(JSON.stringify(stats, null, 2));
db.close();

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
