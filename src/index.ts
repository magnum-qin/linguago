interface Env {
  ASSETS: Fetcher;
  CACHE: KVNamespace;
  OPENROUTER_API_KEY?: string;
  DASHSCOPE_API_KEY?: string;
  GEMINI_API_KEY?: string;
  DICTIONARY_API_URL?: string;
  DICTIONARY_API_TOKEN?: string;
}

type LanguageCode = "en" | "zh" | "pt-BR" | "ja";
type DisplayLanguageCode = LanguageCode;
type Provider = "auto" | "openrouter" | "dashscope" | "gemini";
type ResponseProvider = Exclude<Provider, "auto"> | "dictionary";
type ErrorCode =
  | "EMPTY_INPUT"
  | "PROVIDER_CONFIG_MISSING"
  | "PROVIDER_API_ERROR"
  | "PROVIDER_EMPTY_RESPONSE"
  | "TRANSLATION_FAILED";

interface LocalizedText {
  text: string;
  phonetic: string;
  audio_text: string;
}

interface TranslateRequest {
  text?: string;
  source_lang?: LanguageCode | "auto";
  target_lang?: LanguageCode;
  provider?: Provider;
  model?: string;
}

interface WordExample {
  sentence: string;
  translations: Record<LanguageCode, string>;
}

interface WordDetail {
  word: string;
  definition: string;
}

interface WordSense {
  sense_order: number;
  part_of_speech: string;
  gloss_key: string;
  definitions: Record<DisplayLanguageCode, string>;
}

interface BaseResponse {
  detected_source_lang: string;
  target_lang: LanguageCode;
  original: string;
  translation: string;
  translations: Record<DisplayLanguageCode, LocalizedText>;
  provider: ResponseProvider;
  model: string;
  cached: boolean;
}

interface WordResponse extends BaseResponse {
  type: "word";
  phonetic: string;
  audio_text: string;
  examples: WordExample[];
  word_details: Record<DisplayLanguageCode, WordDetail>;
  senses?: WordSense[];
}

interface SentenceResponse extends BaseResponse {
  type: "sentence";
  explanation: string;
  explanations: Record<DisplayLanguageCode, string>;
}

type TranslateResponse = WordResponse | SentenceResponse;

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};

const MESSAGES = {
  emptyInput: "请输入要翻译的内容。",
  serviceUnavailable: "翻译暂时不可用，请检查 API Key、平台或模型名称。"
};

const DEFAULT_MODELS: Record<Provider, string> = {
  auto: "qwen3.6-flash-2026-04-16",
  openrouter: "qwen/qwen3.6-30b-a3b:free",
  dashscope: "qwen3.6-flash-2026-04-16",
  gemini: "gemini-2.5-flash"
};

class TranslateError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status = 500,
    public provider?: ResponseProvider,
    public model?: string
  ) {
    super(message);
  }
}

