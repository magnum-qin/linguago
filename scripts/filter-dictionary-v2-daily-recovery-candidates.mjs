import fs from 'node:fs';
import path from 'node:path';
import {
  dailyCandidateReasons,
  setDailyFrequencyRankLimit
} from './lib/daily-candidate-quality.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, token, index, all) => token.startsWith('--') ? [...pairs, [token.slice(2), all[index + 1]]] : pairs, []));
if (!args.report || !args.out || !['new_headword', 'additional_sense'].includes(args.lane)) throw new Error('Require --report, --out, and --lane new_headword|additional_sense');
if (args['max-frequency-rank']) setDailyFrequencyRankLimit(args['max-frequency-rank']);
const report = JSON.parse(fs.readFileSync(args.report, 'utf8'));
const selected = [], rejected = [];
for (const row of report.selected || []) {
  const reasons = dailyCandidateReasons(row, args.lane);
  if (reasons.length) rejected.push({ source_entry_id: row.source_entry_id, source_sense_id: row.first_sense_id || row.source_sense_id, word: row.word, reasons });
  else selected.push({ ...row, production_lane: args.lane });
}
const counts = {};
for (const row of rejected) for (const reason of row.reasons) counts[reason] = (counts[reason] || 0) + 1;
const output = { ...report, ok: true, selected_count: selected.length, selected, daily_recovery_quality: { input: (report.selected || []).length, selected: selected.length, rejected: rejected.length, rejected_by_reason: counts }, rejected };
fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
fs.writeFileSync(args.out, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output.daily_recovery_quality));
