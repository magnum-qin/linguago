import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const generationPath = requiredPath(args.generation, 'generation');
const reversePath = requiredPath(args.reverse, 'reverse');
const outPath = path.resolve(required(args.out, 'out'));
const targetLangs = new Set(String(args['target-langs'] || 'pt-BR,ja').split(',').map((value) => value.trim()).filter(Boolean));
const generation = JSON.parse(fs.readFileSync(generationPath, 'utf8'));
const reverse = JSON.parse(fs.readFileSync(reversePath, 'utf8'));
const generatedByKey = new Map((generation.generated || []).filter((row) => row.valid).map((row) => [key(row), row]));
const selected = [];

for (const validation of reverse.validations || []) {
  const generated = generatedByKey.get(key(validation));
  if (!generated) continue;
  for (const targetLang of targetLangs) {
    const language = validation.languages?.[targetLang];
    if (!language || language.decision === 'supported') continue;
    const term = generated.output?.localizations?.[targetLang]?.term;
    selected.push({
      candidate_key: key(validation),
      bound_candidate_key: key(validation),
      source_entry_id: Number(validation.source_entry_id),
      source_sense_id: Number(validation.source_sense_id),
      word: validation.word,
      source_lang: validation.source_lang,
      target_lang: targetLang,
      english_anchor: validation.anchor,
      part_of_speech: generated.output?.part_of_speech || null,
      frequency_rank: generated.frequency_rank,
      existing_terms: term ? [term] : [],
      observed_families: unique((language.evidence?.strong_matches || []).map((row) => family(row.source))),
      previous_decision: language.decision,
      previous_reason: language.reason,
    });
  }
}

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  generation_report: path.relative(process.cwd(), generationPath),
  reverse_report: path.relative(process.cwd(), reversePath),
  policy: { llm_suggestions_are_not_evidence: true, exact_candidate_binding_required: true },
  summary: { selected: selected.length, by_target_lang: countBy(selected, (row) => row.target_lang) },
  selected,
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2));

function key(row) { return `${Number(row.source_entry_id)}:${Number(row.source_sense_id ?? row.output?.source_sense_id)}`; }
function family(source) { const value=String(source||'').toLowerCase();if(value.startsWith('wikdict-')||value.startsWith('kaikki-'))return 'wiktionary';if(value.startsWith('freedict-'))return 'freedict';return value; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function countBy(values, selector) { const result={};for(const value of values){const key=selector(value);result[key]=(result[key]||0)+1;}return result; }
function required(value,name){if(!value)throw new Error(`Missing --${name}`);return String(value);}
function requiredPath(value,name){const result=path.resolve(required(value,name));if(!fs.existsSync(result))throw new Error(`File not found: ${result}`);return result;}
function parseArgs(argv){const out={};for(let i=0;i<argv.length;i+=1){if(!argv[i].startsWith('--'))continue;const key=argv[i].slice(2),next=argv[i+1];out[key]=next&&!next.startsWith('--')?argv[++i]:'true';}return out;}
