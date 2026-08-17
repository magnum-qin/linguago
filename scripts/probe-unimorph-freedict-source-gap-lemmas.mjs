import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const unimorphPath = requiredPath(args.unimorph || 'data/raw/unimorph/por.tsv', 'unimorph');
const freedictPath = requiredPath(args.freedict || 'data/raw/freedict-por-eng.tei', 'freedict');
const outPath = path.resolve(args.out || 'logs/product-source-gap-unimorph-freedict-lemma-candidates.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

const forms = new Map();
let unimorphRows = 0;
for (const line of fs.readFileSync(unimorphPath, 'utf8').split(/\r?\n/u)) {
  if (!line) continue;
  const [lemma, form, features] = line.split('\t');
  if (!lemma || !form) continue;
  unimorphRows += 1;
  const key = normalizePortuguese(form);
  if (!forms.has(key)) forms.set(key, []);
  forms.get(key).push({ lemma, features: features || null });
}

const freedict = new Map();
const tei = fs.readFileSync(freedictPath, 'utf8');
for (const match of tei.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gu)) {
  const block = match[1];
  const orth = cleanXml(firstMatch(block, /<orth[^>]*>([\s\S]*?)<\/orth>/u));
  if (!orth) continue;
  const translations = [...block.matchAll(/<quote[^>]*>([\s\S]*?)<\/quote>/gu)]
    .map((item) => cleanXml(item[1]))
    .filter(Boolean);
  freedict.set(normalizePortuguese(orth), { orth, translations: unique(translations) });
}

const sourceRows = (report.near_unlock || report.selected || [])
  .filter((row) => row.source_lang === 'pt-BR');
const assessed = sourceRows.map((row) => {
  const analyses = forms.get(normalizePortuguese(row.word)) || [];
  const lemmaMatches = unique(analyses.map((item) => item.lemma))
    .map((lemma) => ({ lemma, freedict: freedict.get(normalizePortuguese(lemma)) }))
    .filter((item) => item.freedict);
  const lemmaEvidence = lemmaMatches.flatMap((item) =>
    item.freedict.translations.map((translation) => ({
      source_key: 'freedict-por-eng-via-unimorph',
      source_lang: 'pt-BR',
      word: item.lemma,
      part_of_speech: null,
      gloss: translation
    }))
  );
  return {
    ...row,
    first_sense_id: row.source_sense_id,
    gloss_key: row.anchor,
    supplemental_evidence: lemmaEvidence,
    status: lemmaMatches.length ? 'semantic_review' : analyses.length ? 'lemma_without_freedict' : 'unmatched',
    morphology: analyses,
    lemma_matches: lemmaMatches
  };
});
const selected = assessed.filter((row) => row.status === 'semantic_review');
const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  policy: {
    diagnostic_only: true,
    publication_evidence: false,
    unimorph_is_morphology_not_independent_sense_evidence: true,
    freedict_lemma_translation_requires_semantic_review: true,
    direct_evidence_export_forbidden: true
  },
  inputs: {
    report: relative(reportPath),
    report_sha256: sha256File(reportPath),
    unimorph: relative(unimorphPath),
    unimorph_sha256: sha256File(unimorphPath),
    freedict: relative(freedictPath),
    freedict_sha256: sha256File(freedictPath)
  },
  summary: {
    unimorph_rows: unimorphRows,
    unimorph_forms: forms.size,
    input_rows: sourceRows.length,
    morphology_mapped: assessed.filter((row) => row.morphology.length).length,
    semantic_review_rows: selected.length,
    statuses: countBy(assessed, (row) => row.status)
  },
  selected,
  assessed
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary: output.summary }, null, 2));

function cleanXml(value) { return String(value || '').replace(/<[^>]+>/gu, '').replace(/&amp;/gu, '&').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').trim(); }
function firstMatch(value, pattern) { return String(value || '').match(pattern)?.[1] || ''; }
function normalizePortuguese(value) { return String(value || '').normalize('NFKC').toLocaleLowerCase('pt-BR').trim(); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function countBy(rows, getKey) { const out = {}; for (const row of rows) { const key = getKey(row); out[key] = (out[key] || 0) + 1; } return out; }
function sha256File(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); }
function relative(filePath) { return path.relative(process.cwd(), filePath); }
function requiredPath(value, name) { if (!value) throw new Error(`Missing --${name}`); const result = path.resolve(value); if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`); return result; }
function parseArgs(argv) { const out = {}; for (let i = 0; i < argv.length; i += 1) { if (!argv[i].startsWith('--')) continue; const key = argv[i].slice(2); const next = argv[i + 1]; if (next && !next.startsWith('--')) { out[key] = next; i += 1; } else out[key] = true; } return out; }
