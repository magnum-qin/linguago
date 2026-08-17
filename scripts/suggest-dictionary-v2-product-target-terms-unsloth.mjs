import './lib/load-local-env.mjs';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const outPath = path.resolve(args.out || 'logs/product-target-term-suggestions.json');
const token = process.env.UNSLOTH_API_KEY;
if (!token) throw new Error('Missing UNSLOTH_API_KEY');
const endpoints = String(args.endpoints || 'http://100.99.99.99:11444,http://100.99.99.99:11447,http://100.99.99.99:11448').split(',').map((value) => value.trim()).filter(Boolean);
const model = args.model || 'unsloth/Qwen3.6-35B-A3B-MTP-GGUF';
const timeoutMs = Number(args['timeout-ms'] || 120000);
const maxTokens = Number(args['max-tokens'] || 320);
const maxAttempts = Math.max(1, Number(args['max-attempts'] || 2));
const checkpointEvery = Math.max(1, Number(args['checkpoint-every'] || 20));
const resume = String(args.resume || 'true').toLowerCase() !== 'false';
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const selected = report.selected || [];
const results = new Array(selected.length);
if (resume && fs.existsSync(outPath)) {
  const previous = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  for (const row of previous.suggestions || []) {
    const index = selected.findIndex((candidate) => candidate.candidate_key === row.candidate_key);
    if (index >= 0 && row.valid) results[index] = row;
  }
}
let nextIndex = 0;
let completedSinceCheckpoint = 0;

await Promise.all(endpoints.map(async (endpoint) => {
  while (true) {
    const index = nextIndex++;
    if (index >= selected.length) return;
    if (results[index]?.valid) continue;
    const row = selected[index];
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) try {
      const response = await fetch(`${endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt(row) }],
          temperature: 0,
          max_tokens: maxTokens,
          stream: false,
          enable_thinking: false,
          reasoning_effort: 'none',
          response_format: { type: 'json_object' }
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
      const body = await response.json();
      const content = body?.choices?.[0]?.message?.content || '';
      try {
        const parsed = parseJson(content);
        const terms = unique((parsed.terms || []).map((value) => String(value).normalize('NFKC').trim()).filter(Boolean)).slice(0, 5);
        results[index] = { ...row, endpoint, attempt, valid: terms.length > 0, terms, reason: String(parsed.reason || '').slice(0, 160) };
      } catch (error) {
        results[index] = {
          ...row,
          endpoint,
          attempt,
          valid: false,
          terms: [],
          error: String(error?.message || error),
          raw_content: String(content).slice(0, 500)
        };
      }
    } catch (error) {
      results[index] = { ...row, endpoint, attempt, valid: false, terms: [], error: String(error?.message || error) };
    } finally {
      if (results[index]?.valid || attempt === maxAttempts) break;
    }
    completedSinceCheckpoint += 1;
    if (completedSinceCheckpoint >= checkpointEvery) {
      writeOutput(false);
      completedSinceCheckpoint = 0;
    }
    console.log(`[${index + 1}/${selected.length}] ${row.target_lang} ${row.word} valid=${results[index].valid} endpoint=${new URL(endpoint).port}`);
  }
}));

const output = writeOutput(true);
console.log(JSON.stringify({ out: path.relative(process.cwd(), outPath), ...output.summary }, null, 2));

function writeOutput(final) {
  const suggestions = results.filter(Boolean);
  const output = {
    ok: final && results.every((row) => row?.valid),
    generated_at: new Date().toISOString(),
    model,
    endpoints,
    summary: {
      input: selected.length,
      completed: suggestions.length,
      valid: suggestions.filter((row) => row.valid).length,
      failed: suggestions.filter((row) => !row.valid).length
    },
    suggestions
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tempPath = `${outPath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, outPath);
  return output;
}

function prompt(row) {
  const language = row.target_lang === 'zh' ? 'Simplified Chinese' : 'Japanese';
  return `Dictionary target-term repair. Source word=${JSON.stringify(row.word)} source language=${row.source_lang}; exact English sense=${JSON.stringify(row.english_anchor)}; POS=${row.part_of_speech || 'unknown'}. Propose up to 5 natural modern standalone ${language} dictionary headwords expressing exactly this sense and grammatical role. Existing terms ${JSON.stringify(row.existing_terms)} have only one evidence family; include them only if truly exact. No definitions, romanization, explanations, rare calques, broader/narrower senses, or another POS. JSON only {"terms":[""],"reason":"under 12 words"}.`;
}
function parseJson(value) { const text = String(value).trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, ''); const start = text.indexOf('{'); const end = text.lastIndexOf('}'); if (start < 0 || end < start) throw new Error('json_object_missing'); return JSON.parse(text.slice(start, end + 1)); }
function unique(values) { return [...new Set(values)]; }
function requiredPath(value, name) { if (!value) throw new Error(`Missing --${name}`); const result = path.resolve(value); if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`); return result; }
function parseArgs(argv) { const out = {}; for (let i = 0; i < argv.length; i += 1) { if (!argv[i].startsWith('--')) continue; const key = argv[i].slice(2); const next = argv[i + 1]; if (next && !next.startsWith('--')) { out[key] = next; i += 1; } else out[key] = true; } return out; }