const SYSTEM_PROMPT = `You are a translation engine for a mobile PWA.
Return valid JSON only. Never wrap JSON in markdown fences.

Rules:
1. Detect whether the input is a single word or a sentence/phrase.
2. Every response must include translations for zh, en, pt-BR, and ja.
3. Each translation entry must include text, phonetic, and audio_text.
4. For Chinese phonetic, provide pinyin. For English, provide IPA or readable pronunciation. For Japanese, provide kana reading. For Brazilian Portuguese, provide a readable Brazilian pronunciation guide.
5. If it is a single word, return:
{
  "type": "word",
  "detected_source_lang": "en",
  "translation": "target-language word",
  "phonetic": "source word pronunciation",
  "audio_text": "source word",
  "translations": {
    "zh": {"text": "中文词", "phonetic": "pin yin", "audio_text": "中文词"},
    "en": {"text": "English word", "phonetic": "/ipa/", "audio_text": "English word"},
    "pt-BR": {"text": "palavra", "phonetic": "pronunciation", "audio_text": "palavra"},
    "ja": {"text": "日本語", "phonetic": "かな", "audio_text": "日本語"}
  },
  "word_details": {
    "zh": {"word": "中文词", "definition": "中文解释"},
    "en": {"word": "English word", "definition": "English definition"},
    "pt-BR": {"word": "palavra", "definition": "Definição em português do Brasil"},
    "ja": {"word": "日本語", "definition": "日本語の説明"}
  },
  "examples": [
    {
      "sentence": "A concise sentence containing the word.",
      "translations": {
        "zh": "中文例句翻译",
        "en": "English example translation",
        "pt-BR": "Tradução do exemplo em português do Brasil",
        "ja": "日本語の例文訳"
      }
    }
  ]
}
6. If it is a sentence or phrase, return:
{
  "type": "sentence",
  "detected_source_lang": "en",
  "translation": "target-language translation",
  "explanation": "A concise explanation in the requested target language.",
  "explanations": {
    "zh": "简体中文解释含义、语气和用法。不要使用日语假名。",
    "en": "English explanation of meaning, tone, and usage.",
    "pt-BR": "Explicação em português do Brasil sobre significado, tom e uso.",
    "ja": "意味、ニュアンス、使い方の日本語説明。"
  },
  "translations": {
    "zh": {"text": "中文翻译", "phonetic": "pinyin for the whole sentence", "audio_text": "中文翻译"},
    "en": {"text": "English translation", "phonetic": "IPA or readable pronunciation", "audio_text": "English translation"},
    "pt-BR": {"text": "Brazilian Portuguese translation", "phonetic": "Brazilian pronunciation guide", "audio_text": "Brazilian Portuguese translation"},
    "ja": {"text": "Japanese translation", "phonetic": "kana reading", "audio_text": "Japanese translation"}
  }
}
7. The language-keyed fields must be written in their own language:
- zh must be Simplified Chinese only. Do not use Japanese kana or Portuguese.
- en must be English only.
- pt-BR must be Brazilian Portuguese only.
- ja must be Japanese only.
8. Preserve the requested target language exactly and keep all text natural and concise.`;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === "/api/translate" && request.method === "POST") {
      return handleTranslate(request, env, ctx);
    }

    if (url.pathname === "/api/settings") {
      return handleSettings(request, env);
    }

    if (url.pathname === "/api/dictionary/stats" && request.method === "GET") {
      return handleDictionaryStats(env, url.searchParams.get("debug") === "1");
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return handleHealth(env);
    }

    if (url.pathname === "/health") {
      return handleHealth(env);
    }

    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;

async function handleTranslate(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  try {
    const body = (await request.json()) as TranslateRequest;
    const text = normalizeText(body.text ?? "");
    const targetLang = normalizeTargetLang(body.target_lang);
    const sourceLang = body.source_lang ?? "auto";
    const provider = normalizeProvider(body.provider);
    const requestedModel =
      typeof body.model === "string" && body.model.trim()
      ? normalizeModel(body.model, provider)
      : await getStoredModel(env, provider);

    if (!text) {
      throw new TranslateError("EMPTY_INPUT", MESSAGES.emptyInput, 400);
    }

    const dictionaryResponse = await lookupDictionaryFirst({
      env,
      text,
      targetLang
    });

    if (dictionaryResponse) {
      return json(dictionaryResponse);
    }

    const selected = selectProvider(env, provider, requestedModel);
    const cacheKey = await buildCacheKey(
      text,
      sourceLang,
      targetLang,
      selected.provider,
      selected.model
    );
    const cached = await env.CACHE.get<TranslateResponse>(cacheKey, "json");

    if (cached) {
      return json({ ...cached, cached: true });
    }

    const translated = await translateWithProvider({
      text,
      sourceLang,
      targetLang,
      provider: selected.provider,
      model: selected.model,
      apiKey: selected.apiKey
    });

    const normalizedResponse = normalizeResponse({
      translated,
      text,
      targetLang,
      provider: selected.provider,
      model: selected.model
    });

    ctx.waitUntil(
      env.CACHE.put(cacheKey, JSON.stringify(normalizedResponse), {
        expirationTtl: 60 * 60 * 24 * 30
      })
    );

    return json(normalizedResponse);
  } catch (error) {
    const translateError =
      error instanceof TranslateError
        ? error
        : new TranslateError(
            "TRANSLATION_FAILED",
            MESSAGES.serviceUnavailable,
            500
          );
    console.error(
      JSON.stringify({
        level: "error",
        message: "translate_failed",
        error_code: translateError.code,
        provider: translateError.provider,
        model: translateError.model,
        error: error instanceof Error ? error.message : String(error)
      })
    );

    return json(
      {
        error: translateError.message,
        error_code: translateError.code,
        ...(translateError.provider ? { provider: translateError.provider } : {}),
        ...(translateError.model ? { model: translateError.model } : {})
      },
      translateError.status
    );
  }
}

