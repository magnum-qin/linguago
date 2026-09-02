import { computed } from 'vue';
import type {
  TranslateResponse,
  WordResponse,
  WordSense,
  WordExample,
  WordDetail
} from '../types/translation';
import {
  stripInlineAnnotations,
  normalizeComparableText,
  splitHighlightTerms
} from './useWordHighlights';

export function useDictionaryEntry(
  resultSource: () => TranslateResponse | string | null,
  activeLangSource: () => string
) {
  const wordResult = computed<WordResponse | null>(() => {
    const data = resultSource();
    if (data && typeof data === 'object' && data.type === 'word') {
      return data as WordResponse;
    }
    return null;
  });

  const sourceLanguageCode = computed(() => {
    return wordResult.value?.detected_source_lang || 'en';
  });

  const currentWord = computed(() => {
    const raw = resultSource();
    const activeLang = activeLangSource();
    if (currentWordDetail.value?.word) return currentWordDetail.value.word;
    if (typeof raw === 'string') return raw;
    if (wordResult.value?.translations?.[activeLang]?.text) {
      return wordResult.value.translations[activeLang]!.text;
    }
    return '';
  });

  const currentWordDetail = computed<WordDetail | null>(() => {
    const activeLang = activeLangSource();
    return wordResult.value?.word_details?.[activeLang] || null;
  });

  const currentSenses = computed<WordSense[]>(() => {
    if (!wordResult.value) return [];
    const activeLang = activeLangSource();
    const groupedSenses = Array.isArray(wordResult.value.pronunciation_groups)
      ? wordResult.value.pronunciation_groups.flatMap((group) => (Array.isArray(group.senses) ? group.senses : []))
      : [];
    const source = groupedSenses.length > 0 ? groupedSenses : wordResult.value.senses || [];
    return source.filter((s: WordSense) => senseDefinition(s, activeLang));
  });

  const currentSenseGroups = computed(() => {
    const groups: Array<{ key: string; label: string; system: string; senses: WordSense[] }> = [];
    const index = new Map<string, { key: string; label: string; system: string; senses: WordSense[] }>();
    const sourceLang = wordResult.value?.detected_source_lang || '';
    const activeLang = activeLangSource();

    if (wordResult.value && Array.isArray(wordResult.value.pronunciation_groups)) {
      let groupedSenseCount = 0;
      for (const group of wordResult.value.pronunciation_groups) {
        const senses = Array.isArray(group.senses)
          ? group.senses.filter((sense: WordSense) => senseDefinition(sense, activeLang))
          : [];
        if (senses.length === 0) continue;
        if (group.lang !== sourceLang || !group.reading) continue;
        groupedSenseCount += senses.length;
        groups.push({
          key: group.reading_key || group.reading || `group-${groups.length + 1}`,
          label: group.reading || '',
          system: group.reading_system || '',
          senses
        });
      }
      if (groups.length > 0 && groupedSenseCount === currentSenses.value.length) return groups;
      groups.length = 0;
    }

    for (const sense of currentSenses.value) {
      const reading = senseReading(sense, activeLang);
      const key = reading.key || '__ungrouped';
      let group = index.get(key);
      if (!group) {
        group = { key, label: reading.label, system: reading.system, senses: [] };
        index.set(key, group);
        groups.push(group);
      }
      group.senses.push(sense);
    }

    return groups;
  });

  const hasDictionarySenses = computed(() => {
    return wordResult.value?.provider === 'dictionary' && currentSenses.value.length > 0;
  });

  const showSenseGroups = computed(() => {
    return currentSenseGroups.value.some((group) => group.label) && currentSenseGroups.value.length > 1;
  });

  const currentExamples = computed<WordExample[]>(() => {
    if (!wordResult.value || !wordResult.value.examples) return [];
    const activeLang = activeLangSource();
    return wordResult.value.examples.filter((e: WordExample) => exampleTranslation(e, activeLang));
  });

  const hasSenseScopedExamples = computed(() => {
    return currentSenses.value.some((sense: WordSense) => senseExamples(sense).length > 0);
  });

  const senseDefinition = (sense: WordSense, lang?: string): string => {
    const targetLang = lang || activeLangSource();
    return sense?.localizations?.[targetLang]?.definition || sense?.definitions?.[targetLang] || '';
  };

  const senseTerm = (sense: WordSense, lang?: string): string => {
    const targetLang = lang || activeLangSource();
    return sense?.localizations?.[targetLang]?.term || '';
  };

  const shouldShowSenseTerm = (sense: WordSense): boolean => {
    const activeLang = activeLangSource();
    const term = senseTerm(sense, activeLang);
    if (!term) return false;
    const current = currentWord.value;
    if (!current) return true;
    const normTerm = stripInlineAnnotations(term).trim().toLowerCase();
    const normCurrent = stripInlineAnnotations(current).trim().toLowerCase();
    return normTerm !== normCurrent;
  };

  const senseReading = (sense: WordSense, lang?: string) => {
    const targetLang = lang || activeLangSource();
    const localization = sense?.localizations?.[targetLang];
    const group = sense?.pronunciation_group;
    const label =
      localization?.reading ||
      localization?.pronunciation ||
      (group && group.lang === targetLang ? group.reading : '') ||
      '';
    const key = (group && group.lang === targetLang ? group.reading_key : '') || label.toLocaleLowerCase();
    const system =
      localization?.reading_system ||
      localization?.pronunciation_system ||
      (group && group.lang === targetLang ? group.reading_system : '') ||
      '';
    return { label, key, system };
  };

  const sensePronunciation = (sense: WordSense, lang?: string) => {
    const targetLang = lang || activeLangSource();
    const localization = sense?.localizations?.[targetLang];
    const label = localization?.pronunciation || localization?.reading || '';
    const system = localization?.pronunciation_system || localization?.reading_system || '';
    return { label, system };
  };

  const senseKey = (sense: WordSense): string => {
    return `${sense?.sense_order || ''}:${sense?.gloss_key || ''}`;
  };

  const formatSenseCopyText = (sense: WordSense): string => {
    const activeLang = activeLangSource();
    const term = senseTerm(sense, activeLang);
    const definition = senseDefinition(sense, activeLang);
    return term ? `${term}: ${definition}` : definition;
  };

  const formatExampleCopyText = (example: WordExample): string => {
    const activeLang = activeLangSource();
    const sentence = stripInlineAnnotations(example?.sentence || '');
    const translation = shouldShowExampleTranslation(example, activeLang)
      ? stripInlineAnnotations(exampleTranslation(example, activeLang))
      : '';
    return translation ? `${sentence}\n${translation}` : sentence;
  };

  const senseExamples = (sense: WordSense): WordExample[] => {
    const activeLang = activeLangSource();
    return Array.isArray(sense?.examples)
      ? sense.examples.filter((example: WordExample) => exampleTranslation(example, activeLang))
      : [];
  };

  const exampleTranslation = (example: WordExample, lang?: string): string => {
    const targetLang = lang || activeLangSource();
    return example?.localizations?.[targetLang]?.text || example?.translations?.[targetLang] || '';
  };

  const shouldShowExampleTranslation = (example: WordExample, lang?: string): boolean => {
    const targetLang = lang || activeLangSource();
    const translation = exampleTranslation(example, targetLang);
    if (!translation) return false;
    return normalizeComparableText(example?.sentence) !== normalizeComparableText(translation);
  };

  const currentExampleHighlightTerms = computed(() => {
    const activeLang = activeLangSource();
    const currentTranslationText = wordResult.value?.translations?.[activeLang]?.text;
    return splitHighlightTerms(currentWord.value, currentTranslationText);
  });

  const senseExampleHighlightTerms = (sense: WordSense): string[] => {
    const activeLang = activeLangSource();
    const sourceLang = wordResult.value?.detected_source_lang || '';
    const currentTranslationText = wordResult.value?.translations?.[activeLang]?.text;
    return splitHighlightTerms(
      currentWord.value,
      currentTranslationText,
      senseTerm(sense, activeLang),
      sourceLang ? senseTerm(sense, sourceLang) : ''
    );
  };

  return {
    wordResult,
    sourceLanguageCode,
    currentWord,
    currentWordDetail,
    currentSenses,
    currentSenseGroups,
    hasDictionarySenses,
    showSenseGroups,
    currentExamples,
    hasSenseScopedExamples,
    currentExampleHighlightTerms,
    senseDefinition,
    senseTerm,
    shouldShowSenseTerm,
    senseReading,
    sensePronunciation,
    senseKey,
    formatSenseCopyText,
    formatExampleCopyText,
    senseExamples,
    exampleTranslation,
    shouldShowExampleTranslation,
    senseExampleHighlightTerms
  };
}
