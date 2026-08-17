import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const LANGS = ['en', 'pt-BR', 'zh', 'ja'];
const args = parseArgs(process.argv.slice(2));
const reportPath = path.resolve(args.report || 'logs/product-coverage-gaps.json');
const sourceDbPath = path.resolve(args['source-db'] || 'data/processed/linguago_v2_full.db');
const productDbPath = path.resolve(
  args['product-db'] || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db'
);
const outPath = path.resolve(args.out || reportPath.replace(/\.json$/u, '-sense-aligned.json'));
const rejectedOutPath = path.resolve(
  args['rejected-out'] || reportPath.replace(/\.json$/u, '-sense-alignment-rejected.json')
);
const minLangs = boundedInteger(args['min-langs'], 2, 1, 4);
const maxLangs = boundedInteger(args['max-langs'], 3, minLangs, 4);
const requireUniqueBest = args['require-unique-best'] !== 'false';
const expandAmbiguousBest = args['expand-ambiguous-best'] === 'true';
const expandAllEligible = args['expand-all-eligible'] === 'true';
const preferCurrentSense = args['prefer-current-sense'] === 'true';
const excludeProductLinkedDrafts = args['exclude-product-linked-drafts'] !== 'false';

if (!fs.existsSync(reportPath)) throw new Error(`Coverage report not found: ${reportPath}`);
if (!fs.existsSync(sourceDbPath)) throw new Error(`Source DB not found: ${sourceDbPath}`);
if (!fs.existsSync(productDbPath)) throw new Error(`Product DB not found: ${productDbPath}`);

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const candidates = Array.isArray(report.selected) ? report.selected : [];
if (!candidates.length) throw new Error('Coverage report has no selected rows');

const db = new Database(sourceDbPath, { readonly: true, fileMustExist: true });
const productDb = new Database(productDbPath, { readonly: true, fileMustExist: true });
productDb.pragma('query_only = ON');
const findAcceptedProductLink = productDb.prepare(`
  SELECT ps.id AS product_sense_id, ps.status AS product_sense_status
  FROM product_sense_source_links pssl
  JOIN product_senses ps ON ps.id = pssl.product_sense_id
  WHERE pssl.source_sense_id = ?
    AND ps.status = 'accepted'
  LIMIT 1
`);
const findDraftProductLink = productDb.prepare(`
  SELECT ps.id AS product_sense_id, ps.status AS product_sense_status
  FROM product_sense_source_links pssl
  JOIN product_senses ps ON ps.id = pssl.product_sense_id
  WHERE pssl.source_sense_id = ?
    AND ps.status = 'draft_single_source'
  LIMIT 1
`);
const loadSenses = db.prepare(`
  SELECT id, sense_order, part_of_speech, gloss_key, source, confidence, needs_review
  FROM senses
  WHERE entry_id = ?
    AND needs_review = 0
    AND NULLIF(TRIM(gloss_key), '') IS NOT NULL
    AND lower(TRIM(gloss_key)) <> 'missing gloss'
  ORDER BY sense_order, id
`);
const loadLocalizations = db.prepare(`
  SELECT lang, term, reading, reading_system, pronunciation,
         pronunciation_system, definition, source, confidence, needs_review
  FROM sense_localizations
  WHERE sense_id = ?
  ORDER BY needs_review, lang, id
`);
const loadExamples = db.prepare(`
  SELECT id, example_order, source_lang, source_text, source_reading,
         source, confidence, needs_review
  FROM examples
  WHERE sense_id = ? AND needs_review = 0
  ORDER BY example_order, id
  LIMIT 2
`);
const loadExampleLocalizations = db.prepare(`
  SELECT lang, text, reading, source, confidence, needs_review
  FROM example_localizations
  WHERE example_id = ? AND needs_review = 0
  ORDER BY lang, id
`);

const selected = [];
const rejected = [];
const alignedCandidateKeys = new Set();
let duplicateAlignedCandidates = 0;
for (const candidate of candidates) {
  const result = alignCandidate(candidate);
  if (result.ok) {
    for (const row of result.rows || [result.row]) {
      const key = `${Number(row.source_entry_id)}:${Number(row.first_sense_id)}`;
      if (alignedCandidateKeys.has(key)) {
        duplicateAlignedCandidates += 1;
        continue;
      }
      alignedCandidateKeys.add(key);
      selected.push(row);
    }
  } else rejected.push({ ...candidateIdentity(candidate), sense_alignment: result.alignment });
}
db.close();
productDb.close();

