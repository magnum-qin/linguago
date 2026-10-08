import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as OpenCC from "opencc-js";
import { canonicalEnglishSpellingVariant } from "./lib/source-gap-lexical-contract.mjs";
import { japaneseReverseLookupVariants } from './lib/japanese-reverse-lookup-variants.mjs';
import { candidateSourceSenseKey, sourceSenseKey } from "./lib/source-sense-key.mjs";

const DEFAULT_SOURCE_DB = "data/processed/linguago_v2_full.db";
const DEFAULT_SUPPLEMENTAL_SOURCE_DB =
  ".tmp/combined/openwn-word2word3-ja-apertium-wikidata-v3-evidence.db";
const DEFAULT_REPORT =
  "logs/product-source-gap-v83-two-lang-evidence-validation-tier-c-smoke-20-v2-dry-run.json";
const TARGET_LANGS = ["en", "pt-BR", "zh", "ja"];
const traditionalToSimplified = OpenCC.Converter({ from: "tw", to: "cn" });
const simplifiedToTraditional = OpenCC.Converter({ from: "cn", to: "tw" });
const HTML_ENTITY_RE = /&(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#[0-9]{1,7}|#x[0-9a-fA-F]{1,6});/u;
const REPLACEMENT_CHAR_RE = /[\uFFFD]/u;
const LATIN1_MOJIBAKE_RE = /(?:\u00c3[\u0080-\u00bf]|\u00c2[\u0080-\u00bf]|\u00e2[\u0080-\u00bf]{1,2})/u;
const JAPANESE_MOJIBAKE_RE = /[\u9287\u9288\u9289][\u3040-\u30ff\u4e00-\u9fff]?/u;
const STRONG_REVERSE_SOURCES = {
  en: new Set(["ecdict", "omw-30", "wordnet", "kaikki-en", "freedict-eng-por"]),
  "pt-BR": new Set(["freedict-por-eng", "wikdict-pt-en", "omw-30", "kaikki-pt", "wikdict-pt-ja", "wikdict-pt-zh"]),
  zh: new Set(["cc-cedict", "kaikki-zh", "wikdict-zh-en", "omw-30", "wikdict-zh-pt", "wikdict-zh-ja"]),
  ja: new Set(["jmdict", "wikdict-ja-en", "kaikki-ja", "omw-30", "wikdict-ja-pt", "wikdict-ja-zh"])
};
const FORWARD_SOURCES = {
  "pt-BR": new Set(["freedict-eng-por", "wikdict-en-pt", "omw-30"]),
  zh: new Set(["wikdict-en-zh", "omw-30"]),
  ja: new Set(["wikdict-en-ja", "omw-30", "freedict-eng-por"])
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
const productDbPath = path.resolve(
  args["product-db"] || "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db"
);
const reportPath = path.resolve(args.report || DEFAULT_REPORT);
const outPath = path.resolve(args.out || defaultOutPath(reportPath));
const supportedReportPath = path.resolve(args["supported-report"] || defaultSupportedReportPath(outPath));
const includeInvalid = args["include-invalid"] === "true";
const inputMode = args["input-mode"] || "generated";
const requireSourceReverseEvidence = args["require-source-reverse-evidence"] === "true";
const maxManualTargetLanguages = Math.max(
  0,
  Number.parseInt(args["max-manual-target-langs"] || "0", 10)
);
const minSupportedTargetLanguages = Math.max(
  0,
  Number.parseInt(args["min-supported-target-langs"] || "0", 10)
);
const evidenceFamilyPolicy = args["evidence-family-policy"] || "wiktionary";
const progressEvery = Math.max(1, Number.parseInt(args["progress-every"] || "100", 10));
const allowedReviewedSupplementalSourceKeys = new Set(
  String(args["reviewed-supplemental-source-keys"] || "")
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
if (!new Set(["wiktionary", "legacy"]).has(evidenceFamilyPolicy)) {
  throw new Error(`Invalid --evidence-family-policy: ${evidenceFamilyPolicy}`);
}
if (!new Set(["generated", "reviewed", "reviewed-suggested", "hints", "aligned", "product"]).has(inputMode)) {
  throw new Error(`Invalid --input-mode: ${inputMode}`);
}

for (const file of [
  sourceDbPath,
  ...(supplementalSourceDbPath ? [supplementalSourceDbPath] : []),
  ...(inputMode === "product" ? [productDbPath] : [reportPath])
]) {
  if (!fs.existsSync(file)) throw new Error(`Required file not found: ${file}`);
}

const report = inputMode === "product" ? { generated: loadProductRows(productDbPath) } : JSON.parse(fs.readFileSync(reportPath, "utf8"));
const reviewedCandidates = Array.isArray(report.selected) ? report.selected : [];
const generated =
  inputMode === "reviewed"
    ? reviewedCandidates.map(reviewedCandidateToGenerated).filter(Boolean)
    : inputMode === "reviewed-suggested"
      ? reviewedCandidates.map(reviewedSuggestedCandidateToGenerated).filter(Boolean)
    : inputMode === "hints"
      ? reviewedCandidates.map(hintedCandidateToGenerated).filter(Boolean)
    : inputMode === "aligned"
      ? reviewedCandidates.map(alignedCandidateToGenerated).filter(Boolean)
    : Array.isArray(report.generated)
      ? report.generated
      : Array.isArray(report.replayed)
        ? report.replayed
        : [];
if (inputMode === "generated" && !generated.length && Number(report?.stats?.generated || 0) > 0) {
  throw new Error(
    "Generation report contains only previews. Re-run the dry-run with --log-generated true before reverse validation."
  );
}
if ((inputMode === "reviewed" || inputMode === "reviewed-suggested" || inputMode === "hints") && !generated.length && reviewedCandidates.length) {
  throw new Error("Reviewed candidate report has no approved candidate_evidence_review.preferred_terms rows.");
}
if (inputMode === "aligned" && !generated.length && reviewedCandidates.length) {
  throw new Error("Aligned candidate report has no valid sense_alignment/first_sense_localizations rows.");
}
const rows = (includeInvalid ? generated : generated.filter((row) => row.valid === true)).filter(
  (row) => !generatedRowHasContentArtifact(row)
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
  const familyStatus = new Map();
  for (const row of supplementalDb.prepare(`
    SELECT source_key, source_family, license, metadata_json
    FROM evidence_sources
  `).all()) {
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
      metadata.candidate_bound === true &&
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

const findReverse = db.prepare(`
  SELECT ds.source_key, se.word, se.lang, ss.part_of_speech, ss.gloss, ss.raw_json
  FROM source_entries se
  JOIN dictionary_sources ds ON ds.id = se.source_id
  JOIN source_senses ss ON ss.source_entry_id = se.id
  WHERE se.normalized_key = ? AND se.lang = ?
  ORDER BY ds.source_key, ss.sense_order, ss.id
`);
const findForward = db.prepare(`
  SELECT ds.source_key, se.word, se.lang, ss.part_of_speech, ss.gloss, ss.raw_json
  FROM source_entries se
  JOIN dictionary_sources ds ON ds.id = se.source_id
  JOIN source_senses ss ON ss.source_entry_id = se.id
  WHERE se.normalized_key = ? AND se.lang = 'en'
  ORDER BY ds.source_key, ss.sense_order, ss.id
`);
const findSupplementalReverse = supplementalDb?.prepare(`
  SELECT source_key, source_family, term AS word, lang, english_gloss, concept_id
  FROM lexical_evidence
  WHERE normalized_key = ? AND lang = ?
  ORDER BY source_key, concept_id, english_gloss
`);

const validations = [];
const validationStartedAt = Date.now();
for (let index = 0; index < rows.length; index += 1) {
  validations.push(validateGeneratedRow(rows[index]));
  const completed = index + 1;
  if (completed % progressEvery === 0 || completed === rows.length) {
    console.log(
      `[reverse-evidence] completed=${completed}/${rows.length} ` +
        `elapsed_seconds=${((Date.now() - validationStartedAt) / 1000).toFixed(1)}`
    );
  }
}
const summary = summarize(validations, generated.length, includeInvalid);
const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_db: path.relative(process.cwd(), sourceDbPath),
  supplemental_source_db: supplementalSourceDbPath
    ? path.relative(process.cwd(), supplementalSourceDbPath)
    : null,
  generation_report: inputMode === "product" ? null : path.relative(process.cwd(), reportPath),
  product_db: inputMode === "product" ? path.relative(process.cwd(), productDbPath) : null,
  policy: {
    input_mode: inputMode,
    omw_only_auto_pass: false,
    source_language_exact_term_auto_pass: !requireSourceReverseEvidence,
    require_source_reverse_evidence: requireSourceReverseEvidence,
    max_manual_target_languages: maxManualTargetLanguages,
    min_supported_target_languages: minSupportedTargetLanguages,
    evidence_family_policy: evidenceFamilyPolicy,
    blocked_supplemental_source_keys: [...blockedSupplementalSourceKeys].sort(),
    blocked_supplemental_families: [...blockedSupplementalFamilies].sort(),
    reviewed_supplemental_source_keys: [...reviewedSupplementalSourceKeys].sort(),
    candidate_bound_source_roundtrip_keys: [...candidateBoundRoundtripSourceKeys].sort(),
    strong_source_minimum: 1,
    ambiguous_match_ratio: 0.34,
    decisions: ["supported", "unsupported", "manual_review"]
  },
  summary: {
    ...summary,
    supported_replay_report: path.relative(process.cwd(), supportedReportPath)
  },
  validations
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
writeJsonAtomic(outPath, output);
const supportedIds = new Set(
  validations
    .filter((item) => item.decision === "supported")
    .map((item) => sourceSenseKey(item.source_entry_id, item.source_sense_id))
);
const supportedReport =
  inputMode === "reviewed" || inputMode === "reviewed-suggested" || inputMode === "hints" || inputMode === "aligned"
    ? {
        ...report,
        generated_at: new Date().toISOString(),
        derived_from: path.relative(process.cwd(), reportPath),
        reverse_evidence_report: path.relative(process.cwd(), outPath),
        selected_count: reviewedCandidates.filter((item) => supportedIds.has(candidateSourceSenseKey(item))).length,
        selected: reviewedCandidates.filter((item) => supportedIds.has(candidateSourceSenseKey(item)))
      }
    : {
        ...report,
        generated_at: new Date().toISOString(),
        derived_from: path.relative(process.cwd(), reportPath),
        reverse_evidence_report: path.relative(process.cwd(), outPath),
        generated: generated.filter(
          (item) =>
            item.valid === true &&
            supportedIds.has(sourceSenseKey(item.source_entry_id, item.output?.source_sense_id ?? item.source_sense_id))
        )
      };
writeJsonAtomic(supportedReportPath, supportedReport);
db.close();
supplementalDb?.close();
console.log(
  JSON.stringify(
    {
      ...summary,
      out: path.relative(process.cwd(), outPath),
      supported_replay_report: path.relative(process.cwd(), supportedReportPath)
    },
    null,
    2
  )
);

function writeJsonAtomic(targetPath, value) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    fs.renameSync(temporaryPath, targetPath);
  } catch (error) {
    if (!["EEXIST", "EPERM"].includes(error?.code)) throw error;
    fs.rmSync(targetPath, { force: true });
    fs.renameSync(temporaryPath, targetPath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function reviewedCandidateToGenerated(row) {
  const review = row?.candidate_evidence_review;
  const preferredTerms = review?.preferred_terms;
  if (!review?.approved && review?.decision !== "accept") return null;
  if (!preferredTerms || typeof preferredTerms !== "object") return null;
  return {
    source_entry_id: row.source_entry_id,
    word: row.word,
    source_lang: row.source_lang,
    valid: true,
    output: {
      gloss_key: review.english_anchor || row.gloss_key || row.gloss_preview || row.word,
      primary_lang: row.source_lang,
      source_word: row.word,
      source_sense_id: row.first_sense_id ?? null,
      localizations: Object.fromEntries(
        TARGET_LANGS.map((lang) => [lang, { term: String(preferredTerms[lang] || "").trim() }])
      )
    }
  };
}

function reviewedSuggestedCandidateToGenerated(row) {
  const review = row?.candidate_evidence_review;
  const suggestedTerms = review?.suggested_terms;
  if (!review?.approved && review?.decision !== "accept") return null;
  if (!suggestedTerms || typeof suggestedTerms !== "object") return null;
  if (!TARGET_LANGS.every((lang) => String(suggestedTerms[lang] || "").trim())) return null;
  return {
    source_entry_id: row.source_entry_id,
    word: row.word,
    source_lang: row.source_lang,
    valid: true,
    output: {
      gloss_key: review.english_anchor || row.gloss_key || row.gloss_preview || row.word,
      primary_lang: row.source_lang,
      source_word: row.word,
      source_sense_id: row.first_sense_id ?? null,
      localizations: Object.fromEntries(
        TARGET_LANGS.map((lang) => [lang, { term: String(suggestedTerms[lang]).trim() }])
      )
    }
  };
}

function hintedCandidateToGenerated(row) {
  const hints = row?.generation_hints;
  if (!hints || typeof hints !== "object") return null;
  const terms = Object.fromEntries(
    TARGET_LANGS.map((lang) => {
      const values = Array.isArray(hints?.[lang]?.terms) ? hints[lang].terms : [];
      return [lang, String(values[0] || "").trim()];
    })
  );
  if (!TARGET_LANGS.every((lang) => terms[lang])) return null;
  return {
    source_entry_id: row.source_entry_id,
    word: row.word,
    source_lang: row.source_lang,
    valid: true,
    output: {
      gloss_key: terms.en || row.gloss_key || row.gloss_preview || row.word,
      primary_lang: row.source_lang,
      source_word: row.word,
      source_sense_id: row.first_sense_id ?? null,
      localizations: Object.fromEntries(TARGET_LANGS.map((lang) => [lang, { term: terms[lang] }]))
    }
  };
}

function alignedCandidateToGenerated(row) {
  if (
    row?.sense_alignment?.status !== "aligned" ||
    Number(row?.sense_alignment?.aligned_sense_id) !== Number(row?.first_sense_id)
  ) {
    return null;
  }
  const localizations = Array.isArray(row.first_sense_localizations)
    ? row.first_sense_localizations
    : [];
  const terms = Object.fromEntries(
    localizations
      .filter((item) => TARGET_LANGS.includes(item?.lang) && String(item?.term || "").trim())
      .map((item) => [item.lang, { term: String(item.term).trim() }])
  );
  const englishTerm = String(terms.en?.term || "").trim();
  if (!englishTerm || Object.keys(terms).length < 2) return null;
  return {
    source_entry_id: row.source_entry_id,
    word: row.word,
    source_lang: row.source_lang,
    valid: true,
    partial_localizations: true,
    output: {
      gloss_key: englishTerm,
      primary_lang: row.source_lang,
      source_word: row.word,
      source_sense_id: row.first_sense_id ?? null,
      localizations: terms
    }
  };
}

function validateGeneratedRow(row) {
  const output = row.output || {};
  const anchor = String(output.source_meaning_anchor || output.gloss_key || row.word || "").trim();
  const sourceLang = output.primary_lang || row.source_lang;
  const sourceWord = String(output.source_word || row.word || output.headword || "").trim();
  const anchors = unique([
    anchor,
    ...(Array.isArray(output.source_meaning_anchors) ? output.source_meaning_anchors : []),
    ...(sourceLang === "en" ? [sourceWord] : [])
  ].flatMap(anchorCandidates));
  const languages = {};

  for (const lang of TARGET_LANGS) {
    const term = String(output.localizations?.[lang]?.term || "").trim();
    if (row.partial_localizations === true && !term) continue;
    languages[lang] = validateLocalization({
      anchor,
      anchors,
      lang,
      term,
      sourceLang,
      sourceWord,
      boundCandidateKey: `${Number(row.source_entry_id)}:${Number(output.source_sense_id)}`
    });
  }

  const targetDecisions = Object.entries(languages)
    .filter(([lang]) => lang !== sourceLang || (requireSourceReverseEvidence && sourceLang !== "en"))
    .map(([, value]) => value.decision);
  const supportedTargetLanguages = targetDecisions.filter((value) => value === "supported").length;
  const manualTargetLanguages = targetDecisions.filter((value) => value === "manual_review").length;
  const manualEvidenceQualified =
    !targetDecisions.includes("unsupported") &&
    manualTargetLanguages > 0 &&
    manualTargetLanguages <= maxManualTargetLanguages &&
    supportedTargetLanguages >= minSupportedTargetLanguages;
  const decision = targetDecisions.includes("unsupported")
    ? "unsupported"
    : targetDecisions.includes("manual_review") && !manualEvidenceQualified
      ? "manual_review"
      : "supported";

  return {
    product_entry_id: row.product_entry_id ?? null,
    product_sense_id: row.product_sense_id ?? null,
    source_entry_id: row.source_entry_id,
    source_sense_id: output.source_sense_id ?? null,
    word: row.word,
    source_lang: sourceLang,
    anchor,
    generation_valid: row.valid === true,
    decision,
    evidence_qualification: manualEvidenceQualified
      ? {
          mode: "supported_with_limited_manual_evidence",
          supported_target_languages: supportedTargetLanguages,
          manual_target_languages: manualTargetLanguages
        }
      : null,
    languages
  };
}

function generatedRowHasContentArtifact(row) {
  const output = row?.output || {};
  const values = [
    output.headword,
    output.gloss_key,
    ...TARGET_LANGS.flatMap((lang) => {
      const localization = output.localizations?.[lang] || {};
      return [
        localization.term,
        localization.reading,
        localization.pronunciation,
        localization.definition
      ];
    })
  ];
  return values.some((value) => {
    const text = String(value || "").trim();
    return Boolean(
      text &&
        (HTML_ENTITY_RE.test(text) ||
          REPLACEMENT_CHAR_RE.test(text) ||
          LATIN1_MOJIBAKE_RE.test(text) ||
          JAPANESE_MOJIBAKE_RE.test(text))
    );
  });
}

function loadProductRows(filePath) {
  const productDb = new Database(filePath, { readonly: true, fileMustExist: true });
  productDb.pragma("query_only = ON");
  const rawRows = productDb.prepare(`
    SELECT
      pe.id AS product_entry_id,
      pe.headword,
      pe.primary_lang,
      pe.frequency_rank,
      ps.id AS product_sense_id,
      ps.gloss_key,
      link.source_entry_id,
      link.source_sense_id,
      link.source_lang,
      link.source_word,
      link.confidence AS source_confidence,
      pl.lang,
      pl.term
    FROM product_entries pe
    JOIN product_senses ps ON ps.product_entry_id = pe.id
    JOIN product_sense_source_links link ON link.product_sense_id = ps.id
    JOIN product_localizations pl ON pl.product_sense_id = ps.id
    WHERE pe.group_method = 'source_gap_unsloth'
      AND pe.status = 'accepted'
      AND ps.status = 'accepted'
      AND COALESCE(pl.needs_review, 0) = 0
    ORDER BY ps.id, (link.source_lang = pe.primary_lang) DESC, link.confidence DESC, link.id, pl.lang
  `).all();
  productDb.close();

  const grouped = new Map();
  for (const row of rawRows) {
    let item = grouped.get(Number(row.product_sense_id));
    if (!item) {
      item = {
        product_entry_id: Number(row.product_entry_id),
        product_sense_id: Number(row.product_sense_id),
        source_entry_id: Number(row.source_entry_id),
        word: row.headword,
        source_lang: row.primary_lang,
        valid: true,
        output: {
          gloss_key: row.gloss_key,
          primary_lang: row.primary_lang,
          source_word: row.source_word || row.headword,
          source_sense_id: Number(row.source_sense_id),
          localizations: {}
        }
      };
      grouped.set(Number(row.product_sense_id), item);
    }
    if (Number(row.source_sense_id) !== Number(item.output.source_sense_id)) continue;
    item.output.localizations[row.lang] = { term: row.term };
  }
  return [...grouped.values()].filter(
    (item) => TARGET_LANGS.every((lang) => String(item.output.localizations?.[lang]?.term || "").trim())
  );
}

function validateLocalization({
  anchor,
  anchors = [anchor],
  lang,
  term,
  sourceLang,
  sourceWord,
  boundCandidateKey
}) {
  if (!term) return decision("unsupported", "missing_term");
  if (
    !requireSourceReverseEvidence &&
    lang === sourceLang &&
    normalizeTerm(term) === normalizeTerm(sourceWord)
  ) {
    return decision("supported", "source_term_preserved");
  }
  if (lang === "en" && lexicalMatchAny(anchors, term)) {
    return decision("supported", "english_term_matches_anchor");
  }

  const reverseRows = termLookupVariants(lang, term).flatMap((value) => findReverse.all(normalizeTerm(value), lang));
  const supplementalRows = findSupplementalReverse
    ? termLookupVariants(lang, term).flatMap((value) =>
        findSupplementalReverse.all(normalizeTerm(value), lang)
      ).filter((row) => supplementalFamilyIsEligible(row.source_family, row.source_key))
       .filter((row) => supplementalRowMatchesCandidate(row, boundCandidateKey))
    : [];
  const reverseEvidence = [
    ...reverseRows.flatMap((row) => extractReverseEvidence(row, lang, anchors)),
    ...supplementalRows.map((row) => ({
      source: row.source_key,
      source_family: row.source_family,
      english_gloss: row.english_gloss,
      concept_id: row.concept_id,
      matches_anchor: lexicalMatchAny(anchors, row.english_gloss),
      strength:
        reviewedSupplementalSourceKeys.has(row.source_key) ||
        candidateBoundRoundtripSourceKeys.has(row.source_key)
          ? "strong"
          : "weak"
    }))
  ];
  const strongEvidence = reverseEvidence.filter((item) => item.strength === "strong");
  const weakEvidence = reverseEvidence.filter((item) => item.strength === "weak");
  const strongMatches = strongEvidence.filter((item) => item.matches_anchor);
  const weakMatches = weakEvidence.filter((item) => item.matches_anchor);
  const forwardEvidence = lang === "en" ? [] : extractForwardEvidence(anchors, lang, term);
  const forwardMatches = forwardEvidence.filter((item) => item.matches_term);
  const primaryMatchingSources = new Set([
    ...strongMatches.map((item) => item.source),
    ...forwardMatches.map((item) => item.source)
  ]);
  const matchingSources = new Set([
    ...primaryMatchingSources,
    ...weakMatches.map((item) => item.source)
  ]);
  const matchingFamilies = new Set(
    [...strongMatches, ...forwardMatches, ...weakMatches].map((item) =>
      evidenceSourceFamily(item.source, item.source_family)
    )
  );
  const hasIndependentStrongSource = [...strongMatches, ...forwardMatches].some(
    (item) => isIndependentStrongFamily(evidenceSourceFamily(item.source, item.source_family))
  );
  const strongGlosses = new Set(strongEvidence.map((item) => normalizeText(item.english_gloss)).filter(Boolean));
  const matchingGlosses = new Set(strongMatches.map((item) => normalizeText(item.english_gloss)).filter(Boolean));
  const matchRatio = strongGlosses.size ? matchingGlosses.size / strongGlosses.size : 0;

  const evidence = {
    strong_matches: strongMatches,
    forward_matches: forwardMatches,
    weak_matches: weakMatches,
    strong_nonmatches: strongEvidence.filter((item) => !item.matches_anchor).slice(0, 12),
    counts: {
      reverse_rows: reverseRows.length,
      supplemental_reverse_rows: supplementalRows.length,
      strong_glosses: strongGlosses.size,
      matching_glosses: matchingGlosses.size,
      matching_sources: matchingSources.size,
      primary_matching_sources: primaryMatchingSources.size,
      matching_families: matchingFamilies.size,
      weak_matches: weakMatches.length,
      match_ratio: round(matchRatio)
    }
  };

  if (matchingFamilies.size >= 2) return decision("supported", "multiple_independent_source_families_agree", evidence);
  if (
    primaryMatchingSources.size >= 1 &&
    hasIndependentStrongSource &&
    (strongGlosses.size <= 2 || matchRatio >= 0.34)
  ) {
    return decision("supported", "strong_dictionary_evidence", evidence);
  }
  if (primaryMatchingSources.size >= 1 && !hasIndependentStrongSource) {
    return decision("manual_review", "wiktionary_only_evidence", evidence);
  }
  if (primaryMatchingSources.size === 1) {
    return decision("manual_review", "polysemous_term_low_match_ratio", evidence);
  }
  if (strongEvidence.length > 0) {
    return decision("unsupported", "strong_dictionary_gloss_conflicts_with_anchor", evidence);
  }
  if (weakMatches.length > 0) return decision("manual_review", "omw_only_evidence", evidence);
  return decision("manual_review", "no_reverse_dictionary_evidence", evidence);
}

function evidenceSourceFamily(source, explicitFamily = null) {
  const family = String(explicitFamily || "").trim().toLowerCase();
  if (family) return family;
  const value = String(source || "").toLowerCase();
  if (evidenceFamilyPolicy === "legacy") {
    if (value.startsWith("wikdict-")) return "wikdict";
    if (value.startsWith("kaikki-")) return "kaikki";
  }
  if (value.startsWith("wikdict-") || value.startsWith("kaikki-")) return "wiktionary";
  if (value.startsWith("freedict-")) return "freedict";
  if (value.startsWith("openwn-") || value.startsWith("chinese-open-wordnet-")) return "omw";
  if (value.startsWith("omw")) return "omw";
  return value || "unknown";
}

function supplementalFamilyIsEligible(value, sourceKey) {
  const family = String(value || "").trim().toLowerCase();
  return !blockedSupplementalFamilies.has(family) &&
    !blockedSupplementalSourceKeys.has(sourceKey);
}

function supplementalRowMatchesCandidate(row, boundCandidateKey) {
  const match = /^(?:candidate:|dicionario-aberto-definition:)(.+)$/u.exec(
    String(row?.concept_id || "").trim()
  );
  if (!match) return true;
  return Boolean(boundCandidateKey) && match[1] === boundCandidateKey;
}

function isIndependentStrongFamily(family) {
  return evidenceFamilyPolicy === "legacy" ? family !== "wikdict" : family !== "wiktionary";
}

function extractReverseEvidence(row, lang, anchors) {
  const source = row.source_key;
  const raw = safeJson(row.raw_json);
  const glosses = [];
  if (source === "omw-30") {
    glosses.push(...asStrings(raw.localizations?.en), ...englishGlosses(row.gloss, raw));
  } else if (isStrongReverseSource(lang, source)) {
    if (source === "ecdict") glosses.push(row.word);
    else if (String(raw.target_lang || "") === "en") glosses.push(...asStrings(raw.translations), row.gloss);
    else glosses.push(...englishGlosses(row.gloss, raw));
  }
  return unique(glosses).map((englishGloss) => ({
    source,
    english_gloss: englishGloss,
    matches_anchor: lexicalMatchAny(anchors, englishGloss),
    strength: isStrongReverseSource(lang, source) ? "strong" : "weak"
  }));
}

function isStrongReverseSource(lang, source) {
  if (evidenceFamilyPolicy === "legacy" && lang === "ja" && source === "kaikki-ja") {
    return false;
  }
  return STRONG_REVERSE_SOURCES[lang]?.has(source) === true;
}

function extractForwardEvidence(anchors, lang, term) {
  const sources = FORWARD_SOURCES[lang];
  if (!sources) return [];
  const candidates = unique(anchors.flatMap((anchor) => anchorCandidates(anchor)));
  const rows = candidates.flatMap((candidate) => findForward.all(normalizeTerm(candidate)));
  const results = [];
  for (const row of rows) {
    if (!sources.has(row.source_key)) continue;
    const raw = safeJson(row.raw_json);
    const terms = unique([...asStrings(raw.translations), ...splitTerms(row.gloss)]);
    results.push({
      source: row.source_key,
      anchor_entry: row.word,
      target_terms: terms,
      matches_term: terms.some((value) => termsEquivalent(lang, value, term))
    });
  }
  return results;
}

function englishGlosses(gloss, raw) {
  const values = [];
  values.push(...asStrings(raw.gloss), ...asStrings(raw.glosses));
  if (raw.definition) values.push(raw.definition);
  const text = String(gloss || "").trim();
  const labeled = text.match(/(?:^|\|)\s*en\s*:\s*([^|]+)/iu);
  if (labeled) values.push(...splitTerms(labeled[1]));
  else if (text && /[A-Za-z]/u.test(text)) values.push(...splitTerms(text));
  return unique(values);
}

function lexicalMatch(left, right) {
  const leftTokens = contentTokens(left);
  const rightTokens = contentTokens(right);
  if (!leftTokens.size || !rightTokens.size) return false;
  for (const a of leftTokens) {
    for (const b of rightTokens) {
      if (
        a === b ||
        setsOverlap(inflectionForms(a), inflectionForms(b)) ||
        derivationalStem(a) === derivationalStem(b)
      ) {
        return true;
      }
    }
  }
  for (const leftCompact of compactVariants(left)) {
    for (const rightCompact of compactVariants(right)) {
      if (
        leftCompact.length >= 6 &&
        rightCompact.length >= 6 &&
        levenshteinDistance(leftCompact, rightCompact) <= 1
      ) {
        return true;
      }
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

function lexicalMatchAny(leftValues, right) {
  return leftValues.some((left) => lexicalMatch(left, right));
}

function compactVariants(value) {
  const tokens = normalizeText(value)
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
  const variants = new Set(tokens);
  for (let start = 0; start < tokens.length; start++) {
    for (let size = 2; size <= 3 && start + size <= tokens.length; size++) {
      variants.add(tokens.slice(start, start + size).join(""));
    }
  }
  return variants;
}

function levenshteinDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
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

function contentTokens(value) {
  return new Set(
    normalizeText(value)
      .split(/[^a-z0-9]+/u)
      .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
  );
}

function stem(token) {
  let value = token;
  for (const suffix of ["ization", "isation", "ational", "fulness", "iveness", "ation", "ition", "usion", "sion", "tion", "ment", "ness", "ance", "ence", "ative", "itive", "usive", "ical", "ive", "al", "ing", "ed", "es", "y", "s"]) {
    if (value.endsWith(suffix) && value.length - suffix.length >= 4) {
      value = value.slice(0, -suffix.length);
      break;
    }
  }
  return value;
}

function derivationalStem(token) {
  let value = String(token || '');
  const suffixes = [
    'ication',
    'isation',
    'ization',
    'ation',
    'ition',
    'ution',
    'icate',
    'ise',
    'ize',
    'ate',
    'ial',
    'al',
    'ion'
  ];
  for (const suffix of suffixes) {
    if (value.endsWith(suffix) && value.length - suffix.length >= 6) {
      value = value.slice(0, -suffix.length);
      break;
    }
  }
  return value;
}

function anchorCandidates(value) {
  return unique(String(value || "").split(/[;,/]|\bor\b/iu).map((item) => item.trim()).filter(Boolean));
}

function splitTerms(value) {
  return String(value || "").split(/[;|]/u).map((item) => item.trim()).filter(Boolean);
}

function termLookupVariants(lang, value) {
  const term = String(value || '').normalize('NFKC').trim();
  if (lang === 'ja') return japaneseReverseLookupVariants(term);
  const variants = new Set([term]);
  if (lang === 'zh') {
    variants.add(traditionalToSimplified(term));
    variants.add(simplifiedToTraditional(term));
  }
  if (lang === 'zh' && term.endsWith('的') && term.length > 1) variants.add(term.slice(0, -1));
  return [...variants];
}

function termsEquivalent(lang, left, right) {
  const leftVariants = new Set(termLookupVariants(lang, left).map(normalizeTerm));
  return termLookupVariants(lang, right).some((value) => leftVariants.has(normalizeTerm(value)));
}

function asStrings(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (value === null || value === undefined || value === "") return [];
  return [String(value)];
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeTerm(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase();
}

function normalizeText(value) {
  return canonicalEnglishSpellingVariant(value);
}

function safeJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function decision(value, reason, evidence = null) {
  return { decision: value, reason, ...(evidence ? { evidence } : {}) };
}

function summarize(items, generatedCount, includedInvalid) {
  const byDecision = countBy(items.map((item) => item.decision));
  const languageDecisions = {};
  const languageReasons = {};
  for (const lang of TARGET_LANGS) {
    const present = items.map((item) => item.languages[lang]).filter(Boolean);
    languageDecisions[lang] = countBy(present.map((item) => item.decision));
    languageReasons[lang] = countBy(present.map((item) => item.reason));
  }
  return {
    generation_rows: generatedCount,
    validated_rows: items.length,
    include_invalid: includedInvalid,
    decisions: byDecision,
    language_decisions: languageDecisions,
    language_reasons: languageReasons
  };
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function defaultOutPath(file) {
  const parsed = path.parse(file);
  return path.join(parsed.dir, `${parsed.name}-reverse-evidence.json`);
}

function defaultSupportedReportPath(file) {
  const parsed = path.parse(file);
  return path.join(parsed.dir, `${parsed.name}-supported-generation.json`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = "true";
    else {
      parsed[key] = next;
      index++;
    }
  }
  return parsed;
}
