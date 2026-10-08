export function bindSourceReviews(selected, primary, independent) {
  const key = (row) => `${row.source_entry_id}:${row.source_sense_id ?? row.first_sense_id}`;
  function unique(rows, label) {
    const result = new Map();
    for (const row of rows) {
      const id = row.source_sense_id ?? row.first_sense_id;
      if (!Number.isInteger(Number(row.source_entry_id)) || Number(row.source_entry_id) <= 0 ||
          !Number.isInteger(Number(id)) || Number(id) <= 0) throw new Error(`Invalid ${label} identity`);
      if (result.has(key(row))) throw new Error(`Duplicate ${label} ${key(row)}`);
      result.set(key(row), row);
    }
    return result;
  }
  const candidates = unique(selected, 'candidate');
  const first = unique(primary, 'primary review');
  const second = unique(independent, 'independent review');
  for (const [id, row] of [...first, ...second]) {
    const candidate = candidates.get(id);
    if (!candidate || candidate.word !== row.word || candidate.source_lang !== row.source_lang ||
        candidate.gloss_key !== row.gloss_key) throw new Error(`Unbound review ${id}`);
  }
  for (const id of second.keys()) {
    if (!first.has(id)) throw new Error(`Independent review without primary ${id}`);
  }
  return { candidates, first, second };
}

export function isAcceptedSourceReview(row) {
  return row?.valid === true && row?.approved === true && row?.decision === 'accept';
}

export function assertProposalWriteMode(rows, { apply, publishable }) {
  if ((apply || publishable) && rows.some((row) => row.proposal_only === true)) {
    throw new Error('Unreviewed translation proposals cannot be applied or published');
  }
}