const summary = {
  input: candidates.length,
  selected: selected.length,
  rejected: rejected.length,
  duplicate_aligned_candidates: duplicateAlignedCandidates,
  by_reason: countBy(rejected, (row) => row.sense_alignment.reason),
  by_source_lang: countBy(selected, (row) => row.source_lang),
  by_aligned_lang_count: countBy(selected, (row) => String(row.first_sense_clean_localization_lang_count))
};
const common = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_report: path.relative(process.cwd(), reportPath),
  source_db: path.relative(process.cwd(), sourceDbPath),
  product_db: path.relative(process.cwd(), productDbPath),
  policy: {
    min_langs: minLangs,
    max_langs: maxLangs,
    require_unique_best: requireUniqueBest,
    expand_ambiguous_best: expandAmbiguousBest,
    expand_all_eligible: expandAllEligible,
    prefer_current_sense: preferCurrentSense,
    complete_senses_are_excluded: maxLangs < 4,
    accepted_product_linked_senses_are_excluded: true,
    draft_product_linked_senses_are_excluded: excludeProductLinkedDrafts,
    parallel_bilingual_senses_are_not_merged: true
  },
  summary
};
writeJson(outPath, { ...common, selected_count: selected.length, selected });
writeJson(rejectedOutPath, { ...common, rejected_count: rejected.length, rejected });
console.log(
  JSON.stringify(
    {
      ok: true,
      out: path.relative(process.cwd(), outPath),
      rejected_out: path.relative(process.cwd(), rejectedOutPath),
      summary
    },
    null,
    2
  )
);

function alignCandidate(candidate) {
  const senses = loadSenses.all(candidate.source_entry_id).map((sense) => inspectSense(candidate, sense));
  const eligible = senses.filter(
    (sense) =>
      sense.source_term_exact &&
      sense.clean_lang_count >= minLangs &&
      !sense.accepted_product_link &&
      (!excludeProductLinkedDrafts || !sense.draft_product_link)
  );
  if (!eligible.length) {
    if (
      senses.some(
        (sense) => sense.source_term_exact && sense.clean_lang_count >= minLangs && sense.accepted_product_link
      )
    ) {
      return rejectedResult('already_linked_product_sense', candidate, senses);
    }
    if (
      excludeProductLinkedDrafts &&
      senses.some(
        (sense) => sense.source_term_exact && sense.clean_lang_count >= minLangs && sense.draft_product_link
      )
    ) {
      return rejectedResult('already_linked_draft_product_sense', candidate, senses);
    }
    return rejectedResult('no_eligible_sense', candidate, senses);
  }

  const currentSenseId = Number(candidate.first_sense_id);
  const currentSense = preferCurrentSense
    ? eligible.find((sense) => Number(sense.id) === currentSenseId)
    : null;
  if (currentSense) return alignedResult(candidate, currentSense, senses, eligible, 'current_candidate_sense');

  if (expandAllEligible) {
    const expandable = eligible.filter((sense) => sense.clean_lang_count <= maxLangs);
    if (!expandable.length) {
      return rejectedResult('already_complete_aligned_sense', candidate, senses, eligible);
    }
    return {
      ok: true,
      rows: expandable.map((sense) => alignedResult(
        candidate,
        sense,
        senses,
        eligible,
        'expanded_all_eligible_senses'
      ).row)
    };
  }

  const bestLangCount = Math.max(...eligible.map((sense) => sense.clean_lang_count));
  const bestByCoverage = eligible.filter((sense) => sense.clean_lang_count === bestLangCount);
  if (bestLangCount > maxLangs) {
    return rejectedResult('already_complete_aligned_sense', candidate, senses, bestByCoverage);
  }

  const bestConfidence = Math.max(...bestByCoverage.map((sense) => sense.confidence));
  const finalists = bestByCoverage.filter((sense) => sense.confidence === bestConfidence);
  if (expandAmbiguousBest && finalists.length > 1) {
    return {
      ok: true,
      rows: finalists.map((sense) => alignedResult(
        candidate,
        sense,
        senses,
        eligible,
        'expanded_tied_max_clean_languages_then_confidence'
      ).row)
    };
  }
  if (requireUniqueBest && finalists.length !== 1) {
    return rejectedResult('ambiguous_best_sense', candidate, senses, finalists);
  }

  const aligned = finalists[0] || bestByCoverage[0];
  return alignedResult(
    candidate,
    aligned,
    senses,
    eligible,
    'unique_max_clean_languages_then_confidence'
  );
}

