import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function compareReviews(before, after) {
  const index = (report) => {
    if (!Array.isArray(report.reviews) || !report.reviews.length) throw new Error('Missing reviews');
    const map = new Map();
    for (const row of report.reviews) {
      if (!Number.isInteger(row.source_entry_id) || !Number.isInteger(row.source_sense_id)) throw new Error('Invalid identity');
      const key = `${row.source_entry_id}:${row.source_sense_id}`;
      if (map.has(key)) throw new Error(`Duplicate identity: ${key}`);
      map.set(key, row);
    }
    return map;
  };
  const a = index(before), b = index(after);
  if (a.size !== b.size || [...a.keys()].some((key) => !b.has(key))) throw new Error('Cohort changed');
  const changes = [];
  for (const [key, row] of b) {
    const previous = a.get(key);
    if (['word', 'source_lang', 'gloss_key'].some((field) => row[field] !== previous[field])) throw new Error(`Locked sense changed: ${key}`);
    if (row.approved !== previous.approved || row.decision !== previous.decision || row.valid !== previous.valid) {
      changes.push({ key, word: row.word, gloss: row.gloss_key, before: previous.decision, after: row.decision, before_approved: previous.approved === true, after_approved: row.approved === true, before_reason: previous.reason, after_reason: row.reason });
    }
  }
  const counts = (map) => {
    const rows = [...map.values()];
    const valid = rows.filter((r) => r.valid === true).length;
    const accepted = rows.filter((r) => r.valid === true && r.approved === true && r.decision === 'accept').length;
    return { total: rows.length, valid, accepted, valid_rate: valid / rows.length, accepted_rate: accepted / rows.length };
  };
  return { kind: 'same_cohort_calibration_not_holdout', before: counts(a), after: counts(b), changed: changes.length, changes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [before, after, out] = process.argv.slice(2);
  if (!before || !after) throw new Error('Usage: compare-dictionary-source-reviews.mjs before.json after.json [out.json]');
  const report = compareReviews(JSON.parse(fs.readFileSync(before, 'utf8')), JSON.parse(fs.readFileSync(after, 'utf8')));
  const json = JSON.stringify(report, null, 2) + '\n';
  if (out) fs.writeFileSync(out, json);
  console.log(json);
}
