import './lib/load-local-env.mjs';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const validationPath = requiredPath(args.validation, 'validation');
const outPath = path.resolve(args.out || 'logs/product-target-term-semantic-review.json');
const endpoint = String(args.endpoint || 'http://100.99.99.99:11445').replace(/\/$/u, '');
const model = String(args.model || 'unsloth/gemma-4-31B-it-qat-GGUF');
const limit = Number(args.limit || Number.MAX_SAFE_INTEGER);
const timeoutMs = Number(args['timeout-ms'] || 120000);
const token = process.env.UNSLOTH_API_KEY;
if (!token) throw new Error('Missing UNSLOTH_API_KEY');

const input = JSON.parse(fs.readFileSync(validationPath, 'utf8'));
const candidates = (input.validations || [])
  .filter((row) => row.decision === 'accept')
  .slice(0, limit);
const reviews = [];

for (let index = 0; index < candidates.length; index += 1) {
  const row = candidates[index];
  const terms = [];
  for (const accepted of row.accepted_terms || []) {
    try {
      const response = await fetch(`${endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt(row, accepted.term) }],
          temperature: 0,
          max_tokens: 160,
          enable_thinking: false,
          reasoning_effort: 'none',
          response_format: { type: 'json_object' },
          stream: false
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
      const body = await response.json();
      const parsed = parseJson(body?.choices?.[0]?.message?.content || '');
      const decision = parsed.decision === 'accept' ? 'accept' : 'reject';
      const confidence = Number(parsed.confidence);
      terms.push({
        term: accepted.term,
        valid: Number.isFinite(confidence),
        decision,
        confidence: Number.isFinite(confidence) ? confidence : null,
        reason: String(parsed.reason || '').slice(0, 200)
      });
    } catch (error) {
      terms.push({ term: accepted.term, valid: false, decision: 'error', error: String(error?.message || error) });
    }
  }
  const validTerms = terms.filter((term) => term.valid);
  const acceptedTerms = validTerms.filter((term) => term.decision === 'accept' && term.confidence >= 0.85);
  reviews.push({
    candidate_key: row.candidate_key,
    word: row.word,
    source_lang: row.source_lang,
    target_lang: row.target_lang,
    english_anchor: row.english_anchor,
    decision: acceptedTerms.length ? 'accept' : validTerms.length === terms.length ? 'reject' : 'error',
    accepted_terms: acceptedTerms.map((term) => term.term),
    terms
  });
  console.log(`[${index + 1}/${candidates.length}] ${row.word} ${row.target_lang} ${reviews.at(-1).decision}`);
}

const output = {
  ok: reviews.every((row) => row.decision !== 'error'),
  generated_at: new Date().toISOString(),
  endpoint,
  model,
  policy: { independent_model_review_is_not_dictionary_evidence: true, minimum_accept_confidence: 0.85 },
  summary: {
    input: reviews.length,
    accepted: reviews.filter((row) => row.decision === 'accept').length,
    rejected: reviews.filter((row) => row.decision === 'reject').length,
    errors: reviews.filter((row) => row.decision === 'error').length
  },
  reviews
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out: path.relative(process.cwd(), outPath), ...output.summary }, null, 2));

function prompt(row, term) {
  const language = row.target_lang === 'zh' ? 'Simplified Chinese' : 'Japanese';
  return `Dictionary semantic audit. Source word=${JSON.stringify(row.word)}; source language=${row.source_lang}; exact English sense=${JSON.stringify(row.english_anchor)}; POS=${row.part_of_speech || 'unknown'}; proposed ${language} dictionary headword=${JSON.stringify(term)}. Accept only if the proposed headword naturally expresses this exact sense and grammatical role, without being broader, narrower, archaic, or a different sense. JSON only {"decision":"accept|reject","confidence":0.0,"reason":"under 15 words"}.`;
}
function parseJson(value) {
  const text = String(value).trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('json_object_missing');
  return JSON.parse(text.slice(start, end + 1));
}
function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const result = path.resolve(value);
  if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`);
  return result;
}
function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      index += 1;
    } else out[key] = true;
  }
  return out;
}
