import OpenCC from 'opencc-js';
import { boundJmdictMetadata } from './jmdict-review-metadata.mjs';

const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });

export const JAPANESE_GRAMMAR_FRAGMENTS = new Set([
  'れる', 'せる', 'られる', 'させる', 'たい', 'らしい', 'そう', 'ない', 'ます', 'だ', 'です',
  'てる', 'ちゃう', 'とる', 'やれ', 'ませ'
]);

export function dailyCandidateReasons(row, lane = row.production_lane) {
  const word = String(row.word || '').trim();
  const gloss = String(row.gloss_key || row.gloss_preview || row.first_gloss_preview || '').trim();
  const boundGlosses = [
    gloss,
    ...(row.daily_sense_selection?.alternatives || []).map((sense) => String(sense?.gloss || '').trim())
  ].filter(Boolean).join(' | ');
  const reasons = [];
  // Regional markers require an explicit Mainland-equivalent review. Do not
  // rewrite the headword or infer that no Mainland equivalent exists.
  if (row.source_lang === 'zh' && /\((?:Tw|Taiwan|Taiwanese)(?:\s+usage)?\)/iu.test(gloss)) reasons.push('mainland_equivalent_review_required');
  const metadata = boundJmdictMetadata(row);
  if (metadata?.register?.some((tag) => ['&product;', '&person;', '&place;', '&organization;', '&work;'].includes(tag))) reasons.push('native_named_entity');
  if (metadata?.register?.some((tag) => ['&vulg;', '&derog;', '&offens;'].includes(tag))) reasons.push('native_non_neutral_register');
  const id = Number(row.first_sense_id || row.source_sense_id);
  // Per-sense calls have no alternatives array; fall back to the sense's own
  // source so the quarantine also blocks the alternative at selection time.
  const selectedSource = row.daily_sense_selection?.alternatives?.find((sense) => Number(sense.id) === id)?.source ?? row.source;
  // v219 raw-TEI spot review found suspect first-translation anchors in this
  // source lane. Quarantine for evidence review, never silently substitute a sense.
  if (row.source_lang === 'pt-BR' && String(selectedSource || '').toLowerCase() === 'freedict-por-eng') {
    reasons.push('freedict_pt_primary_requires_evidence_review');
  }
  if (!Number.isInteger(id) || id <= 0 || !gloss) reasons.push('missing_exact_source_sense');
  if (row.source_lang === 'zh' && toSimplified(word) !== word) reasons.push('traditional_primary_form');
  if (row.source_lang === 'zh' && row.source_word && word !== String(row.source_word).trim()) {
    reasons.push('noncanonical_native_form');
  }
  if (['zh', 'ja'].includes(row.source_lang) && [...word].length < 2) reasons.push('single_character_deferred');
  if (['en', 'pt-BR'].includes(row.source_lang) && (/^[A-Z]/u.test(word) || word.length < 3)) reasons.push('proper_or_abbreviation_shape');
  const posTags = String(row.part_of_speech || '').split(/\s+/u);
  if (
    row.source_lang === 'ja' &&
    (JAPANESE_GRAMMAR_FRAGMENTS.has(word) ||
      posTags.some((tag) => ['&aux-v;', '&suf;', '&aux;', '&aux-adj;'].includes(tag)) ||
      /\b(?:auxiliary verb|passive voice|causative voice|potential form)\b/iu.test(boundGlosses))
  ) {
    reasons.push('japanese_grammatical_fragment');
  }
  if (
    row.source_lang === 'ja' &&
    posTags.includes('&exp;') &&
    [...word].length <= 3 &&
    /(?:\.\.\.|\be\.g\.|indicates? the .* form)/iu.test(gloss)
  ) {
    reasons.push('japanese_grammatical_expression_deferred');
  }
  if (/\b(?:surname|given name|place name|province|prefecture|chemical|enzyme|protein|species|genus|archaic|obsolete|tribunal|Buddhist priest|defen[cs]e force)\b/iu.test(gloss) || /\b[A-Z][a-z]+ River\b/u.test(gloss)) reasons.push('proper_specialized_or_nonmodern_gloss');
  if (/^same as\b/iu.test(gloss)) reasons.push('dictionary_redirect_deferred');
  if (
    /\b(?:military district|geographical area of command|military region|military command|poverty alleviation|government minister|output value|collective reference to all the ethnic groups|ministry of|party cadre|Cultural Revolution|family planning policy)\b/iu.test(boundGlosses)
  ) {
    reasons.push('administrative_or_historical_daily_scope');
  }
  if (/\b(?:winter solstice.*summer solstice|successive \((?:presidents|ministers|officials))\b/iu.test(gloss)) {
    reasons.push('specialized_calendar_or_official_scope');
  }
  if (/\b(?:lieutenant general|major general|brigadier general|field marshal)\b/iu.test(boundGlosses)) reasons.push('military_rank_deferred');
  if (/\b(?:morphine|quicksilver|hydrargyrum)\b/iu.test(gloss)) reasons.push('specialized_substance_deferred');
  if (/\b[A-Z][a-z]+\s*\((?:god|goddess|Catholic translation|Protestant translation)\)/u.test(gloss)) reasons.push('named_person_or_deity');
  if (/\b(?:angel|demon)\s*\(loanword\)/iu.test(gloss)) reasons.push('transliterated_named_concept');
  if (gloss.length > 180) reasons.push('verbose_sense_deferred');
  if (/\b(?:gang rape|adult video|pornographic)\b/iu.test(gloss)) reasons.push('non_neutral_daily_scope');
  if (/\((?:proper )?name\)/iu.test(gloss)) reasons.push('explicit_named_entity');
  if (/\b(?:abbr\.|abbreviation)\s+(?:for|of)\b/iu.test(gloss)) reasons.push('abbreviation_redirect_deferred');
  if (/\b(?:methyl|ectogenesis)\b/iu.test(gloss)) reasons.push('specialized_daily_scope_deferred');
  // Defer explicit named works and narrow anatomy terminology, not generic
  // books, body parts or everyday health vocabulary. This is scope, not truth.
  if (
    /\b(?:one of the (?:Five|Four) Classics|(?:novel|poem|play|film) by [A-Z][a-z]+|(?:Book|Classic) of [A-Z][a-z]+.*(?:collection|Confucian)|Book of (?:History|Documents|Songs|Changes|Rites)|Book of [A-Z][a-z]+ in the (?:Old|New) Testament|Classic of (?:History|Poetry)|Shangshu|Shujing|Yijing|Shijing)\b/iu.test(boundGlosses)
  ) {
    reasons.push('named_literary_work_deferred');
  }
  if (/\b(?:meninges|meninx|dura mater|pia mater|arachnoid mater)\b/iu.test(gloss)) {
    reasons.push('specialized_anatomy_deferred');
  }
  if (
    /\(\d{4}\s*[-\u2013]\s*\d{0,4}\)/u.test(boundGlosses) ||
    /\([^)]*\b(?:sports team|publisher|record label)\b[^)]*\)/iu.test(boundGlosses) ||
    /\b(?:Sun Yat-sen|Sun Zhongshan|first president of the Republic of China|Kuomintang|Guomintang)\b/iu.test(boundGlosses)
  ) {
    reasons.push('biographical_or_named_organization');
  }
  if (
    /\b(?:autonomous region|capital (?:is |of )?[A-Z]|group of (?:northern )?(?:nomadic )?peoples?|name of numerous (?:other )?places)\b/iu.test(gloss) ||
    /\b[A-Z][a-z']+,\s*(?:[A-Z][a-z']+|Texas|Russia|England|France|Japan|China)\b/u.test(gloss) ||
    /\bMt\.?\s[A-Z][a-z]+/u.test(gloss) ||
    /\balternative name for\b/iu.test(gloss) ||
    /\b(?:Hong Kong area|MTR station)\b/iu.test(gloss) ||
    /\balso (?:can )?refer to\b/iu.test(boundGlosses) ||
    /\bin [A-Z][a-z]+(?:\s+[A-Z][a-z]+)?'s translation\b/u.test(gloss)
  ) {
    reasons.push('geopolitical_or_historical_group');
  }
  if (/\b(?:erhua variant|variant of|old variant of)\b/iu.test(gloss)) reasons.push('form_redirect_deferred');
  if (/\b(?:during [A-Z][a-z]+ to [A-Z][a-z]+ times|concubine|prefectural magistrate|in former times)\b/u.test(gloss) || /\b(?:Warring States|Sengoku period|Edo period|Heian period|Kamakura period|Muromachi period|Meiji (?:era|period|restoration)|(?:Ming|Qing|Song|Tang|Yuan|Han) (?:dynasty|imperial|reign)|imperial resort|\d+(?:st|nd|rd|th)[-\u2013]?\d*(?:st|nd|rd|th)? century)\b/iu.test(boundGlosses)) {
    reasons.push('historical_daily_scope_deferred');
  }
  // Transliterated proper names and biographical/brand entries carry Latin
  // headword redirects, reign dates, or explicit brand markers in the gloss.
  if (
    /\b(?:also rendered as|also written as|also translated as)\b/iu.test(boundGlosses) ||
    /\b(?:brand of|car make|trademark)\b/iu.test(boundGlosses) ||
    /\bexpert at\b/iu.test(gloss) ||
    /\(\d{1,4}\s*[-\u2013]\s*\d{0,4}\s*(?:BC|BCE)\)/u.test(boundGlosses) ||
    /\breign name\b/iu.test(boundGlosses)
  ) {
    reasons.push('biographical_or_named_organization');
  }
  // English glosses that embed Han characters are script redirects or
  // idiom-component entries (e.g. "Humen Town 虎门镇[Hu3 men2 Zhen4]").
  if (row.source_lang === 'zh' && /[\u4e00-\u9fff]/u.test(gloss)) reasons.push('nonlatin_gloss_redirect');
  if (/mostly used in expressions like/iu.test(boundGlosses)) reasons.push('idiom_component_deferred');
  if (/Taiwan pr\.\s*\[/iu.test(gloss)) reasons.push('pronunciation_note_only_gloss');
  // Ellipsis glosses are pattern/template descriptions ("Is there a ...?"),
  // not standalone everyday lexical senses. Grammatical placeholders such as
  // "(verb, infinitive)" mark A-not-A or construction-pattern entries.
  if (row.source_lang === 'zh' && /\.\.\./u.test(gloss)) reasons.push('pattern_fragment_gloss_deferred');
  if (row.source_lang === 'zh' && /\((?:verb|adjective|noun|clause|phrase|numeral|measure word)\s*[,)]/iu.test(gloss)) reasons.push('pattern_fragment_gloss_deferred');
  // Wikdict multi-language gloss dumps ("en: gruel", "en: aback | ja: 裏帆")
  // are import artifacts, not a usable English anchor.
  if (/^(?:en|ja|zh|es|fr|de|pt):\s/iu.test(gloss) || /\|\s*(?:en|ja|zh|es|fr|de|pt):\s/iu.test(gloss)) {
    reasons.push('multilang_gloss_artifact');
  }
  if (!Number.isFinite(Number(row.frequency_rank)) || Number(row.frequency_rank) < 1 || Number(row.frequency_rank) > 50000) reasons.push('outside_daily_frequency_limit');
  if (/\uFFFD|<\/?[a-z][^>]*>/iu.test(word + ' ' + gloss)) reasons.push('text_artifact');
  if (lane === 'new_headword' && row.daily_sense_selection?.alternatives?.length) {
    const alternatives = row.daily_sense_selection.alternatives;
    const selected = alternatives.find((sense) => Number(sense.id) === id);
    // A dual-model-confirmed primary sense outranks order heuristics; the
    // pinned selection must not be re-litigated by the fallback checks.
    if (row.daily_sense_selection?.confirmed_sense !== undefined && Number(row.daily_sense_selection.confirmed_sense) === id) {
      // model-confirmed pin: skip fallback/higher-priority comparisons
    } else if (!selected) reasons.push('missing_primary_comparison');
    else {
      // A daily new headword must bind the entry's primary everyday sense.
      // When that sense was already attempted or linked, defer the entry
      // instead of replaying it with a leftover minor sense.
      const ranked = alternatives
        .filter((sense) => !sense.blocked_reason && Number.isFinite(Number(sense.sense_order)))
        .sort((left, right) => Number(left.sense_order) - Number(right.sense_order));
      const primary = ranked[0];
      if (
        primary &&
        Number(primary.sense_order) < Number(selected.sense_order) &&
        (primary.attempted_source_sense || primary.linked_product_sense)
      ) {
        reasons.push('primary_sense_attempted_no_daily_fallback');
      } else if (
        alternatives.some(
          (sense) =>
            !sense.blocked_reason &&
            !sense.linked_product_sense &&
            !sense.attempted_source_sense &&
            Number(sense.score) > Number(selected.score)
        )
      ) {
        reasons.push('higher_priority_sense_skipped');
      }
    }
  }
  return [...new Set(reasons)];
}
