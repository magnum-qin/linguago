import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as OpenCC from 'opencc-js';

const args = parseArgs(process.argv.slice(2));
const suggestionsPath = requiredPath(args.suggestions, 'suggestions');
const sourceDbPath = requiredPath(args['source-db'] || 'data/processed/linguago_v2_full.db', 'source-db');
const supplementalPath = requiredPath(args['supplemental-db'], 'supplemental-db');
const outPath = path.resolve(args.out || 'logs/product-target-term-suggestions-validated.json');
const simplifiedToTraditional = OpenCC.Converter({ from: 'cn', to: 'tw' });
const traditionalToSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });
const report = JSON.parse(fs.readFileSync(suggestionsPath, 'utf8'));
const sourceDb = new Database(sourceDbPath, { readonly: true, fileMustExist: true });
const supplementalDb = new Database(supplementalPath, { readonly: true, fileMustExist: true });
const minTermFamilies = Number(args['min-term-families'] || 2);
const allowedZhFamilies = new Set(
  String(
    args['allowed-zh-families'] ||
      'cc-cedict,wiktionary,openhownet,cedpane-pd-definitions'
  )
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);
const allowedPtFamilies = new Set(
  String(args['allowed-pt-families'] || 'freedict,wiktionary,dicionario-aberto')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);
const findSenses = sourceDb.prepare(`SELECT ds.source_key, se.word, ss.gloss, ss.raw_json
  FROM source_entries se JOIN dictionary_sources ds ON ds.id=se.source_id
  JOIN source_senses ss ON ss.source_entry_id=se.id
  WHERE se.normalized_key=? AND se.lang=? ORDER BY ds.source_key,ss.sense_order,ss.id`);
const findSupplemental = supplementalDb.prepare(`SELECT source_key,source_family,term,english_gloss,concept_id
  FROM lexical_evidence WHERE normalized_key=? AND lang=? ORDER BY source_key,english_gloss`);
const reverseSourcesByLang = {
  zh: new Set(['cc-cedict', 'wikdict-zh-en', 'kaikki-zh']),
  ja: new Set(['jmdict', 'wikdict-ja-en', 'kaikki-ja']),
  'pt-BR': new Set(['freedict-por-eng', 'wikdict-pt-en', 'kaikki-pt'])
};

const validations = (report.suggestions || []).map((row) => {
  const terms = (row.terms || []).map((term) => validateTerm(row, term));
  const acceptedTerms = terms.filter((term) =>
    term.new_families.length && term.allowed_families.length >= minTermFamilies
  );
  return { ...row, decision: acceptedTerms.length ? 'accept' : 'reject', accepted_terms: acceptedTerms, term_validations: terms };
});
sourceDb.close(); supplementalDb.close();
const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  policy: {
    exact_or_inflectional_anchor_match: true,
    new_independent_family_required: true,
    minimum_same_term_families: minTermFamilies,
    allowed_zh_families: [...allowedZhFamilies].sort(),
    allowed_pt_families: [...allowedPtFamilies].sort(),
    llm_is_not_evidence: true
  },
  summary: { input: validations.length, accepted_candidates: validations.filter((row) => row.decision === 'accept').length, rejected_candidates: validations.filter((row) => row.decision === 'reject').length, accepted_terms: validations.reduce((sum, row) => sum + row.accepted_terms.length, 0) },
  validations
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), ...output.summary }, null, 2));

