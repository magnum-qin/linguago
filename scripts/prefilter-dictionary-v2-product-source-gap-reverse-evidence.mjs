import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  canonicalEnglishSpellingVariant,
  looksProperOrNamedEnglishAnchor
} from "./lib/source-gap-lexical-contract.mjs";

const DEFAULT_SOURCE_DB = "data/processed/linguago_v2_full.db";
const DEFAULT_PRODUCT_DB =
  "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";
const DEFAULT_SUPPLEMENTAL_SOURCE_DB =
  ".tmp/combined/openwn-word2word3-ja-apertium-wikidata-v3-evidence.db";
const DEFAULT_REPORT = "logs/product-coverage-gaps-clean-high-value.json";
const STRONG_SOURCES = {
  en: new Set(["ecdict"]),
  "pt-BR": new Set(["freedict-por-eng", "wikdict-pt-en"]),
  zh: new Set(["cc-cedict", "kaikki-zh", "wikdict-zh-en"]),
  ja: new Set(["jmdict", "wikdict-ja-en", "kaikki-ja"])
};
const FORWARD_SOURCES = {
  "pt-BR": new Set(["freedict-eng-por", "wikdict-en-pt"]),
  zh: new Set(["wikdict-en-zh"]),
  ja: new Set(["wikdict-en-ja"])
};
const STOPWORDS = new Set([
  "a", "an", "and", "as", "at", "be", "by", "for", "from", "in", "into", "is", "of", "on", "or",
  "the", "to", "with"
]);

const args = parseArgs(process.argv.slice(2));
const sourceDbPath = path.resolve(args["source-db"] || DEFAULT_SOURCE_DB);
const supplementalSourceDbArg = String(args["supplemental-source-db"] || "").trim();
const defaultSupplementalSourceDbPath = path.resolve(DEFAULT_SUPPLEMENTAL_SOURCE_DB);
const supplementalSourceDbPath = supplementalSourceDbArg.toLowerCase() === "none"
  ? null
  : supplementalSourceDbArg
    ? path.resolve(supplementalSourceDbArg)
    : fs.existsSync(defaultSupplementalSourceDbPath)
      ? defaultSupplementalSourceDbPath
      : null;
const reportPaths = String(args.report || DEFAULT_REPORT)
  .split(",")
  .map((value) => path.resolve(value.trim()));
const reportPath = reportPaths[0];
const outPath = path.resolve(args.out || defaultOutPath(reportPath));
const evidenceOutPath = path.resolve(args["evidence-out"] || defaultEvidenceOutPath(outPath));
const limit = boundedInteger(args.limit, 50, 1);
const minSources = boundedInteger(args["min-sources"], 1, 1);
const minSourceFamilies = boundedInteger(args["min-source-families"], 1, 1);
const minMatchRatio = boundedNumber(args["min-match-ratio"], 0.34, 0, 1);
const minTargetLangs = boundedInteger(args["min-target-langs"], 0, 0);
const requireOmwTargetLangs = boundedInteger(args["require-omw-target-langs"], 0, 0);
const requirePtPronunciation = args["require-pt-pronunciation"] === "true";
const requireJmdictHint = args["require-jmdict-hint"] === "true";
const requireAllTargetIndependentEvidence = args["require-all-target-independent-evidence"] === "true";
const minIndependentTargetFamilies = boundedInteger(
  args["min-independent-target-families"],
  2,
  1
);
const requireExistingLocalizationRoundtrip =
  args["require-existing-localization-roundtrip"] === "true";
const allowReviewedSupplementalSourceRoundtrip =
  args["allow-reviewed-supplemental-source-roundtrip"] === "true";
