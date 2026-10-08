export function hasBoundNativeSourceEvidence({
  enabled,
  sourceIdentityMatches,
  nativeSourceFamily,
  matchingEvidence,
  evidenceFamilyFor
}) {
  if (!enabled || !sourceIdentityMatches || typeof evidenceFamilyFor !== 'function') return false;
  const nativeFamily = String(nativeSourceFamily || '').trim().toLowerCase();
  if (!nativeFamily || !Array.isArray(matchingEvidence)) return false;
  return matchingEvidence.some(
    (item) => evidenceFamilyFor(item?.source, item?.source_family) === nativeFamily
  );
}
