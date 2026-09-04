import { pinyin } from 'pinyin-pro';

import { DEFAULT_MODELS } from './config';
import type {
  DisplayLanguageCode,
  LanguageCode,
  LocalizedText,
  Provider,
  ResponseProvider,
  SentenceResponse,
  TranslateResponse,
  WordDetail,
  WordExample,
  WordSense
} from './types';

export function normalizeResponse(input: {
  translated: Record<string, unknown>;
  text: string;
  targetLang: LanguageCode;
  provider: ResponseProvider;
  model: string;
}): TranslateResponse {
  const type = input.translated.type
    ? input.translated.type === 'word'
      ? 'word'
      : 'sentence'
    : isLikelyLexicalInput(input.text)
      ? 'word'
      : 'sentence';
  const translations = normalizeLocalizedTranslations(input.translated.translations);
  const targetTranslation = translations[input.targetLang]?.text;
  const base = {
    detected_source_lang: String(input.translated.detected_source_lang ?? 'auto'),
    target_lang: input.targetLang,
    original: input.text,
    translation: String(input.translated.translation ?? targetTranslation ?? ''),
    translations,
    provider: input.provider,
    model: input.model,
    cached: false
  };

  if (type === 'word') {
    const wordDetails = normalizeWordDetails(input.translated.word_details, translations, input.translated);
    const senses = normalizeWordSenses(input.translated.senses, translations, wordDetails);
    return {
      ...base,
      type,
      phonetic: '',
      audio_text: input.text,
      examples: normalizeExamples(input.translated.examples),
      word_details: wordDetails,
      senses
    };
  }

  return {
    ...base,
    type,
    explanation: selectTargetExplanation(input.translated, input.targetLang),
    explanations: normalizeSentenceExplanations(input.translated, input.targetLang)
  };
}

export function normalizePreviewResponse(input: {
  translated: Record<string, unknown>;
  text: string;
  targetLang: LanguageCode;
  provider: ResponseProvider;
  model: string;
}): SentenceResponse {
  const translation =
    normalizeStringOrText(input.translated.translation) || normalizeStringOrText(input.translated.translations);
  const explanation =
    normalizeStringOrText(input.translated.explanation) || normalizeStringOrText(input.translated.explanations);

  return {
    type: 'sentence',
    detected_source_lang: String(input.translated.detected_source_lang ?? 'auto'),
    target_lang: input.targetLang,
    original: input.text,
    translation,
    translations: {
      zh: emptyLocalizedText(),
      en: emptyLocalizedText(),
      'pt-BR': emptyLocalizedText(),
      ja: emptyLocalizedText(),
      [input.targetLang]: localPronunciationText(input.targetLang, translation)
    },
    explanation,
    explanations: {
      zh: '',
      en: '',
      'pt-BR': '',
      ja: '',
      [input.targetLang]: explanation
    },
    provider: input.provider,
    model: input.model,
    cached: false
  };
}

export function emptyLocalizedText(): LocalizedText {
  return { text: '', phonetic: '', audio_text: '' };
}

function selectTargetExplanation(translated: Record<string, unknown>, targetLang: LanguageCode): string {
  const explanations = normalizeSentenceExplanations(translated, targetLang);
  if (explanations[targetLang]) {
    return explanations[targetLang];
  }

  const fallback =
    normalizeStringOrText(translated.explanation) || normalizeStringOrText(translated.sentence_explanation);
  return isUsableExplanation(targetLang, fallback) ? fallback : '';
}

