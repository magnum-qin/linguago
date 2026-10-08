import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { bindSourceReviews, isAcceptedSourceReview } from './lib/source-consensus-binding.mjs';

// Sense agreement permits drafting, not claiming agreement on translations
// that the reviewers have not yet seen.
export function buildSenseProposals(pool, primary, independent) {
  const { candidates, first, second } = bindSourceReviews(pool.selected || [], primary.reviews || [], independent.reviews || []);
  const selected = [];
  for (const [id, candidate] of candidates) {
    if (!isAcceptedSourceReview(first.get(id)) || !isAcceptedSourceReview(second.get(id))) continue;
    const row = structuredClone(candidate);
    delete row.candidate_evidence_review;
    delete row.source_review_consensus;
    delete row.source_review_proposal_lock;
    selected.push({ ...row, promote_allowed: false,
      proposal_only: true,
      sense_review_agreement: { source_entry_id: candidate.source_entry_id,
        source_sense_id: candidate.source_sense_id ?? candidate.first_sense_id,
        qwen: { decision: first.get(id).decision, reason: first.get(id).reason },
        gemma: { decision: second.get(id).decision, reason: second.get(id).reason },
        translation_agreement: false } });
  }
  return { ok: true, policy: { draft_proposals_only: true, automatic_publication: false,
    final_translation_review_required: true, reverse_evidence_required: true },
    selected_count: selected.length, selected };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [pool, primary, independent, out] = process.argv.slice(2);
  if (!out) throw new Error('Usage: build-source-sense-proposals.mjs pool primary independent out');
  const inputs = [pool, primary, independent].map((file) => fs.readFileSync(file));
  const result = buildSenseProposals(...inputs.map((raw) => JSON.parse(raw.toString('utf8'))));
  result.input_sha256 = inputs.map((raw) => crypto.createHash('sha256').update(raw).digest('hex'));
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ selected: result.selected_count, proposal_only: true }));
}
