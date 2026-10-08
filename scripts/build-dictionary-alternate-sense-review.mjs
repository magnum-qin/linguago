import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dailyCandidateReasons } from './lib/daily-candidate-quality.mjs';

// Alternates must come from the lane's native family. pt-BR accepts the same
// conditionally-native anchors Plan A enabled (wikdict-pt/omw/kaikki-pt);
// freedict-por-eng stays quarantined for evidence review.
export function isNativeAlternateSource(lang, source) {
  if (lang === 'zh') return source === 'cc-cedict';
  if (lang === 'ja') return source === 'jmdict';
  if (lang === 'pt-BR') return /^(?:wikdict-pt|omw|kaikki-pt)/u.test(source);
  return false;
}

export function buildAlternateReview(pool, triage) {
  const map = new Map((pool.selected || []).map((r) => [`${r.source_entry_id}:${r.first_sense_id ?? r.source_sense_id}`, r]));
  const selected = [], deferred = [], seen = new Set();
  for (const item of triage.rows || []) {
    const original = map.get(item.key);
    if (!original || original.gloss_key !== item.locked_gloss || original.word !== item.word) throw new Error(`Unbound triage ${item.key}`);
    for (const alt of item.alternatives || []) {
      const actual = original.daily_sense_selection?.alternatives?.find((r) => Number(r.id) === Number(alt.id));
      if (!actual || actual.gloss !== alt.gloss || actual.source !== alt.source || actual.blocked_reason || actual.linked_product_sense) throw new Error(`Invalid alternative ${alt.id}`);
      if (!isNativeAlternateSource(original.source_lang, alt.source) || /^CL:/u.test(alt.gloss)) continue;
      const key = `${original.source_entry_id}:${alt.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Deliberately reconstruct instead of spreading: old localization hints,
      // alignment and approval fields belong to the rejected sense.
      const row = { source_entry_id: original.source_entry_id, source_lang: original.source_lang,
        word: original.word, frequency_rank: original.frequency_rank, first_sense_id: Number(alt.id),
        candidate_key: key, gloss_key: alt.gloss, part_of_speech: alt.part_of_speech,
        production_lane: 'diagnostic_alternate', review_only: true, repair_of: item.key,
        first_sense_localizations: [], daily_sense_selection: {
          policy: 'unapproved_alternate_review_only', requires_independent_source_review: true,
          alternatives: original.daily_sense_selection.alternatives.filter((r) => isNativeAlternateSource(original.source_lang, r.source))
        } };
      const reasons = dailyCandidateReasons(row);
      if (reasons.length) deferred.push({ key, reasons });
      else selected.push(row);
    }
  }
  return { ok: true, purpose: 'alternate_sense_diagnostics_not_validation', automatic_publication: false,
    selected_count: selected.length, selected, deferred };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [pool, triage, out] = process.argv.slice(2);
  if (!out) throw new Error('Usage: build-dictionary-alternate-sense-review.mjs pool.json triage.json out.json');
  const result = buildAlternateReview(JSON.parse(fs.readFileSync(pool, 'utf8')), JSON.parse(fs.readFileSync(triage, 'utf8')));
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ selected: result.selected_count, entries: new Set(result.selected.map((r) => r.source_entry_id)).size, deferred: result.deferred.length }));
}
