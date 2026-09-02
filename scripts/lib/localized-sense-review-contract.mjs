export const LOCALIZED_REVIEW_DECISIONS = new Set([
  'keep',
  'isolate',
  'split',
  'repair',
  'block',
  'manual_review'
]);
const LOCALIZATION_LANGUAGES = new Set(['en', 'pt-BR', 'zh', 'ja']);
const REPAIR_FIELDS = new Set(['term', 'definition', 'reading', 'pronunciation']);

export function validateLocalizedSenseReview(value, candidate) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) errors.push('not_object');
  if (!LOCALIZED_REVIEW_DECISIONS.has(value?.decision)) errors.push('invalid_decision');
  const confidence = Number(value?.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) errors.push('invalid_confidence');
  if (!Array.isArray(value?.matched_sense_ids)) errors.push('matched_sense_ids_missing');
  const knownSenseIds = new Set((candidate?.senses || []).map((row) => Number(row.id)));
  const matchedSenseIds = Array.isArray(value?.matched_sense_ids)
    ? value.matched_sense_ids.map(Number)
    : [];
  if (matchedSenseIds.some((id) => !Number.isInteger(id) || !knownSenseIds.has(id))) {
    errors.push('unknown_matched_sense_id');
  }
  if (new Set(matchedSenseIds).size !== matchedSenseIds.length) errors.push('duplicate_matched_sense_id');
  if (value?.decision === 'keep' && matchedSenseIds.length !== knownSenseIds.size) {
    errors.push('keep_requires_all_senses');
  }
  if (value?.decision === 'isolate' && (matchedSenseIds.length === 0 || matchedSenseIds.length >= knownSenseIds.size)) {
    errors.push('isolate_requires_nonempty_proper_subset');
  }
  if (!Array.isArray(value?.reason_codes)) errors.push('reason_codes_missing');
  if (typeof value?.reason !== 'string' || !value.reason.trim()) errors.push('reason_missing');
  if (!Array.isArray(value?.actions)) errors.push('actions_missing');
  if (value?.decision === 'repair' && Array.isArray(value?.actions)) {
    const repairActions = value.actions.filter((action) => action?.type === 'repair_localization');
    if (!repairActions.length) errors.push('repair_action_missing');
    for (const action of repairActions) {
      if (!LOCALIZATION_LANGUAGES.has(action?.target_lang)) errors.push('repair_target_lang_invalid');
      if (!Array.isArray(action?.fields) || !action.fields.length || action.fields.some((field) => !REPAIR_FIELDS.has(field))) {
        errors.push('repair_fields_invalid');
      }
      const actionSenseIds = Array.isArray(action?.sense_ids) ? action.sense_ids.map(Number) : [];
      if (!actionSenseIds.length || actionSenseIds.some((id) => !Number.isInteger(id) || !knownSenseIds.has(id))) {
        errors.push('repair_action_sense_ids_invalid');
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function needsIndependentReview(review, threshold = 0.95) {
  return review?.valid !== true || review.decision !== 'keep' || Number(review.confidence) < threshold;
}
