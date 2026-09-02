import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const primaryPath = requiredPath(args.primary, 'primary');
const secondaryPath = requiredPath(args.secondary, 'secondary');
const outPath = path.resolve(args.out || 'logs/localized-sense-exact-repair-plan.json');
const threshold = Number(args.threshold || 0.85);
const minimumSourceFamilies = Number(args['minimum-source-families'] || 2);
const primary = readJson(primaryPath);
const secondary = readJson(secondaryPath);
const secondaryById = new Map((secondary.proposals || []).map((row) => [row.candidate_id, row]));
const repairs = [];
const rejected = [];

for (const proposal of primary.proposals || []) {
  if (!proposal.valid || proposal.decision !== 'repair' || Number(proposal.confidence) < threshold) continue;
  if (Number(proposal.candidate?.evidence_summary?.source_family_count || 0) < 1) continue;
  const approval = secondaryById.get(proposal.candidate_id);
  if (!approval?.valid || approval.decision !== 'repair' || Number(approval.confidence) < threshold) continue;
  if (canonical(payload(proposal.patches)) !== canonical(payload(approval.patches))) continue;
  const familyByLinkId = new Map((proposal.candidate?.source_evidence || [])
    .filter((row) => row.link_valid && !row.source_needs_review)
    .map((row) => [Number(row.link_id), row.source_family]));
  for (const patch of proposal.patches) {
    const current = proposal.candidate.product_localizations.find((row) => row.lang === patch.lang);
    if (!current) continue;
    const evidenceLinkIds = [...patch.evidence_link_ids].map(Number).sort((a, b) => a - b);
    const citedFamilies = new Set(evidenceLinkIds.map((id) => familyByLinkId.get(id)).filter(Boolean));
    const replacementTermFamilies = familiesSupportingTerm(
      proposal.candidate?.source_evidence || [], evidenceLinkIds, patch.lang, patch.replacement?.term
    );
    const replacementCandidate = (proposal.candidate?.evidence_summary?.replacement_term_candidates?.[patch.lang] || [])
      .find((row) => normalizeTerm(row.term) === normalizeTerm(patch.replacement?.term));
    const authoritativeSingleSource = replacementCandidate?.support_policy === 'semantically_aligned_authoritative_source' &&
      citedFamilies.size >= 1 && replacementTermFamilies.size >= 1 &&
      [...citedFamilies].every(isAuthoritativeFamily) && [...replacementTermFamilies].every(isAuthoritativeFamily);
    if (evidenceLinkIds.some((id) => !familyByLinkId.has(id)) ||
        (citedFamilies.size < minimumSourceFamilies || replacementTermFamilies.size < minimumSourceFamilies) &&
        !authoritativeSingleSource) {
      rejected.push({
        candidate_id: proposal.candidate_id,
        sense_id: Number(patch.sense_id),
        lang: patch.lang,
        reason: replacementTermFamilies.size < minimumSourceFamilies
          ? 'replacement_term_without_minimum_independent_source_support'
          : 'patch_without_minimum_independent_source_families',
        evidence_link_ids: evidenceLinkIds,
        cited_source_families: [...citedFamilies],
        replacement_term_source_families: [...replacementTermFamilies]
      });
      continue;
    }
    repairs.push({
      candidate_id: proposal.candidate_id,
      entry_id: proposal.candidate.entry_id,
      headword: proposal.candidate.headword,
      sense_id: Number(patch.sense_id),
      lang: patch.lang,
      expected_current: pickLocalization(current),
      replacement: pickLocalization(patch.replacement),
      evidence_link_ids: evidenceLinkIds,
      cited_source_families: [...citedFamilies].sort(),
      replacement_term_source_families: [...replacementTermFamilies].sort(),
      support_policy: authoritativeSingleSource ? 'semantically_aligned_authoritative_source' : 'dual_family',
      confidence: Math.min(Number(proposal.confidence), Number(approval.confidence)),
      primary_model: proposal.model,
      secondary_model: approval.model
    });
  }
}

const output = {
  ok: true,
  created_at: new Date().toISOString(),
  database_write: false,
  apply_allowed: repairs.length > 0,
  source: 'llm-consensus:qwen-gemma-exact-repair-v1',
  inputs: { primary: relative(primaryPath), secondary: relative(secondaryPath) },
  minimum_source_families: minimumSourceFamilies,
  summary: { approved_localization_repairs: repairs.length, affected_senses: new Set(repairs.map((row) => row.sense_id)).size, rejected_patches: rejected.length },
  repairs,
  rejected
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary: output.summary }, null, 2));

function pickLocalization(row) {
  return Object.fromEntries(['term', 'reading', 'reading_system', 'pronunciation', 'pronunciation_system', 'definition']
    .map((key) => [key, row?.[key] ?? null]));
}
function familiesSupportingTerm(sourceEvidence, citedIds, lang, term) {
  const cited = new Set(citedIds.map(Number));
  const wanted = normalizeTerm(term);
  const families = new Set();
  for (const source of sourceEvidence || []) {
    if (!cited.has(Number(source.link_id)) || !source.link_valid || source.source_needs_review) continue;
    const candidateTerms = [];
    if (source.source_lang === lang) candidateTerms.push(...splitTerms(source.source_word));
    for (const localization of source.localizations || []) {
      if (localization.lang === lang) candidateTerms.push(...splitTerms(localization.term));
    }
    if (candidateTerms.some((value) => normalizeTerm(value) === wanted)) families.add(source.source_family);
  }
  return families;
}
function splitTerms(value) { return String(value || '').split(/[;,；、|/]+/u).map((item) => item.trim()).filter(Boolean); }
function normalizeTerm(value) { return String(value || '').normalize('NFKC').trim().toLocaleLowerCase(); }
function isAuthoritativeFamily(family) { return ['cc-cedict', 'jmdict', 'wordnet', 'freedict'].includes(family); }
function payload(patches) { return (patches || []).map((row) => ({ sense_id: Number(row.sense_id), lang: row.lang, replacement: pickLocalization(row.replacement), evidence_link_ids: [...row.evidence_link_ids].map(Number).sort((a,b)=>a-b) })); }
function canonical(value) { if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`; if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`; return JSON.stringify(value); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function relative(file) { return path.relative(process.cwd(), file); }
function requiredPath(value, name) { if(!value)throw new Error(`Missing --${name}`); const file=path.resolve(value); if(!fs.existsSync(file))throw new Error(`File not found: ${file}`); return file; }
function parseArgs(argv) { const out={}; for(let i=0;i<argv.length;i++){if(!argv[i].startsWith('--'))continue; const key=argv[i].slice(2),next=argv[i+1]; out[key]=next&&!next.startsWith('--')?argv[++i]:'true';} return out; }
