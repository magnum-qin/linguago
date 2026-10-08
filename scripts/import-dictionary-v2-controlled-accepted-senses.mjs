#!/usr/bin/env node

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const LANGS = ['en', 'pt-BR', 'zh', 'ja'];
const SOURCE = 'unsloth:source-gap-controlled-consensus';

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = 'true';
      }
    }
  }
  return result;
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase();
}

function cleanText(value) {
  return String(value || '').trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runsArg = args.runs || 'runs/production-1000-controlled-run1,runs/production-4000-controlled-run1,runs/production-4000-controlled-run2';
  const dbPath = path.resolve(args.db || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db');
  const dryRun = args['dry-run'] !== 'false' && args.apply !== 'true';
  const targetStatus = args.status || 'draft_single_source';
  const verificationLevel = args['verification-level'] || 'ai_reviewed';
  const reviewModel = args['review-model'] || 'gemma-4-31b-independent-review';
  const evidenceFamilies = 'locked-local-dictionary-evidence,qwen-generation,gemma-independent-review';

  console.log(`[Import] Target Database: ${dbPath}`);
  console.log(`[Import] Dry Run: ${dryRun}`);
  console.log(`[Import] Target Sense/Entry Status: ${targetStatus}`);

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file not found: ${dbPath}`);
  }

  const runDirs = runsArg.split(',').map((s) => s.trim()).filter(Boolean);
  const candidatePool = new Map();

  for (const runDir of runDirs) {
    const acceptedPath = path.resolve(runDir, '07-final-gemma-accepted.json');
    const genPath = path.resolve(runDir, '05-qwen-generation.json');

    if (!fs.existsSync(acceptedPath) || !fs.existsSync(genPath)) {
      console.warn(`[Import] Skipping run dir with missing files: ${runDir}`);
      continue;
    }

    const accepted = JSON.parse(fs.readFileSync(acceptedPath, 'utf8'));
    const gen = JSON.parse(fs.readFileSync(genPath, 'utf8'));

    const genMap = new Map();
    for (const item of (gen.generated || [])) {
      if (item.valid && item.output) {
        const key = `${item.source_lang}:${item.word}`;
        genMap.set(key, item);
      }
    }

    for (const review of (accepted.reviews || [])) {
      if (review.consensus_accepted && review.decision === 'accept' && review.valid) {
        const key = `${review.source_lang}:${review.word}`;
        if (!candidatePool.has(key)) {
          const genItem = genMap.get(key);
          if (!genItem) {
            console.warn(`[Import] Warning: No generation record for accepted word ${key}`);
            continue;
          }
          candidatePool.set(key, {
            review,
            generation: genItem,
            run: runDir
          });
        }
      }
    }
  }

  console.log(`[Import] Discovered ${candidatePool.size} unique accepted candidates across ${runDirs.length} runs.`);

  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 30000');

  // Verify schema tables exist
  const existingTables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
  for (const requiredTable of ['product_entries', 'product_senses', 'product_localizations', 'product_sense_source_links']) {
    if (!existingTables.has(requiredTable)) {
      throw new Error(`Required table ${requiredTable} missing in database`);
    }
  }

  const hasVerificationTable = existingTables.has('product_sense_verification');

  const statements = {
    getEntryByGroupKey: db.prepare('SELECT id, headword, primary_lang, status FROM product_entries WHERE group_key = ?'),
    getEntryByHeadword: db.prepare('SELECT id, headword, primary_lang, status FROM product_entries WHERE headword = ? AND primary_lang = ?'),
    insertEntry: db.prepare(`
      INSERT INTO product_entries
        (headword, normalized_key, primary_lang, frequency_rank, group_key, group_method, status, source_count, lang_count, created_at)
      VALUES
        (@headword, @normalized_key, @primary_lang, @frequency_rank, @group_key, 'source_gap_unsloth', @status, 1, 4, @created_at)
    `),
    getExistingSenseBySourceSenseId: db.prepare(`
      SELECT ps.id AS product_sense_id, ps.product_entry_id, ps.status
      FROM product_senses ps
      JOIN product_sense_source_links sl ON sl.product_sense_id = ps.id
      WHERE sl.source_entry_id = ? AND sl.source_sense_id = ?
      LIMIT 1
    `),
    getExistingSenseByGlossKey: db.prepare(`
      SELECT id, status
      FROM product_senses
      WHERE product_entry_id = ? AND gloss_key = ?
      LIMIT 1
    `),
    getNextSenseOrder: db.prepare(`
      SELECT COALESCE(MAX(sense_order), 0) + 1 AS next_order
      FROM product_senses
      WHERE product_entry_id = ?
    `),
    insertSense: db.prepare(`
      INSERT INTO product_senses
        (product_entry_id, sense_order, part_of_speech, gloss_key, status, confidence, created_at)
      VALUES
        (@product_entry_id, @sense_order, @part_of_speech, @gloss_key, @status, 0.78, @created_at)
    `),
    upsertLocalization: db.prepare(`
      INSERT INTO product_localizations
        (product_sense_id, lang, term, reading, reading_system, pronunciation, pronunciation_system, definition, source, confidence, needs_review)
      VALUES
        (@product_sense_id, @lang, @term, @reading, @reading_system, @pronunciation, @pronunciation_system, @definition, @source, 0.78, @needs_review)
      ON CONFLICT(product_sense_id, lang) DO UPDATE SET
        term = excluded.term,
        reading = excluded.reading,
        reading_system = excluded.reading_system,
        pronunciation = excluded.pronunciation,
        pronunciation_system = excluded.pronunciation_system,
        definition = excluded.definition,
        source = excluded.source,
        confidence = excluded.confidence,
        needs_review = excluded.needs_review
    `),
    insertSourceLink: db.prepare(`
      INSERT OR IGNORE INTO product_sense_source_links
        (product_sense_id, source_entry_id, source_sense_id, source_lang, source_word, source_frequency_rank, match_method, confidence)
      VALUES
        (@product_sense_id, @source_entry_id, @source_sense_id, @source_lang, @source_word, @source_frequency_rank, 'controlled_consensus_draft', 0.78)
    `),
    upsertVerification: hasVerificationTable
      ? db.prepare(`
          INSERT INTO product_sense_verification
            (product_sense_id, verification_level, confidence, review_model, evidence_families_json, reviewed_at)
          VALUES
            (@product_sense_id, @verification_level, @confidence, @review_model, @evidence_families_json, @reviewed_at)
          ON CONFLICT(product_sense_id) DO UPDATE SET
            verification_level = excluded.verification_level,
            confidence = excluded.confidence,
            review_model = excluded.review_model,
            evidence_families_json = excluded.evidence_families_json,
            reviewed_at = excluded.reviewed_at
        `)
      : null
  };

  const now = new Date().toISOString();
  const stats = {
    candidates_processed: 0,
    entries_inserted: 0,
    entries_reused: 0,
    senses_inserted: 0,
    senses_reused: 0,
    localizations_upserted: 0,
    source_links_inserted: 0,
    verifications_inserted: 0,
    quality_checks: {
      passed: 0,
      failed: 0,
      failures: []
    }
  };

  const candidateItems = [...candidatePool.values()];

  const applyTransaction = db.transaction(() => {
    for (const { review, generation } of candidateItems) {
      stats.candidates_processed++;
      const output = generation.output;
      const headword = cleanText(output.headword || review.word);
      const primaryLang = String(output.primary_lang || review.source_lang);
      const normalizedKey = normalize(output.normalized_key || headword);
      const baseGroupKey = `source-gap:${primaryLang}:${normalizedKey}`;

      // Pre-insertion Quality Validation
      let itemValid = true;
      for (const lang of LANGS) {
        const loc = output.localizations?.[lang];
        if (!loc || !cleanText(loc.term) || !cleanText(loc.definition)) {
          stats.quality_checks.failed++;
          stats.quality_checks.failures.push({ word: headword, reason: `missing_term_or_def_${lang}` });
          itemValid = false;
          break;
        }
        if (/[\r\n]/u.test(loc.term) || /[\r\n]/u.test(loc.definition)) {
          stats.quality_checks.failed++;
          stats.quality_checks.failures.push({ word: headword, reason: `newline_in_localization_${lang}` });
          itemValid = false;
          break;
        }
      }

      if (!itemValid) continue;
      stats.quality_checks.passed++;

      // 1. Entry Resolution
      let existingEntry = statements.getEntryByGroupKey.get(baseGroupKey) ||
                          statements.getEntryByHeadword.get(headword, primaryLang);

      let entryId = existingEntry?.id;
      if (entryId) {
        stats.entries_reused++;
      } else {
        const insertRes = statements.insertEntry.run({
          headword,
          normalized_key: normalizedKey,
          primary_lang: primaryLang,
          frequency_rank: output.frequency_rank ?? null,
          group_key: baseGroupKey,
          status: targetStatus,
          created_at: now
        });
        entryId = Number(insertRes.lastInsertRowid);
        stats.entries_inserted++;
      }

      // 2. Sense Resolution (Check by source_sense_id first, or gloss_key ONLY if same draft status)
      let existingSense = statements.getExistingSenseBySourceSenseId.get(output.source_entry_id, output.source_sense_id);
      if (!existingSense) {
        const byGloss = statements.getExistingSenseByGlossKey.get(entryId, output.gloss_key);
        if (byGloss && byGloss.status === targetStatus) {
          existingSense = byGloss;
        }
      }

      let senseId = existingSense?.product_sense_id || existingSense?.id;
      if (senseId) {
        stats.senses_reused++;
      } else {
        const nextSenseOrder = statements.getNextSenseOrder.get(entryId)?.next_order || 1;
        const insertSenseRes = statements.insertSense.run({
          product_entry_id: entryId,
          sense_order: nextSenseOrder,
          part_of_speech: output.part_of_speech || null,
          gloss_key: output.gloss_key,
          status: targetStatus,
          created_at: now
        });
        senseId = Number(insertSenseRes.lastInsertRowid);
        stats.senses_inserted++;
      }

      // 3. Localizations
      for (const lang of LANGS) {
        const loc = output.localizations[lang];
        statements.upsertLocalization.run({
          product_sense_id: senseId,
          lang,
          term: cleanText(loc.term),
          reading: cleanText(loc.reading) || null,
          reading_system: cleanText(loc.reading_system) || null,
          pronunciation: cleanText(loc.pronunciation) || null,
          pronunciation_system: cleanText(loc.pronunciation_system) || null,
          definition: cleanText(loc.definition),
          source: SOURCE,
          needs_review: 0
        });
        stats.localizations_upserted++;
      }

      // 4. Source Link
      const linkRes = statements.insertSourceLink.run({
        product_sense_id: senseId,
        source_entry_id: output.source_entry_id,
        source_sense_id: output.source_sense_id,
        source_lang: primaryLang,
        source_word: headword,
        source_frequency_rank: output.source_frequency_rank ?? null
      });
      if (linkRes.changes > 0) {
        stats.source_links_inserted++;
      }

      // 5. Verification (if table exists)
      if (statements.upsertVerification) {
        statements.upsertVerification.run({
          product_sense_id: senseId,
          verification_level: verificationLevel,
          confidence: Number(review.confidence) || 0.95,
          review_model: reviewModel,
          evidence_families_json: JSON.stringify(['locked-local-dictionary-evidence', 'qwen-generation', 'gemma-independent-review']),
          reviewed_at: now
        });
        stats.verifications_inserted++;
      }
    }
  });

  if (dryRun) {
    console.log('[Import] DRY RUN MODE: Executing transaction in rollback mode...');
    const rollbackTx = db.transaction(() => {
      applyTransaction();
      throw new Error('ROLLBACK_INTENDED');
    });
    try {
      rollbackTx();
    } catch (err) {
      if (err.message !== 'ROLLBACK_INTENDED') throw err;
    }
    console.log('[Import] Dry Run Complete. Changes rolled back successfully.');
  } else {
    console.log('[Import] LIVE COMMIT MODE: Committing transaction to database...');
    applyTransaction();
    console.log('[Import] Live Commit Complete.');
  }

  // Checkpoint SQLite DB WAL
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (e) {
    // Ignore checkpoint errors if any
  }

  db.close();

  console.log('\n=== IMPORT AUDIT SUMMARY ===');
  console.log(JSON.stringify(stats, null, 2));

  if (stats.quality_checks.failed > 0) {
    console.error(`\n[WARNING] Quality checks failed for ${stats.quality_checks.failed} items.`);
    process.exit(1);
  } else {
    console.log('\n[SUCCESS] All quality checks passed.');
  }
}

main().catch((err) => {
  console.error('[Import] Fatal error:', err);
  process.exit(1);
});
