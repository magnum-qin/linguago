import fs from 'node:fs';
import path from 'node:path';

function argsOf(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    out[key] = next && !next.startsWith('--') ? (i += 1, next) : true;
  }
  return out;
}

const args = argsOf(process.argv);
const input = path.resolve(args.input || 'logs/localized-sense-review-v5-consensus-final.json');
const output = path.resolve(args.output || 'logs/localized-sense-review-v5-human-labels.json');
const target = Math.max(20, Number(args.limit || 25));
const report = JSON.parse(fs.readFileSync(input, 'utf8'));

function compact(row) {
  const candidate = row.candidate || {};
  return {
    candidate_id: row.candidate_id,
    entry_id: row.entry_id,
    headword: row.headword,
    primary_lang: candidate.entry?.primary_lang || null,
    frequency_rank: candidate.entry?.frequency_rank || null,
    query_lang: row.query_lang,
    query_term: row.query_term,
    pipeline_status: row.status,
    pipeline_decision: row.decision || null,
    pipeline_matched_sense_ids: row.matched_sense_ids || [],
    disagreement_codes: row.disagreement_codes || [],
    primary_review: row.primary || null,
    secondary_review: row.secondary || null,
    senses: candidate.senses || [],
    candidate,
    human_label: null,
    human_matched_sense_ids: [],
    human_note: '',
    reviewer: '',
    reviewed_at: null
  };
}

function selectUnique(rows, count, selected, entryCounts, maxPerEntry) {
  for (const row of rows) {
    if (selected.length >= count) break;
    if (selected.some((item) => item.candidate_id === row.candidate_id)) continue;
    const used = entryCounts.get(row.entry_id) || 0;
    if (used >= maxPerEntry) continue;
    selected.push(compact(row));
    entryCounts.set(row.entry_id, used + 1);
  }
}

const rows = Array.isArray(report.rows) ? report.rows : [];
const consensus = rows.filter((row) => row.status === 'consensus');
const boundary = rows.filter((row) => row.status !== 'consensus');
const selected = [];
const entryCounts = new Map();
selectUnique(consensus, Math.min(16, target), selected, entryCounts, 1);
selectUnique(boundary, target, selected, entryCounts, 1);
selectUnique(boundary, target, selected, entryCounts, 2);
selectUnique(consensus, target, selected, entryCounts, 2);

const value = {
  schema_version: 1,
  created_at: new Date().toISOString(),
  source_report: input,
  allowed_labels: ['correct_isolate', 'should_keep', 'needs_repair', 'uncertain'],
  instructions: {
    correct_isolate: 'The query form is valid only for human_matched_sense_ids.',
    should_keep: 'The query form is semantically valid across the entry senses.',
    needs_repair: 'The localization is wrong or misleading and needs repair or block, not query isolation.',
    uncertain: 'Evidence is insufficient for a safe decision.'
  },
  summary: {
    selected: selected.length,
    consensus_samples: selected.filter((row) => row.pipeline_status === 'consensus').length,
    boundary_samples: selected.filter((row) => row.pipeline_status !== 'consensus').length,
    distinct_entries: new Set(selected.map((row) => row.entry_id)).size,
    labeled: 0
  },
  rows: selected
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(value.summary, null, 2));