function normalizeSentenceExplanations(
  translated: Record<string, unknown>,
  targetLang: LanguageCode
): Record<DisplayLanguageCode, string> {
  const explanationSources = [
    translated.explanations,
    translated.sentence_explanations,
    translated.localized_explanations
  ];
  const normalized = {
    zh: '',
    en: '',
    'pt-BR': '',
    ja: ''
  };

  for (const source of explanationSources) {
    if (!source || typeof source !== 'object') continue;
    const items = source as Record<string, unknown>;
    normalized.zh ||= normalizeStringOrText(items.zh);
    normalized.en ||= normalizeStringOrText(items.en);
    normalized['pt-BR'] ||= normalizeStringOrText(items['pt-BR']);
    normalized.ja ||= normalizeStringOrText(items.ja);
  }

  // Also support models nesting context_note / explanation under language blocks
  for (const lang of ['zh', 'en', 'pt-BR', 'ja'] as const) {
    if (translated[lang] && typeof translated[lang] === 'object') {
      const block = translated[lang] as Record<string, unknown>;
      normalized[lang] ||= normalizeStringOrText(block.explanation || block.context_note || block.note);
    }
    if (translated.translations && typeof translated.translations === 'object') {
      const transBlock = (translated.translations as Record<string, unknown>)[lang];
      if (transBlock && typeof transBlock === 'object') {
        const item = transBlock as Record<string, unknown>;
        normalized[lang] ||= normalizeStringOrText(item.explanation || item.context_note || item.note);
      }
    }
  }

  const fallback =
    normalizeStringOrText(translated.explanation) || normalizeStringOrText(translated.sentence_explanation);
  if (fallback && isUsableExplanation(targetLang, fallback)) {
    normalized[targetLang] ||= fallback;
  }

  return {
    zh: isUsableExplanation('zh', normalized.zh) ? normalized.zh : fallbackExplanation('zh', translated),
    en: isUsableExplanation('en', normalized.en) ? normalized.en : fallbackExplanation('en', translated),
    'pt-BR': isUsableExplanation('pt-BR', normalized['pt-BR'])
      ? normalized['pt-BR']
      : fallbackExplanation('pt-BR', translated),
    ja: isUsableExplanation('ja', normalized.ja) ? normalized.ja : fallbackExplanation('ja', translated)
  };
}

function isUsableExplanation(lang: LanguageCode, text: string): boolean {
  return isExpectedExplanationLanguage(lang, text) && !isPlaceholderExplanation(text);
}

function isPlaceholderExplanation(text: string): boolean {
  const value = text.trim().toLocaleLowerCase();
  if (!value) return false;
  return [
    'english explanation of meaning',
    'meaning, tone, and usage',
    'real english explanation for this exact sentence',
    'real simplified chinese explanation',
    'real brazilian portuguese explanation',
    'real japanese explanation',
    'a concise explanation in the requested target language',
    'explicação em português do brasil sobre significado',
    'explicacao em portugues do brasil sobre significado',
    '简体中文解释含义',
    '解释含义、语气和用法',
    '不要使用日语假名'
  ].some((placeholder) => value.includes(placeholder));
}

function fallbackExplanation(lang: LanguageCode, translated: Record<string, unknown>): string {
  const translations =
    translated.translations && typeof translated.translations === 'object'
      ? (translated.translations as Record<string, unknown>)
      : {};
  const langText =
    normalizeStringOrText(translations[lang]) ||
    (lang === translated.target_lang ? normalizeStringOrText(translated.translation) : '');
  if (!langText) return '';

  if (lang === 'zh') {
    return `这句话的意思是：${langText}`;
  }
  if (lang === 'ja') {
    return `この文の意味は「${langText}」です。`;
  }
  if (lang === 'pt-BR') {
    return `A frase significa: ${langText}`;
  }
  return `The sentence means: ${langText}`;
}

