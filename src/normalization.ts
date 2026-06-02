import { pinyin } from "pinyin-pro";

import { DEFAULT_MODELS } from "./config";
import type {
  DisplayLanguageCode,
  LanguageCode,
  LocalizedText,
  Provider,
  ResponseProvider,
  SentenceResponse,
  TranslateResponse,
  WordDetail,
  WordExample
} from "./types";

export function normalizeResponse(input: {
  translated: Record<string, unknown>;
  text: string;
  targetLang: LanguageCode;
  provider: ResponseProvider;
  model: string;
}): TranslateResponse {
  const type = input.translated.type === "word" ? "word" : "sentence";
  const translations = normalizeLocalizedTranslations(input.translated.translations);
  const targetTranslation = translations[input.targetLang]?.text;
  const base = {
    detected_source_lang: String(input.translated.detected_source_lang ?? "auto"),
    target_lang: input.targetLang,
    original: input.text,
    translation: String(input.translated.translation ?? targetTranslation ?? ""),
    translations,
    provider: input.provider,
    model: input.model,
    cached: false
  };

  if (type === "word") {
    return {
      ...base,
      type,
      phonetic: buildLocalPhonetic(
        normalizeTargetLang(String(input.translated.detected_source_lang || "")),
        input.text
      ),
      audio_text: input.text,
      examples: normalizeExamples(input.translated.examples),
      word_details: normalizeWordDetails(input.translated.word_details)
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
    normalizeStringOrText(input.translated.translation) ||
    normalizeStringOrText(input.translated.translations);
  const explanation =
    normalizeStringOrText(input.translated.explanation) ||
    normalizeStringOrText(input.translated.explanations);

  return {
    type: "sentence",
    detected_source_lang: String(input.translated.detected_source_lang ?? "auto"),
    target_lang: input.targetLang,
    original: input.text,
    translation,
    translations: {
      zh: emptyLocalizedText(),
      en: emptyLocalizedText(),
      "pt-BR": emptyLocalizedText(),
      ja: emptyLocalizedText(),
      [input.targetLang]: localPronunciationText(input.targetLang, translation)
    },
    explanation,
    explanations: {
      zh: "",
      en: "",
      "pt-BR": "",
      ja: "",
      [input.targetLang]: explanation
    },
    provider: input.provider,
    model: input.model,
    cached: false
  };
}

export function emptyLocalizedText(): LocalizedText {
  return { text: "", phonetic: "", audio_text: "" };
}

function selectTargetExplanation(
  translated: Record<string, unknown>,
  targetLang: LanguageCode
): string {
  const explanations = normalizeSentenceExplanations(translated, targetLang);
  if (explanations[targetLang]) {
    return explanations[targetLang];
  }

  const fallback =
    normalizeStringOrText(translated.explanation) ||
    normalizeStringOrText(translated.sentence_explanation);
  return isUsableExplanation(targetLang, fallback) ? fallback : "";
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
    zh: "",
    en: "",
    "pt-BR": "",
    ja: ""
  };

  for (const source of explanationSources) {
    if (!source || typeof source !== "object") continue;
    const items = source as Record<string, unknown>;
    normalized.zh ||= normalizeStringOrText(items.zh);
    normalized.en ||= normalizeStringOrText(items.en);
    normalized["pt-BR"] ||= normalizeStringOrText(items["pt-BR"]);
    normalized.ja ||= normalizeStringOrText(items.ja);
  }

  const fallback =
    normalizeStringOrText(translated.explanation) ||
    normalizeStringOrText(translated.sentence_explanation);
  if (fallback) {
    normalized[targetLang] ||= fallback;
  }

  return {
    zh: isUsableExplanation("zh", normalized.zh) ? normalized.zh : fallbackExplanation("zh", translated),
    en: isUsableExplanation("en", normalized.en) ? normalized.en : fallbackExplanation("en", translated),
    "pt-BR": isUsableExplanation("pt-BR", normalized["pt-BR"])
      ? normalized["pt-BR"]
      : fallbackExplanation("pt-BR", translated),
    ja: isUsableExplanation("ja", normalized.ja) ? normalized.ja : fallbackExplanation("ja", translated)
  };
}

function isUsableExplanation(lang: LanguageCode, text: string): boolean {
  return isExpectedExplanationLanguage(lang, text) && !isPlaceholderExplanation(text);
}

function isPlaceholderExplanation(text: string): boolean {
  const value = text.trim().toLocaleLowerCase();
  if (!value) return false;
  return [
    "english explanation of meaning",
    "meaning, tone, and usage",
    "real english explanation for this exact sentence",
    "real simplified chinese explanation",
    "real brazilian portuguese explanation",
    "real japanese explanation",
    "a concise explanation in the requested target language",
    "explicação em português do brasil sobre significado",
    "explicacao em portugues do brasil sobre significado",
    "简体中文解释含义",
    "解释含义、语气和用法",
    "不要使用日语假名"
  ].some((placeholder) => value.includes(placeholder));
}

function fallbackExplanation(lang: LanguageCode, translated: Record<string, unknown>): string {
  const translation = normalizeStringOrText(translated.translation);
  if (!translation) return "";

  if (lang === "zh") {
    return `这句话的意思是：${translation}`;
  }
  if (lang === "ja") {
    return `この文の意味は「${translation}」です。`;
  }
  if (lang === "pt-BR") {
    return `A frase significa: ${translation}`;
  }
  return `The sentence means: ${translation}`;
}

function isExpectedExplanationLanguage(lang: LanguageCode, text: string): boolean {
  const value = text.trim();
  if (!value) return true;

  if (lang === "zh") {
    return /[\u4e00-\u9fff]/u.test(value) && !/[\u3040-\u30ff]/u.test(value);
  }

  if (lang === "ja") {
    return /[\u3040-\u30ff]/u.test(value);
  }

  return true;
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function normalizeTargetLang(target?: string): LanguageCode {
  if (target === "en" || target === "zh" || target === "pt-BR" || target === "ja") {
    return target;
  }
  return "zh";
}

export function normalizeProvider(provider?: string): Provider {
  if (
    provider === "openrouter" ||
    provider === "dashscope" ||
    provider === "gemini" ||
    provider === "deepseek"
  ) {
    return provider;
  }
  return "auto";
}

export function normalizeModel(model: unknown, provider: Provider): string {
  const normalized = String(model ?? "").trim();
  return normalized || DEFAULT_MODELS[provider] || DEFAULT_MODELS.auto;
}

export function normalizeExamples(value: unknown): WordExample[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 3).map((item) => {
    const example =
      item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return {
      sentence: String(example.sentence ?? ""),
      translations: normalizeExampleTranslations(example.translations)
    };
  });
}

function normalizeExampleTranslations(value: unknown): Record<LanguageCode, string> {
  const translations =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    zh: normalizeStringOrText(translations.zh),
    en: normalizeStringOrText(translations.en),
    "pt-BR": normalizeStringOrText(translations["pt-BR"]),
    ja: normalizeStringOrText(translations.ja)
  };
}