async function handleHealth(env: Env): Promise<Response> {
  const dictionary = {
    configured: Boolean(env.DICTIONARY_API_URL && env.DICTIONARY_API_TOKEN),
    reachable: false,
    stats: null as Record<string, unknown> | null
  };
  let kv = false;

  try {
    await env.CACHE.get("global:model-settings");
    kv = true;
  } catch {
    kv = false;
  }

  if (dictionary.configured) {
    try {
      dictionary.stats = await fetchDictionaryStats(env);
      dictionary.reachable = true;
    } catch {
      dictionary.reachable = false;
    }
  }

  return json({
    ok: true,
    date: new Date().toISOString(),
    version: "provider-observability-v1",
    kv: { reachable: kv },
    dictionary,
    providers: {
      openrouter: { configured: Boolean(env.OPENROUTER_API_KEY) },
      dashscope: { configured: Boolean(env.DASHSCOPE_API_KEY) },
      gemini: { configured: Boolean(env.GEMINI_API_KEY) }
    }
  });
}

async function handleDictionaryStats(env: Env, debug = false): Promise<Response> {
  try {
    const stats = await fetchDictionaryStats(env);
    return json(stats);
  } catch (error) {
    return json({
      accepted_words: null,
      updated_at: null,
      db_size: null,
      unavailable: true,
      ...(debug
        ? {
            configured: Boolean(env.DICTIONARY_API_URL && env.DICTIONARY_API_TOKEN),
            error: error instanceof Error ? error.message : String(error)
          }
        : {})
    });
  }
}

async function handleSettings(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    return json(await getStoredSettings(env));
  }

  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  const body = (await request.json()) as { provider?: string; model?: string };
  const provider = normalizeProvider(body.provider);
  const model = normalizeText(body.model || "") || DEFAULT_MODELS[provider] || DEFAULT_MODELS.auto;
  const settings = {
    provider,
    model,
    updated_at: new Date().toISOString()
  };

  await env.CACHE.put("global:model-settings", JSON.stringify(settings));
  return json(settings);
}

async function getStoredSettings(env: Env): Promise<{ provider: Provider; model: string; updated_at?: string }> {
  const stored = await env.CACHE.get<{ provider?: Provider; model?: string; updated_at?: string }>(
    "global:model-settings",
    "json"
  );
  const provider = normalizeProvider(stored?.provider);
  return {
    provider,
    model: normalizeText(stored?.model || "") || DEFAULT_MODELS[provider] || DEFAULT_MODELS.auto,
    updated_at: stored?.updated_at
  };
}

async function getStoredModel(env: Env, provider: Provider): Promise<string> {
  const settings = await getStoredSettings(env);
  return settings.model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.auto;
}

function selectProvider(
  env: Env,
  requestedProvider: Provider,
  requestedModel: string
): { provider: Exclude<Provider, "auto">; model: string; apiKey: string } {
  if (requestedProvider === "openrouter") {
    if (!env.OPENROUTER_API_KEY) {
      throw new TranslateError(
        "PROVIDER_CONFIG_MISSING",
        "OpenRouter API Key is not configured.",
        500,
        "openrouter",
        requestedModel || DEFAULT_MODELS.openrouter
      );
    }
    return {
      provider: "openrouter",
      model: requestedModel || DEFAULT_MODELS.openrouter,
      apiKey: env.OPENROUTER_API_KEY
    };
  }

  if (requestedProvider === "dashscope") {
    if (!env.DASHSCOPE_API_KEY) {
      throw new TranslateError(
        "PROVIDER_CONFIG_MISSING",
        "DashScope API Key is not configured.",
        500,
        "dashscope",
        requestedModel || DEFAULT_MODELS.dashscope
      );
    }
    return {
      provider: "dashscope",
      model: requestedModel || DEFAULT_MODELS.dashscope,
      apiKey: env.DASHSCOPE_API_KEY
    };
  }

  if (requestedProvider === "gemini") {
    if (!env.GEMINI_API_KEY) {
      throw new TranslateError(
        "PROVIDER_CONFIG_MISSING",
        "Gemini API Key is not configured.",
        500,
        "gemini",
        requestedModel || DEFAULT_MODELS.gemini
      );
    }
    return {
      provider: "gemini",
      model: requestedModel || DEFAULT_MODELS.gemini,
      apiKey: env.GEMINI_API_KEY
    };
  }

  if (env.DASHSCOPE_API_KEY) {
    return {
      provider: "dashscope",
      model: selectModelForProvider(requestedProvider, "dashscope", requestedModel),
      apiKey: env.DASHSCOPE_API_KEY
    };
  }

  if (env.GEMINI_API_KEY) {
    return {
      provider: "gemini",
      model: selectModelForProvider(requestedProvider, "gemini", requestedModel),
      apiKey: env.GEMINI_API_KEY
    };
  }

  if (env.OPENROUTER_API_KEY) {
    return {
      provider: "openrouter",
      model: selectModelForProvider(requestedProvider, "openrouter", requestedModel),
      apiKey: env.OPENROUTER_API_KEY
    };
  }

  throw new TranslateError(
    "PROVIDER_CONFIG_MISSING",
    "No translation provider API key is configured.",
    500
  );
}