function isExpectedExplanationLanguage(lang: LanguageCode, text: string): boolean {
  const value = text.trim();
  if (!value) return true;

  if (lang === 'zh') {
    return /[\u4e00-\u9fff]/u.test(value) && !/[\u3040-\u30ff]/u.test(value);
  }

  if (lang === 'ja') {
    return /[\u3040-\u30ff]/u.test(value);
  }

  if (lang === 'en' || lang === 'pt-BR') {
    // English and Portuguese explanations MUST contain Latin characters and MUST NOT contain Chinese characters
    return /[a-zA-Z]/u.test(value) && !/[\u4e00-\u9fff]/u.test(value);
  }

  return true;
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function isLikelyLexicalInput(text: string): boolean {
  const value = normalizeText(text);
  if (!value) return false;
  if (/[。！？!?;；:：,，、\n\r]/u.test(value)) return false;

  const words = value.split(/\s+/u).filter(Boolean);
  if (words.length > 2) return false;

  const cjkChars = value.match(/[\u3400-\u9fff]/gu)?.length || 0;
  if (cjkChars > 0) {
    return cjkChars <= 4 && value.length <= 8;
  }

  return value.length <= 30;
}

export function normalizeTargetLang(target?: string): LanguageCode {
  if (target === 'en' || target === 'zh' || target === 'pt-BR' || target === 'ja') {
    return target;
  }
  return 'zh';
}

export function normalizeProvider(provider?: string): Provider {
  if (provider === 'cloudflare' || provider === 'dashscope' || provider === 'gemini' || provider === 'deepseek') {
    return provider;
  }
  return 'auto';
}

export function normalizeModel(model: unknown, provider: Provider): string {
  const normalized = String(model ?? '').trim();
  return normalized || DEFAULT_MODELS[provider] || DEFAULT_MODELS.auto;
}

export function normalizeExamples(value: unknown): WordExample[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 3).map((item) => {
    const example = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    return {
      sentence: String(example.sentence ?? ''),
      translations: normalizeExampleTranslations(example.translations),
      localizations: normalizeExampleLocalizations(example.translations)
    };
  });
}

function normalizeExampleTranslations(value: unknown): Record<LanguageCode, string> {
  const translations = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

  return {
    zh: normalizeStringOrText(translations.zh),
    en: normalizeStringOrText(translations.en),
    'pt-BR': normalizeStringOrText(translations['pt-BR']),
    ja: normalizeStringOrText(translations.ja)
  };
}

function normalizeLocalizedTranslations(value: unknown): Record<DisplayLanguageCode, LocalizedText> {
  const translations = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

  return {
    zh: normalizeLocalizedText(translations.zh, 'zh'),
    en: normalizeLocalizedText(translations.en, 'en'),
    'pt-BR': normalizeLocalizedText(translations['pt-BR'], 'pt-BR'),
    ja: normalizeLocalizedText(translations.ja, 'ja')
  };
}

function normalizeLocalizedText(value: unknown, lang: DisplayLanguageCode): LocalizedText {
  if (typeof value === 'string') {
    return localPronunciationText(lang, value);
  }

  const item = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const text = normalizeStringOrText(item.text);
  const generated = localPronunciationText(lang, text);
  const phonetic =
    normalizeStringOrText(item.phonetic) ||
    normalizeStringOrText(item.pronunciation) ||
    normalizeStringOrText(item.reading);
  const audioText = normalizeStringOrText(item.audio_text);

  return {
    text: generated.text,
    phonetic: phonetic || generated.phonetic,
    audio_text: audioText || generated.audio_text
  };
}

