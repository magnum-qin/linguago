import { localPronunciationText, normalizeStringOrText } from "./normalization";
import { parseProviderJson } from "./provider-json";
import { streamProviderJson } from "./provider-clients";
import { buildUserPrompt, selectProviderSystemPrompt } from "./prompts";
import { TranslateError } from "./errors";
import type { LanguageCode, LocalizedText, Provider, ResponseProvider, SentenceResponse, TranslateRequest } from "./types";

interface StreamTranslationInput {
  text: string;
  sourceLang: TranslateRequest["source_lang"];
  targetLang: LanguageCode;
  provider: Exclude<Provider, "auto">;
  model: string;
  apiKey: string;
}

type StreamFallback = (input: StreamTranslationInput) => Promise<Record<string, unknown>>;

export async function streamStructuredTranslation(
  input: StreamTranslationInput,
  onPartial: (partial: SentenceResponse) => void,
  fallback: StreamFallback
): Promise<Record<string, unknown>> {
  const request = {
    prompt: buildUserPrompt(input.text, input.sourceLang, input.targetLang),
    model: input.model,
    apiKey: input.apiKey,
    systemPrompt: selectProviderSystemPrompt(input.provider)
  };
  let emittedPartial = false;
  let lastPartialKey = "";

  try {
    const rawText = await streamProviderJson(input.provider, request, (accumulated) => {
      const partial = buildPartialStructuredResponse({
        rawText: accumulated,
        text: input.text,
        targetLang: input.targetLang,
        provider: input.provider,
        model: input.model
      });
      if (!partial) return;

      const partialKey = JSON.stringify({
        translation: partial.translation,
        translations: partial.translations,
        explanation: partial.explanation,
        explanations: partial.explanations
      });
      if (partialKey === lastPartialKey) return;

      lastPartialKey = partialKey;
      emittedPartial = true;
      onPartial(partial);
    });

    return parseProviderJson(rawText, input.provider, input.model, false);
  } catch (error) {
    if (emittedPartial && !(error instanceof TranslateError && error.code === "PROVIDER_INVALID_JSON")) {
      throw error;
    }
    return fallback(input);
  }
}

function buildPartialStructuredResponse(input: {
  rawText: string;
  text: string;
  targetLang: LanguageCode;
  provider: ResponseProvider;
  model: string;
}): SentenceResponse | null {
  const translation = readJsonStringField(input.rawText, "translation");
  const translations = {
    zh: partialLocalizedText(input.rawText, "translations", "zh"),
    en: partialLocalizedText(input.rawText, "translations", "en"),
    "pt-BR": partialLocalizedText(input.rawText, "translations", "pt-BR"),
    ja: partialLocalizedText(input.rawText, "translations", "ja")
  };
  if (translation && !translations[input.targetLang].text) {
    translations[input.targetLang] = localPronunciationText(input.targetLang, translation);
  }

  const explanation = readJsonStringField(input.rawText, "explanation");
  const explanations = {
    zh: readSectionLanguageString(input.rawText, "explanations", "zh"),
    en: readSectionLanguageString(input.rawText, "explanations", "en"),
    "pt-BR": readSectionLanguageString(input.rawText, "explanations", "pt-BR"),
    ja: readSectionLanguageString(input.rawText, "explanations", "ja")
  };
  if (explanation && !explanations[input.targetLang]) {
    explanations[input.targetLang] = explanation;
  }

  const hasAnyTranslation =
    Boolean(translation) || Object.values(translations).some((item) => Boolean(item.text));
  const hasAnyExplanation = Boolean(explanation) || Object.values(explanations).some(Boolean);
  if (!hasAnyTranslation && !hasAnyExplanation) {
    return null;
  }

  const targetTranslation = translations[input.targetLang].text || translation;
  return {
    type: "sentence",
    detected_source_lang: readJsonStringField(input.rawText, "detected_source_lang") || "auto",
    target_lang: input.targetLang,
    original: input.text,
    translation: targetTranslation,
    translations,
    explanation: explanations[input.targetLang] || explanation,
    explanations,
    provider: input.provider,
    model: input.model,
    cached: false
  };
}

function partialLocalizedText(rawText: string, section: string, lang: LanguageCode): LocalizedText {
  const text = readSectionLanguageObjectString(rawText, section, lang, "text");
  return {
    text,
    phonetic: readSectionLanguageObjectString(rawText, section, lang, "phonetic"),
    audio_text: readSectionLanguageObjectString(rawText, section, lang, "audio_text") || text
  };
}

function readSectionLanguageObjectString(
  rawText: string,
  section: string,
  lang: LanguageCode,
  field: string
): string {
  const sectionText = sliceAfterJsonKey(rawText, section);
  if (!sectionText) return "";
  const pattern = new RegExp(
    `"${escapeRegex(lang)}"\\s*:\\s*\\{[\\s\\S]*?"${escapeRegex(field)}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`,
    "u"
  );
  return decodeJsonStringMatch(sectionText.match(pattern)?.[1]);
}

function readSectionLanguageString(rawText: string, section: string, lang: LanguageCode): string {
  const sectionText = sliceAfterJsonKey(rawText, section);
  if (!sectionText) return "";
  const pattern = new RegExp(`"${escapeRegex(lang)}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "u");
  return decodeJsonStringMatch(sectionText.match(pattern)?.[1]);
}

function readJsonStringField(rawText: string, field: string): string {
  const pattern = new RegExp(`"${escapeRegex(field)}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "u");
  return decodeJsonStringMatch(rawText.match(pattern)?.[1]);
}

function sliceAfterJsonKey(rawText: string, key: string): string {
  const index = rawText.indexOf(`"${key}"`);
  return index >= 0 ? rawText.slice(index) : "";
}

function decodeJsonStringMatch(value?: string): string {
  if (!value) return "";
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