function normalizeLocalizedTranslations(
  value: unknown
): Record<DisplayLanguageCode, LocalizedText> {
  const translations =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    zh: normalizeLocalizedText(translations.zh, "zh"),
    en: normalizeLocalizedText(translations.en, "en"),
    "pt-BR": normalizeLocalizedText(translations["pt-BR"], "pt-BR"),
    ja: normalizeLocalizedText(translations.ja, "ja")
  };
}

function normalizeLocalizedText(value: unknown, lang: DisplayLanguageCode): LocalizedText {
  if (typeof value === "string") {
    return localPronunciationText(lang, value);
  }

  const item =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const text = normalizeStringOrText(item.text);

  return localPronunciationText(lang, text);
}

export function localPronunciationText(lang: DisplayLanguageCode, text: string): LocalizedText {
  const normalized = normalizeText(text);
  return {
    text: normalized,
    phonetic: buildLocalPhonetic(lang, normalized),
    audio_text: normalized
  };
}

function buildLocalPhonetic(lang: DisplayLanguageCode, text: string): string {
  if (!text) return "";
  if (lang !== "zh" || !/[\u4e00-\u9fff]/u.test(text)) {
    return "";
  }

  try {
    return pinyin(text, {
      toneType: "symbol",
      nonZh: "consecutive"
    });
  } catch {
    return "";
  }
}

function normalizeWordDetails(value: unknown): Record<DisplayLanguageCode, WordDetail> {
  const details =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    zh: normalizeWordDetail(details.zh, "zh"),
    en: normalizeWordDetail(details.en, "en"),
    "pt-BR": normalizeWordDetail(details["pt-BR"], "pt-BR"),
    ja: normalizeWordDetail(details.ja, "ja")
  };
}

function normalizeWordDetail(value: unknown, lang: DisplayLanguageCode): WordDetail {
  const detail =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const word = normalizeStringOrText(detail.word);

  return {
    word,
    definition: cleanWordDefinition(lang, word, normalizeStringOrText(detail.definition))
  };
}

function cleanWordDefinition(
  lang: DisplayLanguageCode,
  word: string,
  definition: string
): string {
  let value = normalizeText(definition)
    .replace(/^[-*•]\s*/u, "")
    .replace(/\s+[-–—]\s*$/u, "")
    .trim();

  if (!value) return "";

  const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (escapedWord) {
    value = value
      .replace(new RegExp(`^${escapedWord}\\s*(?:\\([^)]*\\))?\\s*[-–—:：]\\s*`, "iu"), "")
      .replace(new RegExp(`^${escapedWord}\\s*(?:\\([^)]*\\))?\\s*`, "iu"), "");
  }

  const crossLanguageMarkers: Record<DisplayLanguageCode, RegExp> = {
    zh: /(?:在(?:中文|英语|英文|日语|葡萄牙语)|对应|英语中|日语中|葡语中|Portuguese|English|Japanese|ダイエット|lose weight|perder peso)/iu,
    en: /(?:in Chinese|in Japanese|in Portuguese|corresponds to|equivalent to|中文|日语|葡萄牙语)/iu,
    "pt-BR": /(?:em chin[eê]s|em japon[eê]s|em ingl[eê]s|equivale a|corresponde a|中文|日语|英语)/iu,
    ja: /(?:中国語では|英語では|ポルトガル語では|対応|equivalent|中文|英语|葡萄牙语)/iu
  };
  const marker = value.search(crossLanguageMarkers[lang]);
  if (marker > 0) {
    value = value.slice(0, marker).trim();
  }

  value = value.replace(/\s+[-–—]\s*$/u, "").trim();
  const sentenceLimit = lang === "zh" || lang === "ja" ? 2 : 1;
  return limitSentences(value, sentenceLimit) || value;
}

function limitSentences(text: string, maxSentences: number): string {
  const matches = text.match(/[^。.!！？!?]+[。.!！？!?]?/gu) || [];
  return matches.slice(0, maxSentences).join("").trim();
}

export function normalizeStringOrText(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    return String(item.text ?? item.translation ?? "");
  }
  return String(value);
}
