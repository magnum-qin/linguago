import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const key = r => `${r.source_entry_id}:${r.source_sense_id ?? r.first_sense_id}`;
const accepted = r => r?.valid === true && r.approved === true &&
  r.decision === 'accept' && Number(r.confidence) >= 0.9 &&
  Array.isArray(r.risk_flags) && r.risk_flags.length === 0;

function index(rows) {
  const result = new Map();
  for (const row of rows) {
    if (result.has(key(row))) throw new Error(`Duplicate identity ${key(row)}`);
    result.set(key(row), row);
  }
  return result;
}

export function buildRevision(pool, initial, alternatives, first, second, blockedIds = []) {
  const originals = index(pool.selected || []);
  const prior = index(initial.reviews || []);
  const a = index(first.reviews || []), b = index(second.reviews || []);
  const blocked = new Set(blockedIds.map(String));
  const byEntry = new Map(), changes = [], deferred = [];
  for (const alt of index(alternatives.selected || []).values()) {
    const ra = a.get(key(alt)), rb = b.get(key(alt));
    for (const review of [ra, rb]) {
      if (review && (review.word !== alt.word || review.gloss_key !== alt.gloss_key || review.source_lang !== alt.source_lang)) {
        throw new Error(`Unbound alternative review ${key(alt)}`);
      }
    }
    if (!accepted(ra) || !accepted(rb)) continue;
    const list = byEntry.get(String(alt.source_entry_id)) || [];
    list.push(alt);
    byEntry.set(String(alt.source_entry_id), list);
  }
  const selected = [...originals.values()].map(row => {
    const review = prior.get(key(row));
    if (!review || review.word !== row.word || review.gloss_key !== row.gloss_key) throw new Error(`Unbound original ${key(row)}`);
    const options = byEntry.get(String(row.source_entry_id)) || [];
    if (review.valid === true && review.approved === true && review.decision === 'accept') return structuredClone(row);
    if (blocked.has(String(row.source_entry_id)) || options.length !== 1) {
      deferred.push({ key: key(row), reason: blocked.has(String(row.source_entry_id)) ? 'explicit_source_hold' : 'no_unique_consensus_alternative' });
      return structuredClone(row);
    }
    const alt = options[0];
    const native = row.daily_sense_selection?.alternatives?.find(x => Number(x.id) === Number(alt.first_sense_id));
    if (!native || native.gloss !== alt.gloss_key || native.blocked_reason || native.linked_product_sense || alt.word !== row.word) {
      throw new Error(`Alternative absent from locked source ${key(alt)}`);
    }
    changes.push({ word: row.word, previous_key: key(row), next_key: key(alt), previous_gloss: row.gloss_key, next_gloss: alt.gloss_key });
    // Reconstruct only source-bound fields; never carry old translation hints or approvals.
    return { source_entry_id: row.source_entry_id, word: row.word, source_lang: row.source_lang,
      normalized_key: row.normalized_key, frequency_rank: row.frequency_rank,
      first_sense_id: alt.first_sense_id, candidate_key: key(alt), gloss_key: alt.gloss_key,
      part_of_speech: native.part_of_speech, first_sense_localizations: [],
      daily_sense_selection: { policy: 'revised_unique_consensus_source_requires_full_rereview',
        alternatives: structuredClone(row.daily_sense_selection.alternatives), requires_independent_source_review: true } };
  });
  return { purpose: 'same_cohort_repair_not_fresh_holdout', automatic_publication: false,
    qualified: false, requires_full_source_rereview: true, selected_count: selected.length,
    selected, changes, deferred };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [pool, prior, alternatives, first, second, out, blocked = ''] = process.argv.slice(2);
  if (!out) throw new Error('Usage: builder pool prior alternatives first second out [blocked-entry-ids]');
  if (fs.existsSync(out)) throw new Error('Output already exists');
  const inputs = [pool, prior, alternatives, first, second];
  const buffers = inputs.map(p => fs.readFileSync(p));
  const result = buildRevision(...buffers.map(b => JSON.parse(b.toString('utf8'))), blocked.split(',').filter(Boolean));
  result.input_sha256 = Object.fromEntries(inputs.map((p, i) => [p, crypto.createHash('sha256').update(buffers[i]).digest('hex')]));
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ selected: result.selected_count, changed: result.changes.length, deferred: result.deferred.length }));
}