function validateTerm(row, term) {
  if (!targetScriptMatches(row.target_lang, term)) {
    return { term, evidence: [], families: [], allowed_families: [], new_families: [], rejected_reason: 'target_script_mismatch' };
  }
  const evidence = [];
  for (const variant of lookupVariants(row.target_lang, term)) {
    for (const sense of findSenses.all(normalizeTerm(variant), row.target_lang)) {
      if (!reverseSourcesByLang[row.target_lang]?.has(sense.source_key)) continue;
      for (const gloss of englishGlosses(sense)) {
        if (lexicalMatch(row.english_anchor, gloss)) evidence.push({ source: sense.source_key, family: family(sense.source_key), gloss });
      }
    }
    for (const item of findSupplemental.all(normalizeTerm(variant), row.target_lang)) {
      if (!supplementalRowMatchesCandidate(item, row.bound_candidate_key || row.candidate_key)) continue;
      if (lexicalMatch(row.english_anchor, item.english_gloss)) evidence.push({ source: item.source_key, family: item.source_family, gloss: item.english_gloss });
    }
  }
  const families = unique(evidence.map((item) => item.family));
  const allowedFamilies = row.target_lang === 'zh'
    ? allowedZhFamilies
    : row.target_lang === 'pt-BR'
      ? allowedPtFamilies
      : new Set(['jmdict', 'wiktionary', 'ejdict']);
  const newFamilies = families.filter((value) =>
    allowedFamilies.has(value) && !(row.observed_families || []).includes(value)
  );
  const allowedTermFamilies = families.filter((value) => allowedFamilies.has(value));
  return {
    term,
    evidence: uniqueEvidence(evidence),
    families,
    allowed_families: allowedTermFamilies,
    new_families: newFamilies,
    rejected_reason: allowedTermFamilies.length < minTermFamilies
      ? 'same_term_independent_families_below_threshold'
      : null
  };
}
function supplementalRowMatchesCandidate(row, candidateKey) {
  const match = /^(?:candidate:|dicionario-aberto-definition:)(.+)$/u.exec(
    String(row?.concept_id || '').trim()
  );
  if (!match) return true;
  return Boolean(candidateKey) && match[1] === String(candidateKey);
}
function targetScriptMatches(lang, term) {
  const value = String(term || '');
  if (lang === 'zh') return /\p{Script=Han}/u.test(value) && !/[A-Za-z\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
  if (lang === 'ja') return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value) && !/[A-Za-z]/u.test(value);
  if (lang === 'pt-BR') return /\p{Script=Latin}/u.test(value) && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
  return false;
}
function englishGlosses(row) {
  const raw = safeJson(row.raw_json); const values = [];
  if (row.source_key === 'cc-cedict') values.push(raw.definition, row.gloss);
  else if (row.source_key === 'jmdict') values.push(...asStrings(raw.gloss), ...asStrings(raw.glosses), raw.definition, row.gloss);
  else if (String(raw.target_lang || '') === 'en') values.push(...asStrings(raw.translations), row.gloss);
  else { values.push(...asStrings(raw.gloss), ...asStrings(raw.glosses), raw.definition); const m=String(row.gloss||'').match(/(?:^|\|)\s*en\s*:\s*([^|]+)/iu); if(m)values.push(...splitTerms(m[1])); else values.push(row.gloss); }
  return unique(values.flatMap((value) => splitTerms(value)));
}
function lookupVariants(lang, term) { if(lang!=='zh')return [term]; return unique([term,simplifiedToTraditional(term),traditionalToSimplified(term)]); }
function family(source) { const key=String(source||'').toLowerCase(); if(key.startsWith('wikdict-')||key.startsWith('kaikki-'))return 'wiktionary';if(key.startsWith('freedict-'))return 'freedict';if(key.startsWith('omw-'))return 'omw';return key; }
function lexicalMatch(left,right) { const a=new Set(splitTerms(left).map(compact)); const b=new Set(splitTerms(right).map(compact)); if([...a].some((v)=>b.has(v)))return true; const at=[...a].flatMap(inflections),bt=new Set([...b].flatMap(inflections));return at.some((v)=>bt.has(v)); }
function inflections(word) { const out=[word]; if(word.endsWith('ed')){const b=word.slice(0,-2);out.push(b,`${b}e`);} if(word.endsWith('ing')){const b=word.slice(0,-3);out.push(b,`${b}e`);} return out; }
function splitTerms(value) { return String(value||'').split(/[;|/,]/u).map((v)=>v.trim()).filter(Boolean); }
function compact(value) { return String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim(); }
function normalizeTerm(value) { return String(value||'').normalize('NFKC').toLowerCase().trim(); }
function asStrings(value) { if(Array.isArray(value))return value.flatMap(asStrings); return typeof value==='string'&&value.trim()?[value.trim()]:[]; }
function safeJson(value) { try{return JSON.parse(value||'{}');}catch{return{};} }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function uniqueEvidence(values) { const seen=new Set();return values.filter((v)=>{const k=`${v.source}\0${v.gloss}`;if(seen.has(k))return false;seen.add(k);return true;}); }
function requiredPath(value,name) { if(!value)throw new Error(`Missing --${name}`);const result=path.resolve(value);if(!fs.existsSync(result))throw new Error(`File not found: ${result}`);return result; }
function parseArgs(argv) { const out={};for(let i=0;i<argv.length;i+=1){if(!argv[i].startsWith('--'))continue;const key=argv[i].slice(2),next=argv[i+1];if(next&&!next.startsWith('--')){out[key]=next;i+=1;}else out[key]=true;}return out; }
