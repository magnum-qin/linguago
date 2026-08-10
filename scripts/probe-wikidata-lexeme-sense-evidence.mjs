#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ENDPOINT = "https://query.wikidata.org/sparql";
const TARGET_LANGUAGES = {
  "pt-BR": "Q5146",
  zh: "Q7850",
  ja: "Q5287"
};

const args = parseArgs(process.argv.slice(2));
if (!args.report || !args.out) {
  throw new Error("Usage: --report <prefilter-evidence.json> --out <probe.json>");
}

const reportPath = path.resolve(args.report);
const outPath = path.resolve(args.out);
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const sourceRows = (report.validations || []).filter((row) => row.decision === "supported");
const anchors = [...new Set(sourceRows.map((row) => normalize(row.evidence?.anchor)).filter(Boolean))];
const query = buildQuery(anchors);
const params = new URLSearchParams({ query, format: "json" });
const response = await fetch(`${ENDPOINT}?${params}`, {
  headers: {
    Accept: "application/sparql-results+json",
    "User-Agent": "LinguaGoDictionaryEvidence/1.0 (Wikidata Lexeme sense probe)"
  }
});
if (!response.ok) {
  throw new Error(`Wikidata HTTP ${response.status}: ${await response.text()}`);
}

const payload = await response.json();
const evidence = Object.fromEntries(anchors.map((anchor) => [anchor, []]));
for (const binding of payload.results?.bindings || []) {
  const anchor = normalize(binding.enLemma?.value);
  if (!evidence[anchor]) continue;
  evidence[anchor].push({
    concept_id: entityId(binding.concept?.value),
    source_lexeme_id: entityId(binding.enLexeme?.value),
    source_sense_id: entityId(binding.enSense?.value),
    source_lexical_category_id: entityId(binding.enCategory?.value),
    lang: binding.targetLang?.value,
    term: binding.targetLemma?.value,
    target_lexeme_id: entityId(binding.targetLexeme?.value),
    target_sense_id: entityId(binding.targetSense?.value),
    target_lexical_category_id: entityId(binding.targetCategory?.value),
    lexical_category_compatible:
      entityId(binding.enCategory?.value) === entityId(binding.targetCategory?.value)
  });
}

const results = sourceRows.map((row) => {
  const anchor = normalize(row.evidence?.anchor);
  const matches = uniqueMatches(evidence[anchor] || []);
  const terms = Object.fromEntries(
    Object.keys(TARGET_LANGUAGES).map((lang) => [
      lang,
      [...new Set(matches
        .filter((match) => match.lang === lang && match.lexical_category_compatible)
        .map((match) => match.term))]
    ])
  );
  const targetLanguages = Object.entries(terms)
    .filter(([lang, values]) => lang !== row.source_lang && values.length)
    .map(([lang]) => lang);
  return {
    candidate_key: row.candidate_key,
    word: row.word,
    source_lang: row.source_lang,
    english_anchor: anchor,
    target_coverage_count: targetLanguages.length,
    target_languages: targetLanguages,
    terms,
    matches
  };
});

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_report: path.relative(process.cwd(), reportPath),
  endpoint: ENDPOINT,
  license: "CC0-1.0",
  evidence_family: "wikidata",
  match_rule: "English Lexeme sense and target Lexeme sense share exact P5137 concept item",
  summary: {
    source_supported_rows: sourceRows.length,
    unique_anchors: anchors.length,
    rows_with_any_target: results.filter((row) => row.target_coverage_count > 0).length,
    rows_with_two_targets: results.filter((row) => row.target_coverage_count >= 2).length,
    rows_with_three_targets: results.filter((row) => row.target_coverage_count >= 3).length,
    rows_with_category_mismatch_only: results.filter(
      (row) => row.matches.length > 0 && row.target_coverage_count === 0
    ).length
  },
  results
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2));

function buildQuery(anchors) {
  const anchorValues = anchors.map((anchor) => JSON.stringify(anchor)).join(" ");
  const languageValues = Object.entries(TARGET_LANGUAGES)
    .map(([lang, id]) => `(wd:${id} ${JSON.stringify(lang)})`)
    .join(" ");
  return `
    SELECT DISTINCT ?enLexeme ?enLemma ?enCategory ?enSense ?concept ?targetLang
                    ?targetLexeme ?targetLemma ?targetCategory ?targetSense WHERE {
      VALUES ?anchor { ${anchorValues} }
      VALUES (?targetLanguage ?targetLang) { ${languageValues} }
      ?enLexeme dct:language wd:Q1860;
                wikibase:lemma ?enLemma;
                wikibase:lexicalCategory ?enCategory;
                ontolex:sense ?enSense.
      FILTER(LCASE(STR(?enLemma)) = ?anchor)
      ?enSense wdt:P5137 ?concept.
      ?targetLexeme dct:language ?targetLanguage;
                    wikibase:lemma ?targetLemma;
                    wikibase:lexicalCategory ?targetCategory;
                    ontolex:sense ?targetSense.
      ?targetSense wdt:P5137 ?concept.
    }
  `;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    result[argv[index].slice(2)] = argv[index + 1];
    index += 1;
  }
  return result;
}

function normalize(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("und").trim();
}

function entityId(value) {
  return String(value || "").split("/").pop() || null;
}

function uniqueMatches(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = [row.concept_id, row.lang, normalize(row.term), row.target_sense_id].join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
