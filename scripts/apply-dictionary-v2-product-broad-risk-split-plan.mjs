import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";
const DEFAULT_PLAN = "logs/product-broad-risk-split-plan-20260625.json";
const SOURCE = "manual:broad-risk-split-20260625";
const LANGS = ["en", "zh", "ja", "pt-BR"];

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const planPath = path.resolve(args.plan || DEFAULT_PLAN);
const apply = args.apply === "true";
const limit = args.limit ? Number(args.limit) : 0;
const dropUnmappedExamples = args["drop-unmapped-examples"] === "true";
const clearJobs = args["clear-jobs"] !== "false";
const senseIds = parseIdSet(args["sense-ids"]);

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
if (!fs.existsSync(planPath)) throw new Error(`Split plan not found: ${planPath}`);
if (limit && (!Number.isInteger(limit) || limit < 1)) throw new Error(`Invalid --limit: ${args.limit}`);

const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
const candidates = (plan.approved_candidates || [])
  .filter((candidate) => !senseIds.size || senseIds.has(Number(candidate.sense_id)))
  .slice(0, limit || undefined);
if (!candidates.length) throw new Error("No approved_candidates found in split plan");

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 30000");

const statements = {
  senseById: db.prepare(`
    SELECT s.*, e.headword, e.primary_lang, e.frequency_rank
    FROM product_senses s
    JOIN product_entries e ON e.id = s.product_entry_id
    WHERE s.id = ?
  `),
  entrySenses: db.prepare(`
    SELECT id, sense_order, gloss_key
    FROM product_senses
    WHERE product_entry_id = ?
    ORDER BY sense_order, id
  `),
  sourceLinks: db.prepare(`
    SELECT source_entry_id, source_sense_id, source_lang, source_word, source_frequency_rank, match_method, confidence
    FROM product_sense_source_links
    WHERE product_sense_id = ?
    ORDER BY id
  `),
  examples: db.prepare(`
    SELECT id, source_text
    FROM product_examples
    WHERE product_sense_id = ?
    ORDER BY example_order, id
  `),
  localizationCount: db.prepare(`
    SELECT COUNT(*) AS count
    FROM product_localizations
    WHERE product_sense_id = ?
  `),
  updateSense: db.prepare(`
    UPDATE product_senses
    SET part_of_speech = @part_of_speech,
        gloss_key = @gloss_key,
        status = 'accepted',
        confidence = @confidence
    WHERE id = @id
  `),
  insertSense: db.prepare(`
    INSERT INTO product_senses
      (product_entry_id, sense_order, part_of_speech, gloss_key, status, confidence)
    VALUES
      (@product_entry_id, @sense_order, @part_of_speech, @gloss_key, 'accepted', @confidence)
  `),
  deleteLocalization: db.prepare(`
    DELETE FROM product_localizations
    WHERE product_sense_id = ?
  `),
  insertLocalization: db.prepare(`
    INSERT INTO product_localizations (
      product_sense_id,
      lang,
      term,
      reading,
      reading_system,
      pronunciation,
      pronunciation_system,
      definition,
      source,
      confidence,
      needs_review
    )
    VALUES (
      @product_sense_id,
      @lang,
      @term,
      @reading,
      @reading_system,
      @pronunciation,
      @pronunciation_system,
      @definition,
      @source,
      @confidence,
      0
    )
  `),
  insertSourceLink: db.prepare(`
    INSERT OR IGNORE INTO product_sense_source_links (
      product_sense_id,
      source_entry_id,
      source_sense_id,
      source_lang,
      source_word,
      source_frequency_rank,
      match_method,
      confidence
    )
    VALUES (
      @product_sense_id,
      @source_entry_id,
      @source_sense_id,
      @source_lang,
      @source_word,
      @source_frequency_rank,
      @match_method,
      @confidence
    )
  `),
  deleteExampleLocalizations: db.prepare(`
    DELETE FROM product_example_localizations
    WHERE product_example_id IN (
      SELECT id FROM product_examples WHERE product_sense_id = ?
    )
  `),
  deleteExampleLocalizationsById: db.prepare(`
    DELETE FROM product_example_localizations
    WHERE product_example_id = ?
  `),
  deleteExamples: db.prepare(`
    DELETE FROM product_examples
    WHERE product_sense_id = ?
  `),
  updateExampleSense: db.prepare(`
    UPDATE product_examples
    SET product_sense_id = ?,
        example_order = ?
    WHERE id = ?
  `),
  deleteExampleById: db.prepare(`
    DELETE FROM product_examples
    WHERE id = ?
  `),
  deleteJobs: db.prepare(`
    DELETE FROM product_llm_completion_jobs
    WHERE target_type = 'sense'
      AND target_id = ?
  `),
  tempSenseOrder: db.prepare(`
    UPDATE product_senses
    SET sense_order = -id
    WHERE product_entry_id = ?
  `),
  setSenseOrder: db.prepare(`
    UPDATE product_senses
    SET sense_order = ?
    WHERE id = ?
  `),
  setEntryStatus: db.prepare(`
    UPDATE product_entries
    SET status = 'accepted',
        source_count = (
          SELECT COUNT(*) FROM product_sense_source_links l
          JOIN product_senses s ON s.id = l.product_sense_id
          WHERE s.product_entry_id = product_entries.id
        ),
        lang_count = (
          SELECT COUNT(DISTINCT pl.lang) FROM product_localizations pl
          JOIN product_senses s ON s.id = pl.product_sense_id
          WHERE s.product_entry_id = product_entries.id
            AND pl.needs_review = 0
        )
    WHERE id = ?
  `)
};

