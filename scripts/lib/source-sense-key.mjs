export function sourceSenseKey(sourceEntryId, sourceSenseId) {
  return `${normalizeIdentifier(sourceEntryId)}:${normalizeIdentifier(sourceSenseId)}`;
}

export function candidateSourceSenseKey(row) {
  return sourceSenseKey(
    row?.source_entry_id,
    row?.source_sense_id ?? row?.first_sense_id ?? row?.useful_senses?.[0]?.id
  );
}

function normalizeIdentifier(value) {
  if (value === null || value === undefined || value === "") return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