function selectModelForProvider(
  requestedProvider: Provider,
  selectedProvider: Exclude<Provider, "auto">,
  requestedModel: string
): string {
  if (!requestedModel) {
    return DEFAULT_MODELS[selectedProvider];
  }

  if (requestedProvider === "auto" && requestedModel === DEFAULT_MODELS.auto) {
    return DEFAULT_MODELS[selectedProvider];
  }

  return requestedModel;
}

function normalizeResponse(input: {
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
      phonetic: String(input.translated.phonetic ?? ""),
      audio_text: String(input.translated.audio_text ?? input.text),
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
  return isExpectedExplanationLanguage(targetLang, fallback) ? fallback : "";
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
    zh: isExpectedExplanationLanguage("zh", normalized.zh) ? normalized.zh : "",
    en: isExpectedExplanationLanguage("en", normalized.en) ? normalized.en : "",
    "pt-BR": isExpectedExplanationLanguage("pt-BR", normalized["pt-BR"])
      ? normalized["pt-BR"]
      : "",
    ja: isExpectedExplanationLanguage("ja", normalized.ja) ? normalized.ja : ""
  };
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

async function translateWithProvider(input: {
  text: string;
  sourceLang: TranslateRequest["source_lang"];
  targetLang: LanguageCode;
  provider: Exclude<Provider, "auto">;
  model: string;
  apiKey: string;
}): Promise<Record<string, unknown>> {
  const prompt = buildUserPrompt(input.text, input.sourceLang, input.targetLang);

  if (input.provider === "dashscope") {
    return translateWithDashScope({ ...input, prompt });
  }

  if (input.provider === "openrouter") {
    return translateWithOpenRouter({ ...input, prompt });
  }

  return translateWithGemini({ ...input, prompt });
}

async function lookupDictionaryFirst(input: {
  env: Env;
  text: string;
  targetLang: LanguageCode;
}): Promise<WordResponse | null> {
  if (!isDictionaryLookupCandidate(input.text)) return null;
  if (!input.env.DICTIONARY_API_URL || !input.env.DICTIONARY_API_TOKEN) return null;

  try {
    const url = new URL("/api/dictionary/lookup", input.env.DICTIONARY_API_URL);
    url.searchParams.set("term", input.text);
    const response = await fetch(url.toString(), {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${input.env.DICTIONARY_API_TOKEN}`
      },
      signal: AbortSignal.timeout(1800)
    });

    if (!response.ok) return null;
    const payload = (await response.json()) as { entries?: Array<Record<string, unknown>> };
    const entry = payload.entries?.[0];
    if (!entry) return null;
    return dictionaryEntryToResponse(entry, input.text, input.targetLang);
  } catch {
    return null;
  }
}

async function fetchDictionaryStats(env: Env): Promise<Record<string, unknown>> {
  if (!env.DICTIONARY_API_URL || !env.DICTIONARY_API_TOKEN) {
    throw new Error("dictionary API is not configured");
  }

  const url = new URL("/api/dictionary/stats", env.DICTIONARY_API_URL);
  const response = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${env.DICTIONARY_API_TOKEN}`
    },
    signal: AbortSignal.timeout(2500)
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

async function translateWithDashScope(input: {
  prompt: string;
  model: string;
  apiKey: string;
}): Promise<Record<string, unknown>> {
  const provider = "dashscope";
  const response = await fetch(
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "authorization": `Bearer ${input.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: input.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: input.prompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        enable_thinking: false
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new TranslateError(
      "PROVIDER_API_ERROR",
      `DashScope API error: ${response.status} ${errorText}`,
      502,
      provider,
      input.model
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawText = payload.choices?.[0]?.message?.content?.trim() ?? "";

  if (!rawText) {
    throw new TranslateError(
      "PROVIDER_EMPTY_RESPONSE",
      "DashScope returned empty content.",
      502,
      provider,
      input.model
    );
  }

  return JSON.parse(stripJsonFence(rawText)) as Record<string, unknown>;
}

async function translateWithOpenRouter(input: {
  prompt: string;
  model: string;
  apiKey: string;
}): Promise<Record<string, unknown>> {
  const provider = "openrouter";
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${input.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: input.prompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new TranslateError(
      "PROVIDER_API_ERROR",
      `OpenRouter API error: ${response.status} ${errorText}`,
      502,
      provider,
      input.model
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawText = payload.choices?.[0]?.message?.content?.trim() ?? "";

  if (!rawText) {
    throw new TranslateError(
      "PROVIDER_EMPTY_RESPONSE",
      "OpenRouter returned empty content.",
      502,
      provider,
      input.model
    );
  }

  return JSON.parse(stripJsonFence(rawText)) as Record<string, unknown>;
}

async function translateWithGemini(input: {
  prompt: string;
  model: string;
  apiKey: string;
}): Promise<Record<string, unknown>> {
  const provider = "gemini";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(input.apiKey)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: input.prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json"
        }
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new TranslateError(
      "PROVIDER_API_ERROR",
      `Gemini API error: ${response.status} ${errorText}`,
      502,
      provider,
      input.model
    );
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };
  const rawText =
    payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

  if (!rawText) {
    throw new TranslateError(
      "PROVIDER_EMPTY_RESPONSE",
      "Gemini returned empty content.",
      502,
      provider,
      input.model
    );
  }

  return JSON.parse(stripJsonFence(rawText)) as Record<string, unknown>;
}

function buildUserPrompt(
  text: string,
  sourceLang: TranslateRequest["source_lang"],
  targetLang: LanguageCode
): string {
  return [
    `Source language: ${sourceLang}`,
    `Target language: ${targetLang}`,
    `Text: ${text}`
  ].join("\n");
}

async function buildCacheKey(
  text: string,
  sourceLang: TranslateRequest["source_lang"],
  targetLang: LanguageCode,
  provider: Exclude<Provider, "auto">,
  model: string
): Promise<string> {
  const normalized = `v31::${provider}::${model}::${text.toLowerCase()}::${sourceLang ?? "auto"}::${targetLang}`;
  const data = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeTargetLang(target?: string): LanguageCode {
  if (target === "en" || target === "zh" || target === "pt-BR" || target === "ja") {
    return target;
  }
  return "zh";
}

function normalizeProvider(provider?: string): Provider {
  if (provider === "openrouter" || provider === "dashscope" || provider === "gemini") {
    return provider;
  }
  return "auto";
}

function normalizeModel(model: unknown, provider: Provider): string {
  const normalized = String(model ?? "").trim();
  return normalized || DEFAULT_MODELS[provider] || DEFAULT_MODELS.auto;
}

function normalizeExamples(value: unknown): WordExample[] {
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
    zh: normalizeLocalizedText(translations.zh),
    en: normalizeLocalizedText(translations.en),
    "pt-BR": normalizeLocalizedText(translations["pt-BR"]),
    ja: normalizeLocalizedText(translations.ja)
  };
}

function normalizeLocalizedText(value: unknown): LocalizedText {
  if (typeof value === "string") {
    return { text: value, phonetic: "", audio_text: value };
  }

  const item =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const text = normalizeStringOrText(item.text);

  return {
    text,
    phonetic: String(item.phonetic ?? ""),
    audio_text: normalizeStringOrText(item.audio_text) || text
  };
}

function normalizeWordDetails(value: unknown): Record<DisplayLanguageCode, WordDetail> {
  const details =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    zh: normalizeWordDetail(details.zh),
    en: normalizeWordDetail(details.en),
    "pt-BR": normalizeWordDetail(details["pt-BR"]),
    ja: normalizeWordDetail(details.ja)
  };
}

function normalizeWordDetail(value: unknown): WordDetail {
  const detail =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    word: normalizeStringOrText(detail.word),
    definition: normalizeStringOrText(detail.definition)
  };
}

function normalizeStringOrText(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    return String(item.text ?? item.translation ?? "");
  }
  return String(value);
}

function stripJsonFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...CORS_HEADERS
    }
  });
}