const stats = {
  db: path.relative(process.cwd(), dbPath),
  plan: path.relative(process.cwd(), planPath),
  apply,
  drop_unmapped_examples: dropUnmappedExamples,
  sense_ids: senseIds.size ? [...senseIds] : null,
  candidates_seen: candidates.length,
  candidates_valid: 0,
  candidates_applied: 0,
  candidates_skipped: 0,
  senses_created: 0,
  senses_updated: 0,
  localizations_inserted: 0,
  localizations_deleted: 0,
  source_links_inserted: 0,
  examples_moved: 0,
  examples_deleted: 0,
  example_localizations_deleted: 0,
  jobs_deleted: 0,
  skipped: []
};

const previews = [];

const applyAll = db.transaction((rows) => {
  for (const candidate of rows) applyCandidate(candidate, true);
});

if (apply) applyAll(candidates);
else {
  for (const candidate of candidates) applyCandidate(candidate, false);
}

const output = {
  ok: stats.skipped.length === 0,
  stats,
  preview: previews
};

console.log(JSON.stringify(output, null, 2));
db.close();

function applyCandidate(candidate, write) {
  const validation = validateCandidate(candidate);
  if (!validation.ok) {
    stats.candidates_skipped++;
    stats.skipped.push({ sense_id: candidate.sense_id, headword: candidate.headword, reasons: validation.errors });
    return;
  }
  stats.candidates_valid++;

  const currentSense = validation.currentSense;
  const proposedSenses = validation.proposedSenses;
  const sourceLinks = statements.sourceLinks.all(currentSense.id);
  const existingExamples = statements.examples.all(currentSense.id);
  const entrySensesBefore = statements.entrySenses.all(currentSense.product_entry_id);
  const firstOrder = Number(currentSense.sense_order);
  const plannedSenseIds = [currentSense.id];
  const plannedCreated = [];
  const planned = {
    entry_id: currentSense.product_entry_id,
    headword: currentSense.headword,
    primary_lang: currentSense.primary_lang,
    original_sense_id: currentSense.id,
    original_sense_order: currentSense.sense_order,
    source_links_to_copy_per_new_sense: sourceLinks.length,
    existing_examples_on_original: existingExamples.length,
    example_actions: [],
    proposed: []
  };

  if (write) {
    statements.tempSenseOrder.run(currentSense.product_entry_id);
  }

  for (let index = 0; index < proposedSenses.length; index++) {
    const proposed = proposedSenses[index];
    const isFirst = index === 0;
    let targetSenseId = currentSense.id;
    const targetOrder = firstOrder + index;
    if (write) {
      if (isFirst) {
        statements.updateSense.run({
          id: targetSenseId,
          part_of_speech: proposed.part_of_speech,
          gloss_key: proposed.label,
          confidence: candidate.confidence
        });
        stats.senses_updated++;
      } else {
        const inserted = statements.insertSense.run({
          product_entry_id: currentSense.product_entry_id,
          sense_order: -(Date.now() + index),
          part_of_speech: proposed.part_of_speech,
          gloss_key: proposed.label,
          confidence: candidate.confidence
        });
        targetSenseId = Number(inserted.lastInsertRowid);
        plannedCreated.push(targetSenseId);
        plannedSenseIds.push(targetSenseId);
        stats.senses_created++;
        for (const link of sourceLinks) {
          stats.source_links_inserted += statements.insertSourceLink.run({
            product_sense_id: targetSenseId,
            source_entry_id: link.source_entry_id,
            source_sense_id: link.source_sense_id,
            source_lang: link.source_lang,
            source_word: link.source_word,
            source_frequency_rank: link.source_frequency_rank,
            match_method: "manual_broad_split",
            confidence: Math.min(Number(link.confidence) || 1, Number(candidate.confidence) || 1)
          }).changes;
        }
      }

      stats.localizations_deleted += statements.deleteLocalization.run(targetSenseId).changes;
      for (const localization of buildLocalizations(targetSenseId, proposed, candidate.confidence)) {
        stats.localizations_inserted += statements.insertLocalization.run(localization).changes;
      }
    } else {
      if (!isFirst) stats.senses_created++;
      stats.localizations_deleted += isFirst ? Number(statements.localizationCount.get(targetSenseId).count || 0) : 0;
      stats.localizations_inserted += 4;
      if (!isFirst) stats.source_links_inserted += sourceLinks.length;
    }

    planned.proposed.push({
      target_sense_id: write ? targetSenseId : isFirst ? targetSenseId : "(new)",
      target_sense_order: targetOrder,
      label: proposed.label,
      part_of_speech: proposed.part_of_speech,
      terms: Object.fromEntries(LANGS.map((lang) => [lang, proposed.localizations[lang].term]))
    });
  }

  if (write) {
    handleExamples(currentSense, existingExamples, plannedSenseIds, candidate, planned);
    if (clearJobs) {
      for (const senseId of plannedSenseIds) {
        stats.jobs_deleted += statements.deleteJobs.run(senseId).changes;
      }
    }
    renumberEntrySenses(currentSense.product_entry_id, entrySensesBefore, plannedCreated, firstOrder);
    statements.setEntryStatus.run(currentSense.product_entry_id);
    stats.candidates_applied++;
  } else {
    for (const example of existingExamples) {
      const targetIndex = inferExampleTargetIndex(candidate, example);
      const action =
        targetIndex == null
          ? dropUnmappedExamples
            ? "delete"
            : "keep_original"
          : targetIndex === 0
            ? "keep_original"
            : "move";
      if (action === "move") stats.examples_moved++;
      if (action === "delete") {
        stats.examples_deleted++;
        stats.example_localizations_deleted += 4;
      }
      planned.example_actions.push({
        example_id: example.id,
        source_text: example.source_text,
        action,
        target_proposed_order: targetIndex == null ? null : targetIndex + 1
      });
    }
  }

  previews.push(planned);
}

