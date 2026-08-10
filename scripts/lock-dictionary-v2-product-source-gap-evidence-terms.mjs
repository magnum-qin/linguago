import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const generationPath = requiredPath("generation");
const validationPath = requiredPath("validation");
const candidatesPath = requiredPath("candidates");
const outPath = path.resolve(args.out || "logs/product-source-gap-evidence-locked.json");

const generation = readJson(generationPath);
const validation = readJson(validationPath);
const candidates = readJson(candidatesPath);
const generatedRows = Array.isArray(generation.generated) ? generation.generated : [];
const validationRows = validation.validations || validation.results || [];
const candidateRows = candidates.selected || candidates.candidates || [];

const validationByEntry = uniqueByEntry(validationRows, "validation");
const candidateByEntry = uniqueByEntry(candidateRows, "candidate");
const stats = {
  input_rows: generatedRows.length,
  output_rows: 0,
  changed_rows: 0,
  changed_terms: 0,
  missing_validation: 0,
  missing_candidate: 0,
  missing_hints: 0,
  changed_by_lang: {}
};

const generated = generatedRows.map((row) => {
  const key = String(row.source_entry_id);
  const review = validationByEntry.get(key);
  const candidate = candidateByEntry.get(key);
  if (!review) {
    stats.missing_validation++;
    return row;
  }
  if (!candidate) {
    stats.missing_candidate++;
    return row;
  }

  const output = structuredClone(row.output || {});
  const lockedTerms = {};
  for (const [lang, result] of Object.entries(review.languages || {})) {
    if (result.decision === "supported") continue;
    const hints = cleanTerms(candidate.generation_hints?.[lang]?.terms);
    if (!hints.length) {
      stats.missing_hints++;
      continue;
    }
    const localization = output.localizations?.[lang];
    if (!localization) continue;
    const previousTerm = String(localization.term || "").trim();
    const nextTerm = hints[0];
    lockedTerms[lang] = {
      previous_term: previousTerm,
      term: nextTerm,
      alternatives: hints.slice(1),
      previous_decision: result.decision,
      evidence_sources: candidate.generation_hints?.[lang]?.sources || [],
      evidence_families: candidate.generation_hints?.[lang]?.evidence_families || []
    };
    if (normalize(previousTerm) === normalize(nextTerm)) continue;
    localization.term = nextTerm;
    localization.reading = null;
    localization.reading_system = null;
    localization.pronunciation = null;
    localization.pronunciation_system = null;
    stats.changed_terms++;
    stats.changed_by_lang[lang] = (stats.changed_by_lang[lang] || 0) + 1;
  }

  if (Object.keys(lockedTerms).length) stats.changed_rows++;
  return {
    ...row,
    output,
    evidence_locked_terms: lockedTerms,
    requires_locked_term_enrichment: Object.values(lockedTerms).some(
      ({ previous_term, term }) => normalize(previous_term) !== normalize(term)
    )
  };
});

stats.output_rows = generated.length;
const result = {
  ok: stats.missing_validation === 0 && stats.missing_candidate === 0 && stats.missing_hints === 0,
  generated,
  stats,
  inputs: {
    generation: path.relative(process.cwd(), generationPath),
    validation: path.relative(process.cwd(), validationPath),
    candidates: path.relative(process.cwd(), candidatesPath)
  }
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...stats, ok: result.ok, out: path.relative(process.cwd(), outPath) }, null, 2));
if (!result.ok) process.exitCode = 1;

function requiredPath(name) {
  if (!args[name]) throw new Error(`Missing --${name}`);
  const filePath = path.resolve(args[name]);
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return filePath;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function uniqueByEntry(rows, label) {
  const result = new Map();
  for (const row of rows) {
    const key = String(row.source_entry_id);
    if (!key || key === "undefined") throw new Error(`${label} row is missing source_entry_id`);
    if (result.has(key)) throw new Error(`${label} contains duplicate source_entry_id ${key}`);
    result.set(key, row);
  }
  return result;
}

function cleanTerms(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const term = String(value || "").trim();
    const key = normalize(term);
    if (!term || seen.has(key)) continue;
    seen.add(key);
    result.push(term);
  }
  return result;
}

function normalize(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase();
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    result[key] = value && !value.startsWith("--") ? argv[++index] : "true";
  }
  return result;
}
