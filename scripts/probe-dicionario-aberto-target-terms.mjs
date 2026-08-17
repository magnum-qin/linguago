import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { XMLParser } from "fast-xml-parser";

const args = parseArgs(process.argv.slice(2));
const xmlDir = requiredPath(args["xml-dir"], "xml-dir");
const reportPath = requiredPath(args.report, "report");
const validationReportPath = args["validation-report"]
  ? requiredPath(args["validation-report"], "validation-report")
  : null;
const outPath = path.resolve(args.out || "logs/product-source-gap-dicionario-aberto-target-probe.json");
const targetLang = String(args["target-lang"] || "pt-BR");
if (targetLang !== "pt-BR") throw new Error("Only --target-lang pt-BR is supported");

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const sourceRows = new Map((report.selected || []).map((row) => [candidateKey(row), row]));
const validationRows = validationReportPath
  ? (JSON.parse(fs.readFileSync(validationReportPath, "utf8")).validations || [])
      .filter((row) => row.reason === "insufficient_independent_target_evidence")
      .map((row) => ({ ...sourceRows.get(candidateKey(row)), ...row }))
  : [];
const inputCandidates = validationReportPath ? validationRows : (report.selected || []);
const candidates = inputCandidates.flatMap((candidate) => {
  const preferredTerm = String(candidate.generation_hints?.[targetLang]?.terms?.[0] || "").trim();
  if (!preferredTerm || candidate.source_lang === targetLang) return [];
  return [{ candidate, preferredTerm }];
});
const candidatesByTerm = new Map();
for (const row of candidates) {
  const key = normalize(row.preferredTerm);
  if (!candidatesByTerm.has(key)) candidatesByTerm.set(key, []);
  candidatesByTerm.get(key).push(row);
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
  parseTagValue: false
});
const dictionaryEntries = new Map();
for (const filePath of fs.readdirSync(xmlDir)
  .filter((name) => name.toLowerCase().endsWith(".xml"))
  .map((name) => path.join(xmlDir, name))) {
  const parsed = parser.parse(fs.readFileSync(filePath, "utf8"));
  for (const entry of asArray(parsed?.dic?.entry)) {
    const term = text(entry?.form?.orth);
    const key = normalize(term);
    if (!key || !candidatesByTerm.has(key)) continue;
    const senses = asArray(entry.sense).map((sense, index) => ({
      sense_order: index + 1,
      part_of_speech_raw: text(sense?.gramGrp),
      part_of_speech: normalizePos(text(sense?.gramGrp)),
      definition: flattenText(sense?.def),
      usage: asArray(sense?.usg).map(flattenText).filter(Boolean)
    })).filter((sense) => usefulDefinition(sense.definition));
    if (!senses.length) continue;
    if (!dictionaryEntries.has(key)) dictionaryEntries.set(key, []);
    dictionaryEntries.get(key).push({
      entry_id: String(entry["@_id"] || ""),
      term,
      senses
    });
  }
}

const reviewCandidates = [];
for (const { candidate, preferredTerm } of candidates) {
  const expectedPos = normalizePos(candidate.part_of_speech);
  const definitions = [];
  for (const entry of dictionaryEntries.get(normalize(preferredTerm)) || []) {
    for (const sense of entry.senses) {
      if (expectedPos && sense.part_of_speech && expectedPos !== sense.part_of_speech) continue;
      definitions.push({ ...sense, dictionary_entry_id: entry.entry_id, dictionary_term: entry.term });
    }
  }
  if (!definitions.length) continue;
  reviewCandidates.push({
    candidate_key: candidateKey(candidate),
    bound_candidate_key: candidateKey(candidate),
    source_entry_id: candidate.source_entry_id,
    source_sense_id: candidate.first_sense_id ?? candidate.source_sense_id,
    source_lang: candidate.source_lang,
    target_lang: targetLang,
    term: preferredTerm,
    normalized_key: normalize(preferredTerm),
    part_of_speech: candidate.part_of_speech,
    english_anchor: englishAnchor(candidate),
    frequency_rank: candidate.frequency_rank,
    hint_provenance: candidate.generation_hints?.[targetLang]?.provenance || null,
    dicionario_aberto_definitions: definitions.slice(0, 12)
  });
}

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  research_only: true,
  production_publishable: false,
  source_report: path.relative(process.cwd(), reportPath),
  source_report_sha256: sha256(fs.readFileSync(reportPath)),
  validation_report: validationReportPath ? path.relative(process.cwd(), validationReportPath) : null,
  validation_report_sha256: validationReportPath ? sha256(fs.readFileSync(validationReportPath)) : null,
  source_resource: "Dicionario Aberto TEI XML",
  source_url: "https://dicionario-aberto.net/recursos",
  license: "CC-BY-SA-2.5-PT",
  policy: {
    target_lang: targetLang,
    preferred_generation_hint_only: true,
    exact_normalized_headword: true,
    part_of_speech_bound_when_available: true,
    candidate_bound_evidence: true,
    requires_dual_model_semantic_agreement_before_export: true
  },
  summary: {
    input_candidates: inputCandidates.length,
    candidates_with_preferred_target_term: candidates.length,
    dictionary_terms_matched: dictionaryEntries.size,
    review_candidates: reviewCandidates.length,
    definitions: reviewCandidates.reduce((sum, row) => sum + row.dicionario_aberto_definitions.length, 0)
  },
  review_candidates: reviewCandidates
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2));

function candidateKey(row) {
  return String(row.candidate_key || `${row.source_entry_id}:${row.first_sense_id ?? row.source_sense_id}`);
}
function englishAnchor(row) {
  const english = (row.first_sense_localizations || []).find((item) => item?.lang === "en");
  return String(english?.term || row.gloss_key || row.gloss_preview || "").trim();
}
function usefulDefinition(value) { const v = String(value || "").trim(); return v.length >= 3 && v.length <= 1200; }
function normalizePos(value) {
  const v = normalize(value).replaceAll(".", "");
  if (/^(?:m|f|s m|s f|subst|substantivo|noun)\b/u.test(v)) return "noun";
  if (/^(?:v|verbo|verb)\b/u.test(v)) return "verb";
  if (/^(?:adj|adjectivo|adjetivo|adjective)\b/u.test(v)) return "adjective";
  if (/^(?:adv|adverbio|advérbio|adverb)\b/u.test(v)) return "adverb";
  return v;
}
function flattenText(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(flattenText).filter(Boolean).join(" ");
  return Object.values(value).map(flattenText).filter(Boolean).join(" ");
}
function text(value) { return flattenText(value); }
function asArray(value) { return Array.isArray(value) ? value : value == null ? [] : [value]; }
function normalize(value) { return String(value || "").normalize("NFKC").trim().toLocaleLowerCase("pt-BR").replace(/\s+/gu, " "); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function requiredPath(value, name) { if (!value) throw new Error(`Missing --${name}`); const result = path.resolve(value); if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`); return result; }
function parseArgs(argv) { const out = {}; for (let i = 0; i < argv.length; i += 1) { if (!argv[i].startsWith("--")) continue; const key = argv[i].slice(2); const next = argv[i + 1]; out[key] = next && !next.startsWith("--") ? argv[++i] : true; } return out; }