function handleExamples(currentSense, examples, plannedSenseIds, candidate, planned) {
  const nextOrderBySense = new Map(plannedSenseIds.map((senseId) => [senseId, 1]));
  for (const example of examples) {
    const targetIndex = inferExampleTargetIndex(candidate, example);
    if (targetIndex == null) {
      if (dropUnmappedExamples) {
        stats.example_localizations_deleted += statements.deleteExampleLocalizationsById.run(example.id).changes;
        stats.examples_deleted += statements.deleteExampleById.run(example.id).changes;
        planned.example_actions.push({
          example_id: example.id,
          source_text: example.source_text,
          action: "delete",
          target_proposed_order: null
        });
      } else {
        planned.example_actions.push({
          example_id: example.id,
          source_text: example.source_text,
          action: "keep_original",
          target_proposed_order: 1
        });
      }
      continue;
    }

    const targetSenseId = plannedSenseIds[targetIndex] || currentSense.id;
    const nextOrder = nextOrderBySense.get(targetSenseId) || 1;
    nextOrderBySense.set(targetSenseId, nextOrder + 1);
    if (targetSenseId !== currentSense.id) {
      stats.examples_moved += statements.updateExampleSense.run(targetSenseId, nextOrder, example.id).changes;
      planned.example_actions.push({
        example_id: example.id,
        source_text: example.source_text,
        action: "move",
        target_sense_id: targetSenseId,
        target_proposed_order: targetIndex + 1
      });
    } else {
      planned.example_actions.push({
        example_id: example.id,
        source_text: example.source_text,
        action: "keep_original",
        target_sense_id: targetSenseId,
        target_proposed_order: 1
      });
    }
  }
}