function normalizeWordSenses(
  value: unknown,
  translations: Record<DisplayLanguageCode, LocalizedText>,
  wordDetails: Record<DisplayLanguageCode, WordDetail>
): WordSense[] {
  const items = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
  const senses = items
    .slice(0, 8)
    .map((sense, index) => {
      const definitionsValue =
        sense.definitions && typeof sense.definitions === 'object'
          ? (sense.definitions as Record<string, unknown>)
          : {};
      const senseOrder = Number(sense.sense_order || index + 1);
      const definitions = {
        zh: cleanWordDefinition('zh', translations.zh.text, normalizeStringOrText(definitionsValue.zh)),
        en: cleanWordDefinition('en', translations.en.text, normalizeStringOrText(definitionsValue.en)),
        'pt-BR': cleanWordDefinition(
          'pt-BR',
          translations['pt-BR'].text,
          normalizeStringOrText(definitionsValue['pt-BR'])
        ),
        ja: cleanWordDefinition('ja', translations.ja.text, normalizeStringOrText(definitionsValue.ja))
      };

      return {
        sense_order: Number.isFinite(senseOrder) && senseOrder > 0 ? senseOrder : index + 1,
        part_of_speech: normalizeStringOrText(sense.part_of_speech),
        gloss_key: normalizeStringOrText(sense.gloss_key) || definitions.en || translations.en.text,
        definitions,
        localizations: senseLocalizationsFromDefinitions(translations, definitions)
      };
    })
    .filter((sense) => Object.values(sense.definitions).some(Boolean));

  if (senses.length > 0) return senses;

  const fallbackDefinitions = {
    zh: wordDetails.zh.definition,
    en: wordDetails.en.definition,
    'pt-BR': wordDetails['pt-BR'].definition,
    ja: wordDetails.ja.definition
  };

  return [
    {
      sense_order: 1,
      part_of_speech: '',
      gloss_key: fallbackDefinitions.en || translations.en.text,
      definitions: fallbackDefinitions,
      localizations: senseLocalizationsFromDefinitions(translations, fallbackDefinitions)
    }
  ].filter((sense) => Object.values(sense.definitions).some(Boolean));
}

function senseLocalizationsFromDefinitions(
  translations: Record<DisplayLanguageCode, LocalizedText>,
  definitions: Record<DisplayLanguageCode, string>
): NonNullable<WordSense['localizations']> {
  return {
    zh: {
      term: translations.zh.text,
      reading: '',
      reading_system: '',
      pronunciation: translations.zh.phonetic,
      pronunciation_system: '',
      definition: definitions.zh,
      usage_note: ''
    },
    en: {
      term: translations.en.text,
      reading: '',
      reading_system: '',
      pronunciation: translations.en.phonetic,
      pronunciation_system: '',
      definition: definitions.en,
      usage_note: ''
    },
    'pt-BR': {
      term: translations['pt-BR'].text,
      reading: '',
      reading_system: '',
      pronunciation: translations['pt-BR'].phonetic,
      pronunciation_system: '',
      definition: definitions['pt-BR'],
      usage_note: ''
    },
    ja: {
      term: translations.ja.text,
      reading: '',
      reading_system: '',
      pronunciation: translations.ja.phonetic,
      pronunciation_system: '',
      definition: definitions.ja,
      usage_note: ''
    }
  };
}

function normalizeExampleLocalizations(value: unknown): NonNullable<WordExample['localizations']> {
  const translations = normalizeExampleTranslations(value);
  return {
    zh: { text: translations.zh, reading: '' },
    en: { text: translations.en, reading: '' },
    'pt-BR': { text: translations['pt-BR'], reading: '' },
    ja: { text: translations.ja, reading: '' }
  };
}

export function stripPronunciationBrackets(text: string): string {
  return text.replace(/\{([^|{}]+)\|([^|{}]+)\}/g, '$1');
}

export function localPronunciationText(lang: DisplayLanguageCode, text: string): LocalizedText {
  const normalized = normalizeText(text);
  const cleanText = lang === 'ja' || lang === 'en' ? stripPronunciationBrackets(normalized) : normalized;

  if (lang === 'zh' && /[\u4e00-\u9fff]/u.test(cleanText)) {
    return {
      text: applyInlinePinyin(cleanText),
      phonetic: '', // Clear badge, since we are using inline pinyin
      audio_text: cleanText
    };
  }

  return {
    text: normalized,
    phonetic: '',
    audio_text: cleanText
  };
}