function alignedResult(candidate, aligned, senses, eligible, policy) {
  const locs = loadLocalizations.all(aligned.id).filter(isCleanLocalization).map(compactLocalization);
  const examples = loadExamples.all(aligned.id).map((example) => ({
    ...example,
    localizations: loadExampleLocalizations.all(example.id)
  }));
  const cleanLangs = [...new Set(locs.map((row) => row.lang))].sort();
  const changed = Number(candidate.first_sense_id) !== Number(aligned.id);
  const staleSenseFields = changed
    ? {
        generation_hints: undefined,
        reverse_evidence_prefilter: undefined,
        candidate_evidence_review: undefined,
        evidence_gate: undefined,
        sense_expansion: undefined
      }
    : {};
  return {
    ok: true,
    row: {
      ...candidate,
      ...staleSenseFields,
      first_sense_id: aligned.id,
      candidate_key: `${Number(candidate.source_entry_id)}:${Number(aligned.id)}`,
      first_sense_order: aligned.sense_order,
      part_of_speech: aligned.part_of_speech || null,
      gloss_key: aligned.gloss_key,
      gloss_preview: preview(aligned.gloss_key, 180),
      first_sense_clean_localization_langs: cleanLangs,
      first_sense_clean_localization_lang_count: cleanLangs.length,
      first_sense_localizations: locs,
      example_samples: examples,
      sense_alignment: {
        status: 'aligned',
        policy,
        original_sense_id: candidate.first_sense_id ?? null,
        aligned_sense_id: aligned.id,
        changed,
        eligible_sense_count: eligible.length,
        aligned_clean_lang_count: cleanLangs.length,
        candidates: senses.map(compactSenseScore)
      }
    }
  };
}

function inspectSense(candidate, sense) {
  const localizations = loadLocalizations.all(sense.id).filter(isCleanLocalization);
  const cleanLangs = [...new Set(localizations.map((row) => row.lang))];
  const sourceTerms = localizations
    .filter((row) => row.lang === candidate.source_lang)
    .flatMap((row) => splitTerms(row.term));
  const acceptedProductLink = findAcceptedProductLink.get(sense.id);
  const draftProductLink = excludeProductLinkedDrafts ? findDraftProductLink.get(sense.id) : null;
  return {
    ...sense,
    accepted_product_link: acceptedProductLink?.product_sense_id || null,
    draft_product_link: draftProductLink?.product_sense_id || null,
    confidence: Number(sense.confidence || 0),
    clean_lang_count: cleanLangs.length,
    clean_langs: cleanLangs.sort(),
    source_term_exact: sourceTerms.some((term) => normalize(term) === normalize(candidate.word))
  };
}

function rejectedResult(reason, candidate, senses, finalists = []) {
  return {
    ok: false,
    alignment: {
      status: 'rejected',
      reason,
      original_sense_id: candidate.first_sense_id ?? null,
      finalist_sense_ids: finalists.map((sense) => sense.id),
      candidates: senses.map(compactSenseScore)
    }
  };
}

function compactSenseScore(sense) {
  return {
    sense_id: sense.id,
    sense_order: sense.sense_order,
    source: sense.source,
    confidence: sense.confidence,
    gloss_key: sense.gloss_key,
    clean_langs: sense.clean_langs,
    clean_lang_count: sense.clean_lang_count,
    source_term_exact: sense.source_term_exact,
    accepted_product_link: sense.accepted_product_link || null,
    draft_product_link: sense.draft_product_link || null
  };
}

function isCleanLocalization(row) {
  return (
    row.needs_review === 0 &&
    LANGS.includes(row.lang) &&
    cleanText(row.term) &&
    cleanText(row.definition)
  );
}

function compactLocalization(row) {
  return {
    lang: row.lang,
    term: cleanText(row.term),
    reading: cleanText(row.reading) || null,
    reading_system: cleanText(row.reading_system) || null,
    pronunciation: cleanText(row.pronunciation) || null,
    pronunciation_system: cleanText(row.pronunciation_system) || null,
    definition: cleanText(row.definition),
    source: row.source,
    confidence: row.confidence,
    needs_review: row.needs_review
  };
}

function splitTerms(value) {
  return cleanText(value)
    .split(/[;,|/]/u)
    .map((term) => term.trim())
    .filter(Boolean);
}

function candidateIdentity(row) {
  return {
    source_entry_id: row.source_entry_id,
    word: row.word,
    normalized_key: row.normalized_key,
    source_lang: row.source_lang,
    frequency_rank: row.frequency_rank
  };
}

function normalize(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('und');
}

function cleanText(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function preview(value, length) {
  const text = cleanText(value);
  return text.length <= length ? text : `${text.slice(0, length - 3)}...`;
}

function countBy(rows, getter) {
  return rows.reduce((counts, row) => {
    const key = String(getter(row) || 'unknown');
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Expected integer in range ${min}..${max}, received ${value}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) parsed[key] = true;
    else {
      parsed[key] = next;
      index++;
    }
  }
  return parsed;
}
