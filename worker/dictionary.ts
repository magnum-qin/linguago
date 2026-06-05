import { normalizeExamples, normalizeStringOrText } from "./normalization";
import type {
  DisplayLanguageCode,
  Env,
  LanguageCode,
  LocalizedText,
  WordDetail,
  WordResponse,
  WordSense
} from "./types";

export interface DictionaryAdapter {
  name: string;
  lookup(input: { env: Env; text: string; targetLang: LanguageCode }): Promise<WordResponse | null>;
}

export class LouisSQLiteAdapter implements DictionaryAdapter {
  name = "louis-sqlite";

  async lookup(input: { env: Env; text: string; targetLang: LanguageCode }): Promise<WordResponse | null> {
    if (!input.env.DICTIONARY_API_URL || !input.env.DICTIONARY_API_TOKEN) return null;

    try {
      const url = new URL("/api/dictionary/lookup", input.env.DICTIONARY_API_URL);
      url.searchParams.set("term", input.text);
      const token = input.env.DICTIONARY_API_TOKEN;
      console.log("Fetching URL:", url.toString());
      const response = await fetch(url.toString(), {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`
        },
        signal: AbortSignal.timeout(1800)
      });

      if (!response.ok) {
        console.error("Dictionary API returned not ok:", response.status, await response.text());
        return null;
      }
      const payload = (await response.json()) as { entries?: Array<Record<string, unknown>> };
      const entry = payload.entries?.[0];
      if (!entry) {
        console.log("No entry found for", input.text);
        return null;
      }
      console.log("Dictionary hit for", input.text);
      return dictionaryEntryToResponse(entry, input.text, input.targetLang);
    } catch (err) {
      console.error("Fetch error:", err);
      return null;
    }
  }
}

export class MockJMDictAdapter implements DictionaryAdapter {
  name = "mock-jmdict";

  async lookup(input: { env: Env; text: string; targetLang: LanguageCode }): Promise<WordResponse | null> {
    // Only return mock data if translating 'hello' to Japanese to simulate an external JMDict response
    if (input.text.toLowerCase() === "hello" && input.targetLang === "ja") {
      return {
        detected_source_lang: "en",
        target_lang: "ja",
        original: "hello",
        translation: "こんにちは",
        translations: {
          ja: { text: "こんにちは", phonetic: "kon'nichiwa", audio_text: "こんにちは" },
          zh: { text: "", phonetic: "", audio_text: "" },
          en: { text: "", phonetic: "", audio_text: "" },
          "pt-BR": { text: "", phonetic: "", audio_text: "" }
        },
        provider: "dictionary",
        model: "mock-jmdict",
        cached: true,
        type: "word",
        phonetic: "kon'nichiwa",
        audio_text: "hello",
        examples: [
          {
            sentence: "Hello, how are you today?",
            translations: { ja: "こんにちは、今日の調子はどうですか？", zh: "", en: "", "pt-BR": "" }
          }
        ],
        senses: [
          {
            sense_order: 2,
            part_of_speech: "interjection (from JMDict)",
            gloss_key: "greeting",
            definitions: { ja: "（日中の挨拶）こんにちは。", zh: "", en: "", "pt-BR": "" }
          }
        ],
        word_details: {
          ja: { word: "こんにちは", definition: "日中に出会った人に対してかける挨拶の言葉。" },
          zh: { word: "", definition: "" },
          en: { word: "", definition: "" },
          "pt-BR": { word: "", definition: "" }
        }
      };
    }
    return null;
  }
}

export class CompositeDictionaryManager {
  private adapters: DictionaryAdapter[] = [];

  constructor() {
    this.adapters.push(new LouisSQLiteAdapter());
    this.adapters.push(new MockJMDictAdapter());
  }

  async lookupAll(input: { env: Env; text: string; targetLang: LanguageCode }): Promise<WordResponse | null> {
    if (!isDictionaryLookupCandidate(input.text)) return null;

    const results = await Promise.all(this.adapters.map(adapter => adapter.lookup(input)));
    const validResults = results.filter((res): res is WordResponse => res !== null);

    if (validResults.length === 0) return null;

    // Merge strategy:
    // We use the first result as the "base" response, and append senses/examples from others.
    const base = validResults[0];

    for (let i = 1; i < validResults.length; i++) {
      const additional = validResults[i];
      // Merge examples
      if (additional.examples) {
        base.examples = [...(base.examples || []), ...additional.examples];
      }
      // Merge senses
      if (additional.senses) {
        base.senses = [...(base.senses || []), ...additional.senses];
      }
      // If we want to enrich phonetic or translations, we could do that here too.
    }

    base.model = validResults.map(r => r.model).join(" + ");
    return base;
  }
}

const dictionaryManager = new CompositeDictionaryManager();

export async function lookupDictionaryFirst(input: {
  env: Env;
  text: string;
  targetLang: LanguageCode;
}): Promise<WordResponse | null> {
  return dictionaryManager.lookupAll(input);
}

export async function fetchDictionaryStats(env: Env): Promise<Record<string, unknown>> {
  if (!env.DICTIONARY_API_URL || !env.DICTIONARY_API_TOKEN) {
    throw new Error("dictionary API is not configured");
  }

  const url = new URL("/api/dictionary/stats", env.DICTIONARY_API_URL);
  const response = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${env.DICTIONARY_API_TOKEN}`
    },
    signal: AbortSignal.timeout(5000)
  });

  if (!response.ok) throw new Error(`dictionary stats failed: ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

function dictionaryEntryToResponse(
  entry: Record<string, unknown>,
  original: string,
  targetLang: LanguageCode
): WordResponse {
  const translations = normalizeDictionaryTranslations(entry.translations, entry.pronunciations);
  const senses = normalizeDictionarySenses(entry.senses);
  const firstSense = senses[0] || null;
  const definitions =
    firstSense?.definitions || {};
  const targetText = translations[targetLang]?.text || translations.en?.text || original;

  return {
    detected_source_lang: String(entry.source_lang || "auto"),
    target_lang: targetLang,
    original,
    translation: targetText,
    translations,
    provider: "dictionary",
    model: "louis-sqlite",
    cached: true,
    type: "word",
    phonetic: translations[String(entry.source_lang || "en") as LanguageCode]?.phonetic || "",
    audio_text: original,
    examples: normalizeExamples(entry.examples),
    senses,
    word_details: {
      zh: dictionaryWordDetail(translations.zh?.text, definitions.zh),
      en: dictionaryWordDetail(translations.en?.text, definitions.en),
      "pt-BR": dictionaryWordDetail(translations["pt-BR"]?.text, definitions["pt-BR"]),
      ja: dictionaryWordDetail(translations.ja?.text, definitions.ja)
    }
  };
}

function normalizeDictionarySenses(value: unknown): WordSense[] {
  const items = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
  return items
    .map((sense, index) => {
      const definitions =
        sense.definitions && typeof sense.definitions === "object"
          ? (sense.definitions as Record<string, unknown>)
          : {};
      const senseOrder = Number(sense.sense_order || index + 1);
      return {
        sense_order: Number.isFinite(senseOrder) && senseOrder > 0 ? senseOrder : index + 1,
        part_of_speech: normalizeStringOrText(sense.part_of_speech),
        gloss_key: normalizeStringOrText(sense.gloss_key),
        definitions: {
          zh: normalizeStringOrText(definitions.zh),
          en: normalizeStringOrText(definitions.en),
          "pt-BR": normalizeStringOrText(definitions["pt-BR"]),
          ja: normalizeStringOrText(definitions.ja)
        }
      };
    })
    .filter((sense) => Object.values(sense.definitions).some(Boolean));
}

function normalizeDictionaryTranslations(
  translationsValue: unknown,
  pronunciationsValue: unknown
): Record<DisplayLanguageCode, LocalizedText> {
  const translations =
    translationsValue && typeof translationsValue === "object"
      ? (translationsValue as Record<string, unknown>)
      : {};
  const pronunciations =
    pronunciationsValue && typeof pronunciationsValue === "object"
      ? (pronunciationsValue as Record<string, unknown>)
      : {};

  return {
    zh: dictionaryLocalizedText(translations.zh, pronunciations.zh),
    en: dictionaryLocalizedText(translations.en, pronunciations.en),
    "pt-BR": dictionaryLocalizedText(translations["pt-BR"], pronunciations["pt-BR"]),
    ja: dictionaryLocalizedText(translations.ja, pronunciations.ja)
  };
}

function dictionaryLocalizedText(translation: unknown, pronunciation: unknown): LocalizedText {
  const translationItem =
    translation && typeof translation === "object" ? (translation as Record<string, unknown>) : {};
  const pronunciationItem =
    pronunciation && typeof pronunciation === "object" ? (pronunciation as Record<string, unknown>) : {};
  const text = normalizeStringOrText(translationItem.text);

  return {
    text,
    phonetic: normalizeStringOrText(pronunciationItem.phonetic),
    audio_text: normalizeStringOrText(pronunciationItem.audio_text) || text
  };
}

function dictionaryWordDetail(word: unknown, definition: unknown): WordDetail {
  return {
    word: normalizeStringOrText(word),
    definition: normalizeStringOrText(definition)
  };
}

function isDictionaryLookupCandidate(text: string): boolean {
  if (!text || text.length > 48) return false;
  return !/\s/u.test(text.trim());
}