const allowedReviewedSupplementalSourceKeys = new Set(
  String(args["reviewed-supplemental-source-keys"] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
if (allowReviewedSupplementalSourceRoundtrip && !allowedReviewedSupplementalSourceKeys.size) {
  throw new Error(
    "--allow-reviewed-supplemental-source-roundtrip requires --reviewed-supplemental-source-keys"
  );
}
const minExistingLocalizationRoundtripFamilies = boundedInteger(
  args["min-existing-localization-roundtrip-families"],
  2,
  1
);
const strongSupplementalFamilies = new Set(
  String(args["strong-supplemental-families"] || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);
const strongSupplementalFamiliesByLang = parseLangFamilyMap(
  args["strong-supplemental-families-by-lang"]
);
const strongSupplementalSourceKeys = new Set(
  String(args["strong-supplemental-source-keys"] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
const allowedCandidateBoundRoundtripSourceKeys = new Set(
  String(args["candidate-bound-source-roundtrip-keys"] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
const ptPronunciationDbPath = path.resolve(
  args["pt-pronunciation-db"] || "data/processed/kaikki_portuguese_pronunciations.db"
);
const excludeCapitalizedAnchor = args["exclude-capitalized-anchor"] !== "false";
const excludeAmbiguousOmw = args["exclude-ambiguous-omw"] !== "false";
const lockHintsToUniqueWikidataConcept =
  args["lock-hints-to-unique-wikidata-concept"] === "true";
const requireSourceIdentity = args["require-source-identity"] !== "false";

for (const filePath of [
  sourceDbPath,
  ...(supplementalSourceDbPath ? [supplementalSourceDbPath] : []),
  ...reportPaths
]) {
  if (!fs.existsSync(filePath)) throw new Error(`Required file not found: ${filePath}`);
}
if (requirePtPronunciation && !fs.existsSync(ptPronunciationDbPath)) {
  throw new Error(`Portuguese pronunciation DB not found: ${ptPronunciationDbPath}`);
}

const reports = reportPaths.map((filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")));
const report = reports[0];
const excludeProductLinked = args["exclude-product-linked"] !== "false";
const productDbPath = path.resolve(args["product-db"] || report.product_db || DEFAULT_PRODUCT_DB);
const inputCandidatesByKey = new Map();
for (const sourceReport of reports) {
  for (const row of Array.isArray(sourceReport.selected) ? sourceReport.selected : []) {
    const key = String(row.candidate_key || `${row.source_entry_id || ''}:${row.first_sense_id || ''}`);
    if (!inputCandidatesByKey.has(key)) inputCandidatesByKey.set(key, row);
  }
}
const productLinkedSourceSenses = excludeProductLinked && fs.existsSync(productDbPath)
  ? loadProductLinkedSourceSenses(productDbPath)
  : new Set();
const candidatesBeforeProductExclusion = [...inputCandidatesByKey.values()];
const candidates = candidatesBeforeProductExclusion.filter(
  (row) => !productLinkedSourceSenses.has(candidateKey(row))
);
const db = new Database(sourceDbPath, { readonly: true, fileMustExist: true });
db.pragma("query_only = ON");
const supplementalDb = supplementalSourceDbPath
  ? new Database(supplementalSourceDbPath, { readonly: true, fileMustExist: true })
  : null;
supplementalDb?.pragma("query_only = ON");
const blockedSupplementalSourceKeys = new Set();
const blockedSupplementalFamilies = new Set(["panlex-unmapped"]);
const reviewedSupplementalSourceKeys = new Set();
const candidateBoundRoundtripSourceKeys = new Set();
if (
  supplementalDb?.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'evidence_sources'"
  ).get()
) {
  const sourceRows = supplementalDb.prepare(`
    SELECT source_key, source_family, license, metadata_json
    FROM evidence_sources
  `).all();
  const familyStatus = new Map();
  for (const row of sourceRows) {
    const metadata = safeJson(row.metadata_json);
    const productionPublishable = metadata.production_publishable !== false &&
      !/\b(?:cc\s*)?by-nc\b/i.test(String(row.license || ""));
    const family = String(row.source_family || "").trim().toLowerCase();
    if (!familyStatus.has(family)) familyStatus.set(family, []);
    familyStatus.get(family).push(productionPublishable);
    if (!productionPublishable) blockedSupplementalSourceKeys.add(row.source_key);
    if (
      productionPublishable &&
      metadata.reviewed_subset === true &&
      /independent_.+_and_.+confidence/iu.test(String(metadata.semantic_review || "")) &&
      allowedReviewedSupplementalSourceKeys.has(row.source_key)
    ) {
      reviewedSupplementalSourceKeys.add(row.source_key);
    }
    if (
      productionPublishable &&
      metadata.candidate_bound === true &&
      metadata.evidence_strength === "exact_reciprocal_candidate_bound" &&
      allowedCandidateBoundRoundtripSourceKeys.has(row.source_key)
    ) {
      candidateBoundRoundtripSourceKeys.add(row.source_key);
    }
  }
  for (const [family, statuses] of familyStatus) {
    if (family && statuses.length && statuses.every((status) => !status)) {
      blockedSupplementalFamilies.add(family);
    }
  }
}
const findSenses = db.prepare(`
  SELECT ds.source_key, se.word, ss.gloss, ss.raw_json
  FROM source_entries se
  JOIN dictionary_sources ds ON ds.id = se.source_id
  JOIN source_senses ss ON ss.source_entry_id = se.id
  WHERE se.normalized_key = ? AND se.lang = ?
  ORDER BY ds.source_key, ss.sense_order, ss.id
`);
const findSourceEntryIdentity = db.prepare(`
  SELECT id, word, normalized_key, source_lang
  FROM entries
  WHERE id = ?
`);
const findCanonicalTermFrequency = db.prepare(`
  SELECT frequency_rank
  FROM entries
  WHERE source_lang = ? AND normalized_key = ?
  ORDER BY frequency_rank IS NULL, frequency_rank, id
  LIMIT 1
`);
const canonicalTermFrequencyCache = new Map();
const findSourceSenseIdentity = db.prepare(`
  SELECT id, entry_id
  FROM senses
  WHERE id = ?
`);
const findJmdictTerm = db.prepare(`
  SELECT 1
  FROM source_entries se
  JOIN dictionary_sources ds ON ds.id = se.source_id
  WHERE ds.source_key = 'jmdict'
    AND se.lang = 'ja'
    AND se.normalized_key = ?
  LIMIT 1
`);
const findSupplementalByEnglish = supplementalDb?.prepare(`
  SELECT source_key, source_family, lang, term, english_gloss, concept_id
  FROM lexical_evidence
  WHERE english_normalized_key = ? AND lang = ?
  ORDER BY source_key, concept_id, term
`);
const findSupplementalByTerm = supplementalDb?.prepare(`
  SELECT source_key, source_family, lang, term, english_gloss, concept_id
  FROM lexical_evidence
  WHERE normalized_key = ? AND lang = ?
  ORDER BY source_key, concept_id, english_gloss
`);
const reverseGlossTargetIndexes = new Map([
  ["pt-BR", buildReverseGlossTargetIndexWithProgress(["freedict-por-eng", "wikdict-pt-en"], "pt-BR")],
  ["ja", buildReverseGlossTargetIndexWithProgress(["jmdict"], "ja")],
  ["zh", buildReverseGlossTargetIndexWithProgress(["cc-cedict", "wikdict-zh-en"], "zh")]
]);
const wikidataConceptRowsByEnglish = lockHintsToUniqueWikidataConcept && supplementalDb
  ? buildWikidataConceptIndex(supplementalDb)
  : null;
const ptPronunciationDb = requirePtPronunciation
  ? new Database(ptPronunciationDbPath, { readonly: true, fileMustExist: true })
  : null;
if (ptPronunciationDb) ptPronunciationDb.pragma("query_only = ON");
const findPtPronunciation = ptPronunciationDb?.prepare(`
  SELECT 1
  FROM portuguese_pronunciations
  WHERE normalized_key = ?
  LIMIT 1
`);

const validations = [];
for (const [index, candidate] of candidates.entries()) {
  validations.push(validateCandidate(candidate));
  if ((index + 1) % 100 === 0 || index + 1 === candidates.length) {
    console.log(`[reverse-evidence-prefilter] validated=${index + 1}/${candidates.length}`);
  }
}
const candidatesByKey = new Map(candidates.map((row) => [candidateKey(row), row]));
const supported = validations
  .filter((item) => item.decision === "supported" && item.target_coverage_count >= minTargetLangs)
  .sort(compareSupported);
const selected = supported.slice(0, limit).map((item) => ({
  ...candidatesByKey.get(candidateKey(item)),
  generation_hints: item.generation_hints,
  reverse_evidence_prefilter: {
    matching_sources: item.evidence?.matching_sources || [],
    match_ratio: item.evidence?.match_ratio ?? null,
    target_coverage_count: item.target_coverage_count,
    wikidata_hint_lock: item.wikidata_hint_lock
  }
}));
const summary = {
  input_rows_before_product_exclusion: candidatesBeforeProductExclusion.length,
  product_linked_rows_excluded: candidatesBeforeProductExclusion.length - candidates.length,
  input_rows: candidates.length,
  source_supported_rows: validations.filter((item) => item.decision === "supported").length,
  target_qualified_rows: supported.length,
  selected_rows: selected.length,
  manual_review_rows: validations.filter((item) => item.decision === "manual_review").length,
  unsupported_rows: validations.filter((item) => item.decision === "unsupported").length,
  selected_by_lang: countBy(selected.map((row) => row.source_lang)),
  decisions_by_lang: decisionsByLang(validations),
  minimum_matching_sources: minSources,
  minimum_matching_source_families: minSourceFamilies,
  minimum_match_ratio: minMatchRatio,
  minimum_target_languages: minTargetLangs,
  required_omw_target_languages: requireOmwTargetLangs,
  require_pt_pronunciation: requirePtPronunciation,
  require_jmdict_hint: requireJmdictHint,
  require_all_target_independent_evidence: requireAllTargetIndependentEvidence,
  require_existing_localization_roundtrip: requireExistingLocalizationRoundtrip,
  allow_reviewed_supplemental_source_roundtrip: allowReviewedSupplementalSourceRoundtrip,
  allowed_reviewed_supplemental_source_keys: [...allowedReviewedSupplementalSourceKeys].sort(),
  minimum_existing_localization_roundtrip_families: minExistingLocalizationRoundtripFamilies,
  strong_supplemental_families: [...strongSupplementalFamilies].sort(),
  strong_supplemental_families_by_lang: serializeLangFamilyMap(
    strongSupplementalFamiliesByLang
  ),
  strong_supplemental_source_keys: [...strongSupplementalSourceKeys].sort(),
  candidate_bound_source_roundtrip_keys: [...candidateBoundRoundtripSourceKeys].sort(),
  blocked_supplemental_source_keys: [...blockedSupplementalSourceKeys].sort(),
  reviewed_supplemental_source_keys: [...reviewedSupplementalSourceKeys].sort(),
  blocked_supplemental_families: [...blockedSupplementalFamilies].sort(),
  supplemental_source_db: supplementalSourceDbPath
    ? path.relative(process.cwd(), supplementalSourceDbPath)
    : null,
  product_db: fs.existsSync(productDbPath) ? path.relative(process.cwd(), productDbPath) : null,
  exclude_product_linked: excludeProductLinked,
  exclude_capitalized_anchor: excludeCapitalizedAnchor,
  exclude_ambiguous_omw: excludeAmbiguousOmw,
  lock_hints_to_unique_wikidata_concept: lockHintsToUniqueWikidataConcept,
  require_source_identity: requireSourceIdentity
};
const output = {
  ...report,
  ok: true,
  generated_at: new Date().toISOString(),
  source_report: reportPaths.map((filePath) => path.relative(process.cwd(), filePath)),
  reverse_evidence_report: path.relative(process.cwd(), evidenceOutPath),
  summary: { input_reports: reportPaths.length, reverse_evidence_prefilter: summary },
  selected_count: selected.length,
  selected
};
const evidenceOutput = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_db: path.relative(process.cwd(), sourceDbPath),
  supplemental_source_db: supplementalSourceDbPath
    ? path.relative(process.cwd(), supplementalSourceDbPath)
    : null,
  source_report: reportPaths.map((filePath) => path.relative(process.cwd(), filePath)),
  policy: {
    omw_only_auto_pass: false,
    minimum_matching_sources: minSources,
    minimum_matching_source_families: minSourceFamilies,
    minimum_match_ratio: minMatchRatio,
    minimum_target_languages: minTargetLangs,
    required_omw_target_languages: requireOmwTargetLangs,
    require_pt_pronunciation: requirePtPronunciation,
    require_jmdict_hint: requireJmdictHint,
    require_all_target_independent_evidence: requireAllTargetIndependentEvidence,
    minimum_independent_target_families: minIndependentTargetFamilies,
    require_existing_localization_roundtrip: requireExistingLocalizationRoundtrip,
    allow_reviewed_supplemental_source_roundtrip: allowReviewedSupplementalSourceRoundtrip,
    allowed_reviewed_supplemental_source_keys: [...allowedReviewedSupplementalSourceKeys].sort(),
    minimum_existing_localization_roundtrip_families: minExistingLocalizationRoundtripFamilies,
    strong_supplemental_families: [...strongSupplementalFamilies].sort(),
    strong_supplemental_families_by_lang: serializeLangFamilyMap(
      strongSupplementalFamiliesByLang
    ),
    strong_supplemental_source_keys: [...strongSupplementalSourceKeys].sort(),
    candidate_bound_source_roundtrip_keys: [...candidateBoundRoundtripSourceKeys].sort(),
    pt_pronunciation_db: requirePtPronunciation ? path.relative(process.cwd(), ptPronunciationDbPath) : null,
    exclude_capitalized_anchor: excludeCapitalizedAnchor,
    exclude_ambiguous_omw: excludeAmbiguousOmw,
    lock_hints_to_unique_wikidata_concept: lockHintsToUniqueWikidataConcept,
    require_source_identity: requireSourceIdentity
  },
  summary,
  validations
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
fs.writeFileSync(evidenceOutPath, `${JSON.stringify(evidenceOutput, null, 2)}\n`, "utf8");
db.close();
supplementalDb?.close();
ptPronunciationDb?.close();
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), evidence_out: path.relative(process.cwd(), evidenceOutPath), summary }, null, 2));

function validateCandidate(row) {
  const boundCandidateKey = candidateKey(row);
  const sourceLang = row.source_lang;
  const sourceTerm = String(row.word || "").trim();
  const anchor = englishAnchor(row);
  if (!sourceTerm || !anchor || !STRONG_SOURCES[sourceLang]) {
    return result(row, "unsupported", !sourceTerm ? "missing_source_term" : "missing_english_anchor");
  }
  if (requireSourceIdentity) {
    const sourceEntryId = Number(row.source_entry_id);
    const sourceSenseId = Number(row.first_sense_id ?? row.source_sense_id);
    const entry = Number.isInteger(sourceEntryId)
      ? findSourceEntryIdentity.get(sourceEntryId)
      : null;
    const sense = Number.isInteger(sourceSenseId)
      ? findSourceSenseIdentity.get(sourceSenseId)
      : null;
    const identityMatches =
      entry &&
      sense &&
      entry.source_lang === sourceLang &&
      normalizeTerm(entry.normalized_key) === normalizeTerm(sourceTerm) &&
      Number(sense.entry_id) === sourceEntryId;
    if (!identityMatches) {
      return result(row, "unsupported", "stale_source_identity_mismatch", null, {
        source_identity: {
          requested_entry_id: Number.isInteger(sourceEntryId) ? sourceEntryId : null,
          requested_sense_id: Number.isInteger(sourceSenseId) ? sourceSenseId : null,
          requested_word: sourceTerm,
          requested_lang: sourceLang,
          actual_entry_word: entry?.word ?? null,
          actual_entry_lang: entry?.source_lang ?? null,
          actual_sense_entry_id: sense?.entry_id ?? null
        }
      });
    }
  }
  if (excludeCapitalizedAnchor && looksProperOrNamedEnglishAnchor(anchor)) {
    return result(row, "unsupported", "capitalized_proper_or_named_english_anchor");
  }

  const rows = lookupVariants(sourceLang, sourceTerm).flatMap((term) => findSenses.all(normalizeTerm(term), sourceLang));
  const dictionaryEvidence = rows.flatMap((sourceRow) =>
    extractEvidence(sourceRow, sourceLang, anchor)
  );
  const supplementalEvidence = supplementalEvidenceForTerm(sourceLang, sourceTerm, anchor, boundCandidateKey);
  const evidence = [...dictionaryEvidence, ...supplementalEvidence];
  const strong = evidence.filter((item) => item.strength === "strong");
  const matches = strong.filter((item) => item.matches_anchor);
  const matchingSources = new Set(matches.map((item) => item.source));
  const matchingSourceFamilies = new Set(
    matches.map((item) => evidenceFamily(item.source, item.source_family))
  );
  const alignedOmw = alignedOmwTargetTerms(row, anchor);
  const unambiguousOmwSupport =
    !alignedOmw.ambiguous && alignedOmw.synsets.length === 1 && alignedOmw.targetCoverage > 0;
  if (unambiguousOmwSupport) {
    matchingSources.add("omw-30");
    matchingSourceFamilies.add("omw");
  }
  // Supplemental concept sources are additive evidence. Their unrelated senses
  // must not make a candidate that already passed dictionary ambiguity checks
  // fail merely because another evidence DB was attached.
  const dictionaryStrong = dictionaryEvidence.filter((item) => item.strength === "strong");
  const dictionaryMatches = dictionaryStrong.filter((item) => item.matches_anchor);
  const glosses = new Set(
    dictionaryStrong.map((item) => normalizeText(item.english_gloss)).filter(Boolean)
  );
  const matchingGlosses = new Set(
    dictionaryMatches.map((item) => normalizeText(item.english_gloss)).filter(Boolean)
  );
  const matchRatio = glosses.size ? matchingGlosses.size / glosses.size : 0;
  const details = {
    anchor,
    matching_sources: [...matchingSources],
    matching_source_families: [...matchingSourceFamilies],
    aligned_omw_synsets: alignedOmw.synsets,
    aligned_omw_target_coverage: alignedOmw.targetCoverage,
    aligned_omw_terms: alignedOmw.terms,
    aligned_omw_term_checks: explainAlignedOmwTerms(alignedOmw, anchor, sourceLang, boundCandidateKey),
    unambiguous_omw_support: unambiguousOmwSupport,
    match_ratio: round(matchRatio),
    matching_evidence: matches.slice(0, 12),
    nonmatching_evidence: strong.filter((item) => !item.matches_anchor).slice(0, 12)
  };

  if (
    matchingSources.size >= minSources &&
    matchingSourceFamilies.size >= minSourceFamilies &&
    (glosses.size <= 2 || matchRatio >= minMatchRatio)
  ) {
    const sourceRoundTrip = sourceLang === "en"
      ? true
      : sourceTermRoundTrips(sourceLang, sourceTerm, anchor, boundCandidateKey);
    if (!sourceRoundTrip) {
      return result(row, "unsupported", "english_anchor_does_not_translate_back_to_source_term", details);
    }
    const localizationRoundTrip = existingLocalizationsRoundTrip(row, anchor, boundCandidateKey);
    if (requireExistingLocalizationRoundtrip && !localizationRoundTrip.passed) {
      return result(row, "unsupported", "existing_localization_does_not_round_trip", details, {
        existing_localization_roundtrip: localizationRoundTrip
      });
    }
    if (requireOmwTargetLangs > 0 && excludeAmbiguousOmw && alignedOmw.ambiguous) {
      return result(row, "unsupported", "multiple_matching_omw_synsets", details, {
        matching_omw_synsets: alignedOmw.matchingSynsets
      });
    }
    const rawGenerationHints = buildGenerationHints(row, anchor, alignedOmw);
    const wikidataHintLock = lockGenerationHintsToUniqueWikidataConcept(
      rawGenerationHints,
      anchor
    );
    const generationHints = wikidataHintLock.generation_hints;
    const independentTargetEvidence = Object.entries(generationHints).filter(([lang, value]) =>
      lang !== sourceLang &&
      lang !== "en" &&
      Array.isArray(value?.evidence_families) &&
      value.evidence_families.length >= minIndependentTargetFamilies
    ).length;
    const requiredIndependentTargets = ["pt-BR", "zh", "ja"].filter(
      (lang) => lang !== sourceLang
    ).length;
    if (requireAllTargetIndependentEvidence && independentTargetEvidence < requiredIndependentTargets) {
      return result(row, "unsupported", "insufficient_independent_target_evidence", details, {
        generation_hints: generationHints,
        independent_target_evidence_count: independentTargetEvidence,
        required_independent_target_evidence_count: requiredIndependentTargets
      });
    }
    if (requirePtPronunciation && !hintHasPtPronunciation(generationHints)) {
      return result(row, "unsupported", "missing_deterministic_pt_br_pronunciation", details, {
        generation_hints: generationHints
      });
    }
    if (requireJmdictHint && !hintHasJmdictTerm(generationHints)) {
      return result(row, "unsupported", "missing_jmdict_generation_hint", details, {
        generation_hints: generationHints
      });
    }
    const omwTargetCoverageCount = Object.entries(generationHints).filter(
      ([lang, value]) => lang !== sourceLang && lang !== "en" && value?.provenance === "omw_synset" && value.terms?.length
    ).length;
    if (omwTargetCoverageCount < requireOmwTargetLangs) {
      return result(row, "unsupported", "insufficient_same_synset_target_coverage", details, {
        generation_hints: generationHints,
        omw_target_coverage_count: omwTargetCoverageCount
      });
    }
    // For a non-English source, the independently supported English anchor is
    // also one of the three target languages. Excluding it made a
    // --min-target-langs=3 gate impossible for zh/ja/pt-BR candidates.
    const targetCoverageCount = Object.keys(generationHints).filter(
      (lang) => lang !== sourceLang && generationHints[lang]?.terms?.length
    ).length;
    return result(row, "supported", "strong_reverse_dictionary_evidence", details, {
      generation_hints: generationHints,
      wikidata_hint_lock: wikidataHintLock.audit,
      target_coverage_count: targetCoverageCount,
      omw_target_coverage_count: omwTargetCoverageCount
    });
  }
  if (matchingSources.size >= minSources && matchingSourceFamilies.size >= minSourceFamilies) {
    return result(row, "manual_review", "polysemous_source_term_low_match_ratio", details);
  }
  if (strong.length) return result(row, "unsupported", "strong_dictionary_gloss_conflict", details);
  return result(row, "manual_review", "no_strong_reverse_dictionary_evidence", details);
}

function loadProductLinkedSourceSenses(filePath) {
  const productDb = new Database(filePath, { readonly: true, fileMustExist: true });
  productDb.pragma("query_only = ON");
  const rows = productDb.prepare(`
    SELECT DISTINCT link.source_entry_id, link.source_sense_id
    FROM product_sense_source_links link
    JOIN product_senses sense ON sense.id = link.product_sense_id
    WHERE link.source_entry_id IS NOT NULL
      AND link.source_sense_id IS NOT NULL
      AND sense.status IN ('accepted', 'draft_single_source', 'needs_review')
  `).all();
  productDb.close();
  return new Set(rows.map((row) => `${Number(row.source_entry_id)}:${Number(row.source_sense_id)}`));
}

function evidenceFamily(source, explicitFamily = null) {
  const family = String(explicitFamily || "").trim().toLowerCase();
  if (family) return family;
  const key = String(source || "").trim().toLowerCase();
  if (key.startsWith("wikdict-") || key.startsWith("kaikki-")) return "wiktionary";
  if (key.startsWith("omw-")) return "omw";
  if (key.startsWith("freedict-")) return "freedict";
  if (key === "cc-cedict") return "cc-cedict";
  if (key === "jmdict") return "jmdict";
  if (key === "ecdict") return "ecdict";
  return key || "unknown";
}

function hintHasPtPronunciation(generationHints) {
  return (generationHints["pt-BR"]?.terms || []).some((term) =>
    findPtPronunciation.get(normalizePtPronunciationKey(term))
  );
}

function hintHasJmdictTerm(generationHints) {
  return (generationHints.ja?.terms || []).some((term) => findJmdictTerm.get(normalizeTerm(term)));
}

function sourceTermRoundTrips(lang, sourceTerm, anchor, boundCandidateKey) {
  const dictionaryRoundTrip = findForwardTargetTerms(anchor, lang, boundCandidateKey).some((item) =>
    item.terms.some((term) => termsEquivalent(lang, term, sourceTerm))
  );
  if (dictionaryRoundTrip) return true;
  const supplemental = supplementalEvidenceForTerm(lang, sourceTerm, anchor, boundCandidateKey);
  if (supplemental.some((item) =>
    item.strength === "strong" &&
    item.matches_anchor === true &&
    candidateBoundRoundtripSourceKeys.has(item.source)
  )) return true;
  if (!allowReviewedSupplementalSourceRoundtrip) return false;
  return supplemental.some((item) =>
    item.strength === "strong" &&
    item.matches_anchor === true &&
    reviewedSupplementalSourceKeys.has(item.source)
  );
}

function existingLocalizationsRoundTrip(row, anchor, boundCandidateKey) {
  const localizations = Array.isArray(row.first_sense_localizations)
    ? row.first_sense_localizations
    : [];
  const targetLocalizations = localizations.filter(
    (item) => item?.lang && item.lang !== "en" && item.lang !== row.source_lang
  );
  const checks = targetLocalizations.map((item) => {
    const termChecks = splitTerms(item.term).map((term) => {
      const families = [...targetTermRoundTripFamilies(item.lang, term, anchor, boundCandidateKey)].sort();
      return {
        term,
        evidence_families: families,
        evidence_family_count: families.length,
        passed: families.length >= minExistingLocalizationRoundtripFamilies
      };
    });
    return {
      lang: item.lang,
      passed: termChecks.some((term) => term.passed),
      terms: termChecks
    };
  });
  return {
    passed: checks.every((item) => item.passed),
    minimum_families: minExistingLocalizationRoundtripFamilies,
    checks
  };
}

function targetTermRoundTripFamilies(lang, term, anchor, boundCandidateKey) {
  const families = new Set();
  const rows = lookupVariants(lang, term).flatMap((variant) =>
    findSenses.all(normalizeTerm(variant), lang)
  );
  for (const item of rows.flatMap((row) => extractEvidence(row, lang, anchor))) {
    if (item.strength === "strong" && item.matches_anchor) {
      families.add(evidenceFamily(item.source, item.source_family));
    }
  }
  for (const item of supplementalEvidenceForTerm(lang, term, anchor, boundCandidateKey)) {
    if (item.matches_anchor) families.add(evidenceFamily(item.source, item.source_family));
  }
  return families;
}

function buildGenerationHints(row, anchor, alignedOmw = alignedOmwTargetTerms(row, anchor)) {
  const hints = {};
  const boundCandidateKey = candidateKey(row);
  const sourceLang = row.source_lang;
  const sourceTerm = String(row.word || "").trim();
  if (sourceLang === "en") {
    hints.en = {
      terms: [sourceTerm],
      sources: ["source_term"]
    };
  } else {
    hints.en = {
      terms: anchorCandidates(anchor).slice(0, 6),
      sources: ["source_english_anchor"]
    };
  }
  for (const lang of ["pt-BR", "zh", "ja"]) {
    if (lang === sourceLang) {
      hints[lang] = { terms: [sourceTerm], sources: ["source_term"] };
      continue;
    }
    const repair = [
      ...(Array.isArray(row?.target_term_repairs) ? row.target_term_repairs : []),
      ...(row?.target_term_repair ? [row.target_term_repair] : [])
    ].find((item) => item?.target_lang === lang);
    const repairedTerms = repair
      ? unique(repair.terms || []).filter((term) =>
          targetTermHasReverseSupport(lang, term, anchor, boundCandidateKey)
        )
      : [];
    const orderedRepairedTerms = repairedTerms.length
      ? orderGenerationHintTerms(lang, repairedTerms, anchor, "dictionary_validated_target_repair", boundCandidateKey)
      : [];
    const repairedFamilies = orderedRepairedTerms.length
      ? generationHintEvidenceFamilies(
          lang,
          orderedRepairedTerms[0],
          anchor,
          "dictionary_validated_target_repair",
          boundCandidateKey
        )
      : [];
    if (repairedFamilies.length >= minIndependentTargetFamilies) {
      hints[lang] = {
        terms: orderedRepairedTerms.slice(0, 6),
        sources: ["target-term-repair-v1"],
        provenance: "dictionary_validated_target_repair",
        evidence_families: repairedFamilies
      };
      continue;
    }
    // A term from the same unambiguous OMW synset is concept-bound evidence.
    // Prefer it over a plain reverse-gloss hit, which may select a related but
    // broader, narrower, or otherwise incompatible sense.
    const omwTerms = alignedOmwHintTerms(
      alignedOmw,
      lang,
      anchor,
      boundCandidateKey
    );
    if (omwTerms.length) {
      const orderedTerms = orderGenerationHintTerms(lang, omwTerms, anchor, "omw_synset", boundCandidateKey);
      hints[lang] = {
        terms: orderedTerms.slice(0, 6),
        sources: ["omw-30", ...unique(alignedOmw.synsets || []).map((synset) => `omw:${synset}`)],
        provenance: "omw_synset",
        evidence_families: generationHintEvidenceFamilies(lang, orderedTerms[0], anchor, "omw_synset", boundCandidateKey)
      };
      continue;
    }
    const lexicalReverseGlossMatches = findReverseGlossTargetTerms(anchor, lang).filter((item) =>
      targetTermHasReverseSupport(lang, item.term, anchor, boundCandidateKey)
    );
    if (lexicalReverseGlossMatches.length) {
      const terms = unique(lexicalReverseGlossMatches.map((item) => item.term));
      const priorityByTerm = new Map();
      for (const item of lexicalReverseGlossMatches) {
        const key = normalizeTerm(item.term);
        const priority = Number(item.anchor_priority || 0);
        priorityByTerm.set(key, Math.min(priorityByTerm.get(key) ?? Infinity, priority));
      }
      const orderedTerms = [...terms].sort((left, right) => {
        const priorityDifference =
          (priorityByTerm.get(normalizeTerm(left)) ?? Infinity) -
          (priorityByTerm.get(normalizeTerm(right)) ?? Infinity);
        if (priorityDifference) return priorityDifference;
        return compareGenerationHintTerms(
          lang, left, right, anchor, "reverse_dictionary_gloss", boundCandidateKey
        );
      });
      hints[lang] = {
        terms: orderedTerms.slice(0, 6),
        sources: unique(lexicalReverseGlossMatches.map((item) => item.source)),
        provenance: "reverse_dictionary_gloss",
        evidence_families: generationHintEvidenceFamilies(
          lang,
          orderedTerms[0],
          anchor,
          "reverse_dictionary_gloss",
          boundCandidateKey
        )
      };
      continue;
    }
    const supplementalMatches = findSupplementalTargetTerms(anchor, lang, boundCandidateKey).filter((item) =>
      targetTermHasReverseSupport(lang, item.term, anchor, boundCandidateKey)
    );
    if (supplementalMatches.length) {
      const terms = unique(supplementalMatches.map((item) => item.term));
      const orderedTerms = orderGenerationHintTerms(lang, terms, anchor, "open_wordnet", boundCandidateKey);
      hints[lang] = {
        terms: orderedTerms.slice(0, 6),
        sources: unique(supplementalMatches.map((item) => item.source_key)),
        provenance: "open_wordnet",
        evidence_families: generationHintEvidenceFamilies(
          lang,
          orderedTerms[0],
          anchor,
          "open_wordnet",
          boundCandidateKey
        )
      };
      continue;
    }
    const matches = findForwardTargetTerms(anchor, lang, boundCandidateKey);
    if (matches.length) {
      const terms = unique(matches.flatMap((item) => item.terms));
      const orderedTerms = orderGenerationHintTerms(lang, terms, anchor, "forward_reverse_dictionary", boundCandidateKey);
      hints[lang] = {
        terms: orderedTerms.slice(0, 6),
        sources: unique(matches.map((item) => item.source)),
        provenance: "forward_reverse_dictionary",
        evidence_families: generationHintEvidenceFamilies(
          lang,
          orderedTerms[0],
          anchor,
          "forward_reverse_dictionary",
          boundCandidateKey
        )
      };
    }
  }
  return hints;
}

function lockGenerationHintsToUniqueWikidataConcept(generationHints, anchor) {
  if (!lockHintsToUniqueWikidataConcept || !wikidataConceptRowsByEnglish) {
    return { generation_hints: generationHints, audit: { enabled: false, locked: false } };
  }

  const rows = anchorCandidates(anchor).flatMap((candidate) =>
    wikidataConceptRowsByEnglish.get(normalizeTerm(candidate)) || []
  );
  const concepts = new Map();
  for (const row of rows) {
    if (!row.concept_id || !generationHints[row.lang]?.terms?.length) continue;
    if (!concepts.has(row.concept_id)) concepts.set(row.concept_id, new Map());
    const byLang = concepts.get(row.concept_id);
    if (!byLang.has(row.lang)) byLang.set(row.lang, []);
    byLang.get(row.lang).push(row.term);
  }

  const requiredLangs = Object.keys(generationHints);
  const qualified = [];
  for (const [conceptId, termsByLang] of concepts) {
    const lockedTerms = {};
    let valid = true;
    for (const lang of requiredLangs) {
      const hintKeys = new Set(generationHints[lang].terms.map(normalizeTerm));
      const matches = unique(termsByLang.get(lang) || []).filter((term) =>
        hintKeys.has(normalizeTerm(term))
      );
      if (matches.length !== 1) {
        valid = false;
        break;
      }
      lockedTerms[lang] = matches[0];
    }
    if (valid) qualified.push({ concept_id: conceptId, terms: lockedTerms });
  }

  if (qualified.length !== 1) {
    return {
      generation_hints: generationHints,
      audit: {
        enabled: true,
        locked: false,
        qualified_concept_count: qualified.length,
        qualified_concept_ids: qualified.map((item) => item.concept_id)
      }
    };
  }

  const match = qualified[0];
  const lockedHints = Object.fromEntries(
    Object.entries(generationHints).map(([lang, value]) => [
      lang,
      {
        ...value,
        terms: [match.terms[lang]],
        wikidata_concept_lock: match.concept_id
      }
    ])
  );
  return {
    generation_hints: lockedHints,
    audit: {
      enabled: true,
      locked: true,
      concept_id: match.concept_id,
      terms: match.terms
    }
  };
}

function buildWikidataConceptIndex(database) {
  const index = new Map();
  const rows = database.prepare(`
    SELECT source_key, source_family, lang, term, english_gloss,
      english_normalized_key, concept_id
    FROM lexical_evidence
    WHERE source_family = 'wikidata'
    ORDER BY english_normalized_key, concept_id, lang, term
  `).all();
  for (const row of rows) {
    if (!index.has(row.english_normalized_key)) index.set(row.english_normalized_key, []);
    index.get(row.english_normalized_key).push(row);
  }
  return index;
}

function orderGenerationHintTerms(lang, terms, anchor, provenance, boundCandidateKey) {
  return [...terms].sort((left, right) =>
    compareGenerationHintTerms(lang, left, right, anchor, provenance, boundCandidateKey)
  );
}

function compareGenerationHintTerms(lang, left, right, anchor, provenance, boundCandidateKey) {
  if (lang === "zh") {
    const mainlandDifference =
      mainlandChineseTermPriority(left) - mainlandChineseTermPriority(right);
    if (mainlandDifference) return mainlandDifference;
    const frequencyDifference =
      canonicalTermFrequency(lang, left) - canonicalTermFrequency(lang, right);
    if (frequencyDifference) return frequencyDifference;
  }
  const familyDifference =
    generationHintEvidenceFamilies(lang, right, anchor, provenance, boundCandidateKey).length -
    generationHintEvidenceFamilies(lang, left, anchor, provenance, boundCandidateKey).length;
  if (familyDifference) return familyDifference;
  if (lang !== "pt-BR" || !findPtPronunciation) return 0;
  const leftHasPronunciation = Boolean(findPtPronunciation.get(normalizePtPronunciationKey(left)));
  const rightHasPronunciation = Boolean(findPtPronunciation.get(normalizePtPronunciationKey(right)));
  return Number(rightHasPronunciation) - Number(leftHasPronunciation);
}

function canonicalTermFrequency(lang, term) {
  const cacheKey = `${lang}\u0000${normalizeTerm(term)}`;
  if (canonicalTermFrequencyCache.has(cacheKey)) {
    return canonicalTermFrequencyCache.get(cacheKey);
  }
  let bestRank = Number.MAX_SAFE_INTEGER;
  for (const variant of lookupVariants(lang, term)) {
    const rank = Number(
      findCanonicalTermFrequency.get(lang, normalizeTerm(variant))?.frequency_rank
    );
    if (Number.isFinite(rank) && rank > 0) bestRank = Math.min(bestRank, rank);
  }
  canonicalTermFrequencyCache.set(cacheKey, bestRank);
  return bestRank;
}

function mainlandChineseTermPriority(value) {
  const term = normalizeTerm(value);
  // Keep this list narrow and evidence-backed. These are Taiwan/legacy unit
  // forms that must not outrank the modern mainland term when both exist.
  if (term === "千升") return 0;
  if (new Set(["公秉", "千公升", "竏", "千竔"]).has(term)) return 2;
  return 1;
}

function generationHintEvidenceFamilies(lang, term, anchor, provenance, boundCandidateKey) {
  if (!term) return [];
  const families = new Set();
  for (const row of lookupVariants(lang, term).flatMap((variant) => findSenses.all(normalizeTerm(variant), lang))) {
    for (const item of extractEvidence(row, lang, anchor)) {
      if (item.strength === "strong" && item.matches_anchor) families.add(evidenceFamily(item.source));
    }
  }
  if (provenance === "omw_synset") families.add("omw");
  if (provenance === "open_wordnet") families.add("omw");
  if (findSupplementalByTerm) {
    for (const row of lookupVariants(lang, term).flatMap((variant) =>
      findSupplementalByTerm.all(normalizeTerm(variant), lang)
    )) {
      if (
        supplementalRowMatchesCandidate(row, boundCandidateKey) &&
        supplementalFamilyIsEligible(row.source_family, row.source_key) &&
        lexicalMatch(anchor, row.english_gloss)
      ) {
        families.add(row.source_family || "omw");
      }
    }
  }
  return [...families].sort();
}

function findSupplementalTargetTerms(anchor, lang, boundCandidateKey) {
  if (!findSupplementalByEnglish || !new Set(["pt-BR", "zh", "ja"]).has(lang)) return [];
  const rows = anchorCandidates(anchor).flatMap((candidate) =>
    findSupplementalByEnglish.all(normalizeTerm(candidate), lang)
  );
  const seen = new Set();
  return rows.filter((row) => {
    if (!supplementalRowMatchesCandidate(row, boundCandidateKey)) return false;
    if (!supplementalFamilyIsEligible(row.source_family, row.source_key)) return false;
    if (!lexicalMatch(anchor, row.english_gloss)) return false;
    const key = `${row.source_key}\u0000${normalizeTerm(row.term)}\u0000${row.concept_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function alignedOmwTargetTerms(row, anchor) {
  const candidates = [];
  for (const sourceRow of lookupVariants(row.source_lang, row.word).flatMap((term) =>
    findSenses.all(normalizeTerm(term), row.source_lang)
  )) {
    if (sourceRow.source_key !== "omw-30") continue;
    const raw = safeJson(sourceRow.raw_json);
    const englishTerms = asStrings(raw.localizations?.en);
    if (!englishTerms.some((term) => lexicalMatch(anchor, term))) continue;
    const terms = {};
    for (const lang of ["pt-BR", "zh", "ja"]) {
      terms[lang] = asStrings(raw.localizations?.[lang]);
    }
    const targetCoverage = ["pt-BR", "zh", "ja"].filter(
      (lang) => lang !== row.source_lang && terms[lang]?.length
    ).length;
    candidates.push({ terms, synsets: raw.synset ? [String(raw.synset)] : [], targetCoverage });
  }
  const uniqueCandidates = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = candidate.synsets[0] || JSON.stringify(candidate.terms);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueCandidates.push(candidate);
  }
  uniqueCandidates.sort((left, right) => right.targetCoverage - left.targetCoverage);
  const best = uniqueCandidates[0] || { terms: {}, synsets: [], targetCoverage: 0 };
  const matchingSynsets = uniqueCandidates
    .filter((candidate) => candidate.targetCoverage >= best.targetCoverage)
    .flatMap((candidate) => candidate.synsets);
  return {
    ...best,
    ambiguous: new Set(matchingSynsets).size > 1,
    matchingSynsets: unique(matchingSynsets)
  };
}

function findForwardTargetTerms(anchor, lang, boundCandidateKey = null) {
  const allowedSources = FORWARD_SOURCES[lang];
  if (!allowedSources) return [];
  const results = [];
  for (const candidate of anchorCandidates(anchor)) {
    for (const row of findSenses.all(normalizeTerm(candidate), "en")) {
      if (!allowedSources.has(row.source_key)) continue;
      const raw = safeJson(row.raw_json);
      const terms = unique([...asStrings(raw.translations), ...splitTerms(row.gloss)]).filter((term) =>
        targetTermHasReverseSupport(lang, term, anchor, boundCandidateKey)
      );
      if (terms.length) results.push({ source: row.source_key, terms });
    }
  }
  return results;
}

function buildReverseGlossTargetIndexWithProgress(sourceKeys, lang) {
  const startedAt = Date.now();
  console.log(`[reverse-evidence-prefilter] index_start lang=${lang}`);
  const index = buildReverseGlossTargetIndex(sourceKeys, lang);
  console.log(
    `[reverse-evidence-prefilter] index_complete lang=${lang} keys=${index.size} seconds=${(
      (Date.now() - startedAt) /
      1000
    ).toFixed(1)}`
  );
  return index;
}

function buildReverseGlossTargetIndex(sourceKeys, lang) {
  const index = new Map();
  const keys = Array.isArray(sourceKeys) ? sourceKeys : [sourceKeys];
  if (!keys.length) return index;
  const rows = db.prepare(`
    SELECT ds.source_key, se.word, ss.gloss
    FROM source_entries se
    JOIN dictionary_sources ds ON ds.id = se.source_id
    JOIN source_senses ss ON ss.source_entry_id = se.id
    WHERE ds.source_key IN (${keys.map(() => '?').join(', ')}) AND se.lang = ?
    ORDER BY se.id, ss.id
  `).all(...keys, lang);
  for (const row of rows) {
    const term = String(row.word || "").trim();
    if (!term) continue;
    const glossParts = unique([row.gloss, ...splitTerms(row.gloss)]);
    for (const key of unique(glossParts.flatMap(conservativeGlossKeys))) {
      if (!index.has(key)) index.set(key, []);
      const terms = index.get(key);
      const maximumTerms = lang === "zh" ? 64 : 12;
      if (!terms.some((item) => normalizeTerm(item.term) === normalizeTerm(term))) {
        terms.push({ source: row.source_key, term });
        if (lang === "zh") {
          terms.sort((left, right) => {
            const mainlandDifference =
              mainlandChineseTermPriority(left.term) - mainlandChineseTermPriority(right.term);
            if (mainlandDifference) return mainlandDifference;
            return left.term.localeCompare(right.term, "zh-CN");
          });
        }
        if (terms.length > maximumTerms) terms.length = maximumTerms;
      }
    }
  }
  return index;
}

function findReverseGlossTargetTerms(anchor, lang) {
  const index = reverseGlossTargetIndexes.get(lang);
  if (!index) return [];
  const seen = new Set();
  const rows = [];
  const anchorParts = unique(anchorCandidates(anchor));
  const anchorPriorityByVariant = new Map();
  for (const [anchorIndex, anchorPart] of anchorParts.entries()) {
    const variantKey = canonicalEnglishSpellingVariant(anchorPart);
    if (!anchorPriorityByVariant.has(variantKey)) {
      anchorPriorityByVariant.set(variantKey, anchorIndex);
    }
    const anchorPriority = anchorPriorityByVariant.get(variantKey);
    for (const key of conservativeGlossKeys(anchorPart)) {
      for (const row of index.get(key) || []) {
      const identity = `${row.source}\u0000${normalizeTerm(row.term)}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
        rows.push({ ...row, anchor_priority: anchorPriority });
      }
    }
  }
  return rows;
}

function conservativeGlossKeys(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 100 || /[.!?;]\s*$/u.test(text)) return [];
  const candidates = [text];
  const withoutTrailingQualifier = text.replace(/\s+\([^()]*(?:\([^()]*\)[^()]*)*\)\s*$/u, "").trim();
  if (withoutTrailingQualifier && withoutTrailingQualifier !== text) candidates.push(withoutTrailingQualifier);
  for (const candidate of [...candidates]) {
    if (/^to\s+\S/iu.test(candidate)) candidates.push(candidate.replace(/^to\s+/iu, ""));
  }
  return unique(candidates.map(normalizeText).filter((item) => item && !STOPWORDS.has(item)));
}

function targetTermHasReverseSupport(lang, term, anchor, boundCandidateKey = null) {
  const rows = lookupVariants(lang, term).flatMap((variant) => findSenses.all(normalizeTerm(variant), lang));
  const dictionaryEvidence = rows.flatMap((row) => extractEvidence(row, lang, anchor));
  const strong = dictionaryEvidence.filter((item) => item.strength === "strong");
  const strongMatches = strong.filter((item) => item.matches_anchor);
  const supplementalMatches = supplementalEvidenceForTerm(
    lang,
    term,
    anchor,
    boundCandidateKey
  ).filter((item) =>
    item.strength === "strong" &&
    item.matches_anchor === true &&
    (
      reviewedSupplementalSourceKeys.has(item.source) ||
      candidateBoundRoundtripSourceKeys.has(item.source)
    )
  );
  // A candidate-bound dictionary definition can fill a previously empty target
  // lane only when it either passed the dual-model review contract or was
  // exported as an exact reciprocal candidate-bound dictionary row. Both paths
  // require an explicit source-key allowlist and strong classification.
  if (!strongMatches.length) return supplementalMatches.length > 0;
  const omwMatches = dictionaryEvidence.filter(
    (item) => evidenceFamily(item.source, item.source_family) === "omw" && item.matches_anchor
  );
  const glosses = new Set(strong.map((item) => normalizeText(item.english_gloss)).filter(Boolean));
  const matchingGlosses = new Set(strongMatches.map((item) => normalizeText(item.english_gloss)).filter(Boolean));
  // An exact strong-dictionary match plus the same OMW lexical match is two
  // independent source families even when the target term is polysemous.
  // This avoids rejecting a valid sense solely because unrelated strong-dictionary
  // senses make a 1/3 match fall just below the global 0.34 ratio threshold.
  return Boolean(
    omwMatches.length || glosses.size <= 2 || matchingGlosses.size / glosses.size >= minMatchRatio
  );
}

function explainAlignedOmwTerms(alignedOmw, anchor, sourceLang, boundCandidateKey) {
  const checks = {};
  for (const lang of ["pt-BR", "zh", "ja"]) {
    if (lang === sourceLang) continue;
    checks[lang] = unique(alignedOmw.terms?.[lang] || []).map((term) => {
      const rows = lookupVariants(lang, term).flatMap((variant) =>
        findSenses.all(normalizeTerm(variant), lang)
      );
      const strong = rows
        .flatMap((row) => extractEvidence(row, lang, anchor))
        .filter((item) => item.strength === "strong");
      return {
        term,
        supported: targetTermHasReverseSupport(lang, term, anchor, boundCandidateKey),
        strong_evidence: strong.slice(0, 12)
      };
    });
  }
  return checks;
}

function alignedOmwHintTerms(alignedOmw, lang, anchor, boundCandidateKey) {
  if (alignedOmw.ambiguous || alignedOmw.synsets.length !== 1) return [];
  const candidates = unique(alignedOmw.terms?.[lang] || []).map((term) => {
    const rows = lookupVariants(lang, term).flatMap((variant) =>
      findSenses.all(normalizeTerm(variant), lang)
    );
    const strongEvidence = rows
      .flatMap((row) => extractEvidence(row, lang, anchor))
      .filter((item) => item.strength === "strong");
    return {
      term,
      exactReverse: targetTermHasReverseSupport(lang, term, anchor, boundCandidateKey),
      hasIndependentDictionaryEntry: strongEvidence.length > 0
    };
  });
  return candidates
    .filter((item) => item.exactReverse || item.hasIndependentDictionaryEntry)
    .sort((left, right) => Number(right.exactReverse) - Number(left.exactReverse))
    .map((item) => item.term);
}

function supplementalEvidenceForTerm(lang, term, anchor, boundCandidateKey = null) {
  if (!findSupplementalByTerm) return [];
  const seen = new Set();
  const evidence = [];
  for (const row of lookupVariants(lang, term).flatMap((variant) =>
    findSupplementalByTerm.all(normalizeTerm(variant), lang)
  )) {
    if (!supplementalRowMatchesCandidate(row, boundCandidateKey)) continue;
    if (!supplementalFamilyIsEligible(row.source_family, row.source_key)) continue;
    const key = `${row.source_key}\u0000${normalizeText(row.english_gloss)}\u0000${row.concept_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    evidence.push({
      source: row.source_key,
      source_family: row.source_family,
      concept_id: row.concept_id || null,
      english_gloss: row.english_gloss,
      matches_anchor: lexicalMatch(anchor, row.english_gloss),
      strength: supplementalFamilyIsStrong(lang, row.source_family, row.source_key)
        ? "strong"
        : "weak"
    });
  }
  return evidence;
}

function supplementalRowMatchesCandidate(row, boundCandidateKey) {
  const match = /^(?:candidate:|dicionario-aberto-definition:)(.+)$/u.exec(
    String(row?.concept_id || "").trim()
  );
  if (!match) return true;
  return Boolean(boundCandidateKey) && match[1] === boundCandidateKey;
}

function supplementalFamilyIsEligible(value, sourceKey) {
  const family = String(value || "").trim().toLowerCase();
  return !blockedSupplementalFamilies.has(family) &&
    !blockedSupplementalSourceKeys.has(sourceKey);
}

function supplementalFamilyIsStrong(lang, family, sourceKey) {
  const normalizedFamily = String(family || "").trim().toLowerCase();
  return (
    strongSupplementalSourceKeys.has(String(sourceKey || "").trim()) ||
    strongSupplementalFamilies.has(normalizedFamily) ||
    strongSupplementalFamiliesByLang.get(lang)?.has(normalizedFamily) === true
  );
}

function parseLangFamilyMap(value) {
  const result = new Map();
  for (const item of String(value || "").split(",")) {
    const [lang, family, ...extra] = item.split(":").map((part) => part.trim());
    if (!lang && !family) continue;
    if (extra.length || !["en", "pt-BR", "zh", "ja"].includes(lang) || !family) {
      throw new Error(`Invalid --strong-supplemental-families-by-lang item: ${item}`);
    }
    if (!result.has(lang)) result.set(lang, new Set());
    result.get(lang).add(family.toLowerCase());
  }
  return result;
}

function serializeLangFamilyMap(value) {
  return Object.fromEntries(
    [...value.entries()].map(([lang, families]) => [lang, [...families].sort()])
  );
}

function englishAnchor(row) {
  const localizations = Array.isArray(row.first_sense_localizations) ? row.first_sense_localizations : [];
  const english = localizations.find((item) => item?.lang === "en" && String(item.term || "").trim());
  if (english) return String(english.term).trim();
  const gloss = String(row.gloss_key || row.gloss_preview || "").trim();
  return /[A-Za-z]/u.test(gloss) ? gloss : "";
}

function extractEvidence(row, lang, anchor) {
  const source = row.source_key;
  const raw = safeJson(row.raw_json);
  const strength = STRONG_SOURCES[lang]?.has(source) ? "strong" : "weak";
  const glosses = [];
  if (strength === "strong") {
    if (source === "ecdict") glosses.push(row.word);
    else if (String(raw.target_lang || "") === "en") glosses.push(...asStrings(raw.translations), row.gloss);
    else glosses.push(...englishGlosses(row.gloss, raw));
  } else if (source === "omw-30") {
    glosses.push(...asStrings(raw.localizations?.en));
  }
  return unique(glosses).map((englishGloss) => ({
    source,
    english_gloss: englishGloss,
    matches_anchor: lexicalMatch(anchor, englishGloss),
    strength
  }));
}

function englishGlosses(gloss, raw) {
  const values = [...asStrings(raw.gloss), ...asStrings(raw.glosses)];
  if (raw.definition) values.push(raw.definition);
  const text = String(gloss || "").trim();
  const labeled = text.match(/(?:^|\|)\s*en\s*:\s*([^|]+)/iu);
  if (labeled) values.push(...splitTerms(labeled[1]));
  else if (text && /[A-Za-z]/u.test(text)) values.push(...splitTerms(text));
  return unique(values);
}

function lexicalMatch(left, right) {
  const leftCompact = compactLexicalForms(left);
  const rightCompact = compactLexicalForms(right);
  if ([...leftCompact].some((value) => rightCompact.has(value))) return true;
  const leftTokens = contentTokens(left);
  const rightTokens = contentTokens(right);
  if (!leftTokens.size || !rightTokens.size) return false;
  for (const a of leftTokens) {
    for (const b of rightTokens) {
      if (
        a === b ||
        setsOverlap(inflectionForms(a), inflectionForms(b)) ||
        derivationalStem(a) === derivationalStem(b)
      ) return true;
    }
  }
  for (const leftVariant of compactVariants(left)) {
    for (const rightVariant of compactVariants(right)) {
      if (
        leftVariant.length >= 6 &&
        rightVariant.length >= 6 &&
        levenshteinDistance(leftVariant, rightVariant) <= 1
      ) return true;
    }
  }
  return false;
}

function inflectionForms(token) {
  const forms = new Set([token, stem(token)]);
  for (const suffix of ['ing', 'ed']) {
    if (!token.endsWith(suffix)) continue;
    const base = token.slice(0, -suffix.length);
    if (base.length < 3) continue;
    forms.add(base);
    forms.add(`${base}e`);
    if (base.length >= 4 && base.at(-1) === base.at(-2)) forms.add(base.slice(0, -1));
  }
  return forms;
}

function setsOverlap(left, right) {
  return [...left].some((value) => right.has(value));
}

function compactLexicalForms(value) {
  return new Set(
    anchorCandidates(value)
      .map((item) => normalizeText(item).replace(/[^a-z0-9]+/gu, ""))
      .filter((item) => item.length >= 3)
  );
}

function contentTokens(value) {
  return new Set(normalizeText(value).split(/[^a-z0-9]+/u).filter((token) => token.length >= 3 && !STOPWORDS.has(token)));
}

function stem(token) {
  let value = token;
  for (const suffix of ["ization", "isation", "ational", "fulness", "iveness", "ation", "ition", "usion", "sion", "tion", "ment", "ness", "ance", "ence", "ative", "itive", "usive", "ical", "ive", "al", "ing", "ed", "es", "y", "s"]) {
    if (value.endsWith(suffix) && value.length - suffix.length >= 4) return value.slice(0, -suffix.length);
  }
  return value;
}

function derivationalStem(token) {
  let value = String(token || '');
  for (const suffix of ['ication', 'isation', 'ization', 'ation', 'ition', 'ution', 'icate', 'ise', 'ize', 'ate', 'ial', 'al', 'ion']) {
    if (value.endsWith(suffix) && value.length - suffix.length >= 6) {
      value = value.slice(0, -suffix.length);
      break;
    }
  }
  return value;
}

function compactVariants(value) {
  const tokens = normalizeText(value)
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
  const variants = new Set(tokens);
  for (let start = 0; start < tokens.length; start += 1) {
    for (let size = 2; size <= 3 && start + size <= tokens.length; size += 1) {
      variants.add(tokens.slice(start, start + size).join(''));
    }
  }
  return variants;
}

function levenshteinDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function lookupVariants(lang, value) {
  const term = String(value || "").normalize("NFKC").trim();
  const variants = new Set([term]);
  if (lang === "ja") {
    if (term.endsWith("する") && term.length > 2) variants.add(term.slice(0, -2));
    if (term.endsWith("な") && term.length > 1) variants.add(term.slice(0, -1));
  }
  if (lang === "zh" && term.endsWith("的") && term.length > 1) variants.add(term.slice(0, -1));
  return [...variants];
}

function termsEquivalent(lang, left, right) {
  const leftVariants = new Set(lookupVariants(lang, left).map(normalizeTerm));
  return lookupVariants(lang, right).some((value) => leftVariants.has(normalizeTerm(value)));
}

function splitTerms(value) { return String(value || "").split(/[;|]/u).map((item) => item.trim()).filter(Boolean); }
function asStrings(value) { return Array.isArray(value) ? value.map(String).filter(Boolean) : value ? [String(value)] : []; }
function unique(values) { return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]; }
function normalizeTerm(value) { return String(value || "").normalize("NFKC").trim().toLocaleLowerCase(); }
function normalizePtPronunciationKey(value) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("pt-BR");
}
function normalizeText(value) { return normalizeTerm(value).normalize("NFKD").replace(/[\u0300-\u036f]/gu, ""); }
function safeJson(value) { try { return JSON.parse(value || "{}"); } catch { return {}; } }
function result(row, decision, reason, evidence = null, extra = null) {
  return { source_entry_id: row.source_entry_id, source_sense_id: row.first_sense_id ?? row.source_sense_id ?? null, candidate_key: candidateKey(row), word: row.word, source_lang: row.source_lang, frequency_rank: row.frequency_rank ?? null, decision, reason, target_coverage_count: 0, ...(evidence ? { evidence } : {}), ...(extra || {}) };
}
function anchorCandidates(value) { return unique(String(value || "").split(/[;,/]|\bor\b/iu).map((item) => item.trim()).filter(Boolean)); }
function compareSupported(left, right) {
  return right.target_coverage_count - left.target_coverage_count || Number(left.frequency_rank || Infinity) - Number(right.frequency_rank || Infinity) || Number(left.source_entry_id) - Number(right.source_entry_id) || Number(left.source_sense_id || 0) - Number(right.source_sense_id || 0);
}
function candidateKey(row) {
  const entryId = Number(row?.source_entry_id);
  const senseId = Number(row?.source_sense_id ?? row?.first_sense_id);
  return `${entryId}:${Number.isInteger(senseId) && senseId > 0 ? senseId : '*'}`;
}
function countBy(values) { const counts = {}; for (const value of values) counts[value] = (counts[value] || 0) + 1; return counts; }
function decisionsByLang(items) {
  const output = {};
  for (const item of items) {
    output[item.source_lang] ||= {};
    output[item.source_lang][item.decision] = (output[item.source_lang][item.decision] || 0) + 1;
  }
  return output;
}
function round(value) { return Math.round(value * 1000) / 1000; }
function defaultOutPath(file) { const parsed = path.parse(file); return path.join(parsed.dir, `${parsed.name}-reverse-supported.json`); }
function defaultEvidenceOutPath(file) { const parsed = path.parse(file); return path.join(parsed.dir, `${parsed.name}-evidence.json`); }
function boundedInteger(value, fallback, minimum) { const number = Number(value ?? fallback); if (!Number.isInteger(number) || number < minimum) throw new Error(`Invalid integer: ${value}`); return number; }
function boundedNumber(value, fallback, minimum, maximum) { const number = Number(value ?? fallback); if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error(`Invalid number: ${value}`); return number; }
function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith("--") ? argv[++index] : "true";
  }
  return parsed;
}