function validateCandidate(candidate) {
  const errors = [];
  if (candidate.status !== "approved_candidate") errors.push("not_approved_candidate");
  if (!Number.isFinite(Number(candidate.confidence)) || Number(candidate.confidence) < 0.85) {
    errors.push("confidence_below_threshold");
  }
  const currentSense = statements.senseById.get(Number(candidate.sense_id));
  if (!currentSense) errors.push("sense_not_found");
  else {
    if (currentSense.product_entry_id !== Number(candidate.entry_id)) errors.push("entry_id_mismatch");
    if (currentSense.status !== "accepted") errors.push("sense_not_accepted");
  }
  const proposedSenses = normalizeProposedSenses(candidate.proposed_senses || [], errors);
  if (proposedSenses.length < 2) errors.push("not_enough_proposed_senses");
  return { ok: errors.length === 0, errors, currentSense, proposedSenses };
}

function normalizeProposedSenses(senses, errors) {
  return senses.map((sense, senseIndex) => {
    const label = cleanText(sense.label);
    if (!label) errors.push(`sense_${senseIndex + 1}_missing_label`);
    const localizations = {};
    for (const lang of LANGS) {
      const loc = sense.localizations?.[lang];
      if (!loc) {
        errors.push(`sense_${senseIndex + 1}_missing_${lang}`);
        continue;
      }
      const term = cleanText(loc.term);
      const definition = cleanText(loc.definition);
      if (!term) errors.push(`sense_${senseIndex + 1}_${lang}_missing_term`);
      if (!definition) errors.push(`sense_${senseIndex + 1}_${lang}_missing_definition`);
      localizations[lang] = {
        term,
        reading: cleanNullable(loc.reading),
        pronunciation: cleanNullable(loc.pronunciation),
        definition
      };
    }
    return {
      label,
      part_of_speech: cleanNullable(sense.part_of_speech),
      localizations
    };
  });
}

function buildLocalizations(productSenseId, proposed, confidence) {
  return LANGS.map((lang) => {
    const loc = proposed.localizations[lang];
    return {
      product_sense_id: productSenseId,
      lang,
      term: loc.term,
      reading: lang === "zh" || lang === "ja" ? loc.reading : null,
      reading_system: readingSystem(lang, loc.reading),
      pronunciation: lang === "en" || lang === "pt-BR" ? loc.pronunciation : null,
      pronunciation_system: pronunciationSystem(lang, loc.pronunciation),
      definition: loc.definition,
      source: SOURCE,
      confidence: Number(confidence)
    };
  });
}

function inferExampleTargetIndex(candidate, example) {
  const senseId = Number(candidate.sense_id);
  const text = String(example.source_text || "");
  if (senseId === 8335 && /问题|question|pergunta/iu.test(text)) return 1;
  if (senseId === 6381 && /放心|worry|tranquilo|安心/iu.test(text)) return 0;
  return 0;
}

function renumberEntrySenses(productEntryId, previousSenses, createdSenseIds, firstOrder) {
  const createdRows = createdSenseIds.map((id, index) => ({ id, sense_order: firstOrder + index + 1 }));
  const shiftedPrevious = previousSenses.map((row) => ({
    id: row.id,
    sense_order: row.sense_order > firstOrder ? row.sense_order + createdSenseIds.length : row.sense_order
  }));
  const merged = [...shiftedPrevious, ...createdRows].sort((a, b) => a.sense_order - b.sense_order || a.id - b.id);
  for (const [index, row] of merged.entries()) {
    statements.setSenseOrder.run(index + 1, row.id);
  }
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
}

function cleanNullable(value) {
  const text = cleanText(value);
  return text || null;
}

function readingSystem(lang, reading) {
  if (!reading) return null;
  if (lang === "zh") return "pinyin";
  if (lang === "ja") return "kana";
  return null;
}

function pronunciationSystem(lang, pronunciation) {
  if (!pronunciation) return null;
  if (lang === "en" || lang === "pt-BR") return "ipa";
  return null;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index++;
    } else {
      parsed[key] = "true";
    }
  }
  return parsed;
}

function parseIdSet(value) {
  const ids = new Set();
  for (const part of String(value || "").split(",")) {
    const id = Number(part.trim());
    if (Number.isInteger(id) && id > 0) ids.add(id);
  }
  return ids;
}
