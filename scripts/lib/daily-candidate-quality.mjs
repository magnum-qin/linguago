import OpenCC from 'opencc-js';

const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });

export function dailyCandidateReasons(row, lane = row.production_lane) {
  const word = String(row.word || '').trim();
  const gloss = String(row.gloss_key || row.gloss_preview || row.first_gloss_preview || '').trim();
  const reasons = [];
  const id = Number(row.first_sense_id || row.source_sense_id);
  const selectedSource = row.daily_sense_selection?.alternatives?.find((sense) => Number(sense.id) === id)?.source;
  // v219 raw-TEI spot review found suspect first-translation anchors in this
  // source lane. Quarantine for evidence review, never silently substitute a sense.
  if (row.source_lang === 'pt-BR' && String(selectedSource || '').toLowerCase() === 'freedict-por-eng') {
    reasons.push('freedict_pt_primary_requires_evidence_review');
  }
  if (!Number.isInteger(id) || id <= 0 || !gloss) reasons.push('missing_exact_source_sense');
  if (row.source_lang === 'zh' && toSimplified(word) !== word) reasons.push('traditional_primary_form');
  if (['zh', 'ja'].includes(row.source_lang) && [...word].length < 2) reasons.push('single_character_deferred');
  if (['en', 'pt-BR'].includes(row.source_lang) && (/^[A-Z]/u.test(word) || word.length < 3)) reasons.push('proper_or_abbreviation_shape');
  if (/\b(?:surname|given name|place name|province|prefecture|chemical|enzyme|protein|species|genus|archaic|obsolete|tribunal|Buddhist priest|defen[cs]e force)\b/iu.test(gloss) || /\b[A-Z][a-z]+ River\b/u.test(gloss)) reasons.push('proper_specialized_or_nonmodern_gloss');
  if (gloss.length > 180) reasons.push('verbose_sense_deferred');
  if (/\b(?:abbr\.|abbreviation)\s+(?:for|of)\b/iu.test(gloss)) reasons.push('abbreviation_redirect_deferred');
  if (/\b(?:methyl|ectogenesis)\b/iu.test(gloss)) reasons.push('specialized_daily_scope_deferred');
  if (!Number.isFinite(Number(row.frequency_rank)) || Number(row.frequency_rank) < 1 || Number(row.frequency_rank) > 50000) reasons.push('outside_daily_frequency_limit');
  if (/\uFFFD|<\/?[a-z][^>]*>/iu.test(word + ' ' + gloss)) reasons.push('text_artifact');
  if (lane === 'new_headword') {
    const alternatives = row.daily_sense_selection?.alternatives || [];
    const selected = alternatives.find((sense) => Number(sense.id) === id);
    if (!selected) reasons.push('missing_primary_comparison');
    else if (alternatives.some((sense) => !sense.blocked_reason && Number(sense.score) > Number(selected.score))) {
      reasons.push('higher_priority_sense_skipped');
    }
  }
  return [...new Set(reasons)];
}