function applyInlinePinyin(text: string): string {
  if (!text) return '';
  try {
    const pinyins = pinyin(text, {
      type: 'array',
      toneType: 'symbol',
      nonZh: 'removed'
    });

    let result = '';
    let pinyinIdx = 0;
    for (const char of text) {
      if (/[\u4e00-\u9fff]/.test(char)) {
        const py = pinyins[pinyinIdx];
        result += py ? `{${char}|${py}}` : char;
        pinyinIdx++;
      } else {
        result += char;
      }
    }
    return result;
  } catch {
    return text;
  }
}

function normalizeWordDetails(
  value: unknown,
  translations: Record<DisplayLanguageCode, LocalizedText>,
  translated: Record<string, unknown>
): Record<DisplayLanguageCode, WordDetail> {
  const details = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

  return {
    zh: normalizeWordDetail(details.zh, 'zh', translations.zh.text, translated),
    en: normalizeWordDetail(details.en, 'en', translations.en.text, translated),
    'pt-BR': normalizeWordDetail(details['pt-BR'], 'pt-BR', translations['pt-BR'].text, translated),
    ja: normalizeWordDetail(details.ja, 'ja', translations.ja.text, translated)
  };
}

function normalizeWordDetail(
  value: unknown,
  lang: DisplayLanguageCode,
  fallbackWord: string,
  translated: Record<string, unknown>
): WordDetail {
  const detail = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const word = normalizeStringOrText(detail.word) || fallbackWord;
  const fallbackDefinition = wordDefinitionFallback(lang, translated);

  return {
    word,
    definition: cleanWordDefinition(lang, word, normalizeStringOrText(detail.definition) || fallbackDefinition)
  };
}

function wordDefinitionFallback(lang: DisplayLanguageCode, translated: Record<string, unknown>): string {
  const explanations = normalizeSentenceExplanations(translated, lang);
  return explanations[lang] || normalizeStringOrText(translated.explanation);
}

function cleanWordDefinition(lang: DisplayLanguageCode, word: string, definition: string): string {
  let value = normalizeText(definition)
    .replace(/^[-*•]\s*/u, '')
    .replace(/\s+[-–—]\s*$/u, '')
    .trim();

  if (!value) return '';

  const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (escapedWord) {
    value = value
      .replace(new RegExp(`^${escapedWord}\\s*(?:\\([^)]*\\))?\\s*[-–—:：]\\s*`, 'iu'), '')
      .replace(new RegExp(`^${escapedWord}\\s*(?:\\([^)]*\\))?\\s*`, 'iu'), '');
  }

  const crossLanguageMarkers: Record<DisplayLanguageCode, RegExp> = {
    zh: /(?:在(?:中文|英语|英文|日语|葡萄牙语)|对应|英语中|日语中|葡语中|Portuguese|English|Japanese|ダイエット|lose weight|perder peso)/iu,
    en: /(?:in Chinese|in Japanese|in Portuguese|corresponds to|equivalent to|中文|日语|葡萄牙语)/iu,
    'pt-BR': /(?:em chin[eê]s|em japon[eê]s|em ingl[eê]s|equivale a|corresponde a|中文|日语|英语)/iu,
    ja: /(?:中国語では|英語では|ポルトガル語では|対応|equivalent|中文|英语|葡萄牙语)/iu
  };
  const marker = value.search(crossLanguageMarkers[lang]);
  if (marker > 0) {
    value = value.slice(0, marker).trim();
  }

  value = value.replace(/\s+[-–—]\s*$/u, '').trim();
  const sentenceLimit = lang === 'zh' || lang === 'ja' ? 2 : 1;
  return limitSentences(value, sentenceLimit) || value;
}

function limitSentences(text: string, maxSentences: number): string {
  const matches = text.match(/[^。.!！？!?]+[。.!！？!?]?/gu) || [];
  return matches.slice(0, maxSentences).join('').trim();
}

export function normalizeStringOrText(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'object') {
    const item = value as Record<string, unknown>;
    return String(item.text ?? item.translation ?? '');
  }
  return String(value);
}
