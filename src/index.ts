import { pinyin } from "pinyin-pro";

interface Env {
  ASSETS: Fetcher;
  CACHE: KVNamespace;
  OPENROUTER_API_KEY?: string;
  DASHSCOPE_API_KEY?: string;
  GEMINI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  DICTIONARY_API_URL?: string;
  DICTIONARY_API_TOKEN?: string;
}

type LanguageCode = "en" | "zh" | "pt-BR" | "ja";
type DisplayLanguageCode = LanguageCode;
type Provider = "auto" | "openrouter" | "dashscope" | "gemini" | "deepseek";
type ResponseProvider = Exclude<Provider, "auto"> | "dictionary";
type ErrorCode =
  | "EMPTY_INPUT"
  | "INPUT_TOO_LONG"
  | "RATE_LIMITED"
  | "PROVIDER_CONFIG_MISSING"
  | "PROVIDER_API_ERROR"
  | "PROVIDER_EMPTY_RESPONSE"
  | "PROVIDER_INVALID_JSON"
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
  emptyInput: "\u8bf7\u8f93\u5165\u8981\u7ffb\u8bd1\u7684\u5185\u5bb9\u3002",
  inputTooLong: "\u8f93\u5165\u8fc7\u957f\uff0c\u8bf7\u63a7\u5236\u5728 1200 \u4e2a\u5b57\u7b26\u4ee5\u5185\u3002",
  rateLimited: "\u8bf7\u6c42\u8fc7\u4e8e\u9891\u7e41\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002",
  serviceUnavailable: "\u7ffb\u8bd1\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u8bf7\u68c0\u67e5 API Key\u3001\u5e73\u53f0\u6216\u6a21\u578b\u540d\u79f0\u3002"
};

const DEFAULT_MODELS: Record<Provider, string> = {
  auto: "qwen3.6-flash",
  openrouter: "qwen/qwen3-next-80b-a3b-instruct:free",
  dashscope: "qwen3.6-flash",
  gemini: "gemini-2.5-flash",
  deepseek: "deepseek-v4-flash"
};

const MODEL_OPTIONS_VERSION = 5;
const EDITABLE_PROVIDERS: Exclude<Provider, "auto">[] = [
  "openrouter",
  "dashscope",
  "gemini",
  "deepseek"
];
const MODEL_OPTIONS: Record<Provider, string[]> = {
  auto: ["qwen3.6-flash"],
  openrouter: [
    "qwen/qwen3-next-80b-a3b-instruct:free",
    "openrouter/free",
    "openrouter/owl-alpha",
    "deepseek/deepseek-v4-flash:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    "nvidia/nemotron-3-nano-30b-a3b:free",
    "nvidia/nemotron-nano-12b-v2-vl:free",
    "nvidia/nemotron-nano-9b-v2:free",
    "google/gemma-4-31b-it:free",
    "google/gemma-4-26b-a4b-it:free",
    "minimax/minimax-m2.5:free",
    "z-ai/glm-4.5-air:free",
    "qwen/qwen3-coder:free",
    "openai/gpt-oss-120b:free",
    "openai/gpt-oss-20b:free",
    "baidu/cobuddy:free",
    "arcee-ai/trinity-large-thinking:free",
    "poolside/laguna-m.1:free",
    "poolside/laguna-xs.2:free",
    "liquid/lfm-2.5-1.2b-thinking:free",
    "liquid/lfm-2.5-1.2b-instruct:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "meta-llama/llama-3.2-3b-instruct:free",
    "nousresearch/hermes-3-llama-3.1-405b:free",
    "cognitivecomputations/dolphin-mistral-24b-venice-edition:free"
  ],
  dashscope: [
    "qwen3.6-flash",
    "qwen3.6-35b-a3b",
    "glm-5.1",
    "qwen3.6-plus-2026-04-02",
    "qwen3.6-plus",
    "qwen3.5-plus-2026-04-20",
    "qwen3.6-max-preview",
    "qwen3.7-max",
    "kimi-k2.6",
    "qwen3.7-max-2026-05-20",
    "qwen-flash-character-2026-02-26",
    "deepseek-v4-pro",
    "qwen3.6-27b",
    "gui-plus-2026-02-26",
    "deepseek-v4-flash"
  ],
  gemini: [
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.1-pro-preview",
    "gemini-2.5-flash",
    "gemini-2.5-pro"
  ],
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"]
};

const TRANSLATION_CACHE_VERSION = "v33";
const PREVIEW_TIMEOUT_MS = 10_000;
const FULL_TRANSLATION_TIMEOUT_MS = 30_000;
const MAX_INPUT_CHARS = 1200;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 30;
const FULL_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: ["word", "sentence"],
      description: "Use word for a single lexical item; use sentence for phrases or sentences."
    },
    detected_source_lang: {
      type: "string",
      description: "Detected source language code, such as zh, en, pt-BR, ja, or auto."
    },
    translation: {
      type: "string",
      description: "Main translation in the requested target language."
    },
    translations: {
      type: "object",
      properties: {
        zh: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "Simplified Chinese translation text only."
            }
          },
          required: ["text"]
        },
        en: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "English translation text only."
            }
          },
          required: ["text"]
        },
        "pt-BR": {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "Brazilian Portuguese translation text only."
            }
          },
          required: ["text"]
        },
        ja: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "Japanese translation text only."
            }
          },
          required: ["text"]
        }
      },
      required: ["zh", "en", "pt-BR", "ja"]
    },
    explanations: {
      type: "object",
      properties: {
        zh: {
          type: "string",
          description: "Simplified Chinese explanation for this exact sentence. Do not use Japanese kana or Portuguese."
        },
        en: {
          type: "string",
          description: "English explanation for this exact sentence."
        },
        "pt-BR": {
          type: "string",
          description: "Brazilian Portuguese explanation for this exact sentence."
        },
        ja: {
          type: "string",
          description: "Japanese explanation for this exact sentence."
        }
      }
    },
    word_details: {
      type: "object",
      properties: {
        zh: {
          type: "object",
          properties: {
            word: { type: "string", description: "Simplified Chinese word." },
            definition: {
              type: "string",
              description: "Concise Simplified Chinese definition only. No pronunciation, part-of-speech label, markdown, or cross-language equivalents."
            }
          }
        },
        en: {
          type: "object",
          properties: {
            word: { type: "string", description: "English word." },
            definition: {
              type: "string",
              description: "Concise English definition only. No pronunciation, part-of-speech label, markdown, or cross-language equivalents."
            }
          }
        },
        "pt-BR": {
          type: "object",
          properties: {
            word: { type: "string", description: "Brazilian Portuguese word." },
            definition: {
              type: "string",
              description: "Concise Brazilian Portuguese definition only. No pronunciation, part-of-speech label, markdown, or cross-language equivalents."
            }
          }
        },
        ja: {
          type: "object",
          properties: {
            word: { type: "string", description: "Japanese word." },
            definition: {
              type: "string",
              description: "Concise Japanese definition only. No pronunciation, part-of-speech label, markdown, or cross-language equivalents."
            }
          }
        }
      }
    },
    examples: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sentence: { type: "string" },
          translations: {
            type: "object",
            properties: {
              zh: { type: "string" },
              en: { type: "string" },
              "pt-BR": { type: "string" },
              ja: { type: "string" }
            }
          }
        },
        required: ["sentence", "translations"]
      }
    }
  },
  required: ["type", "detected_source_lang", "translation", "translations"]
} as const;
const PREVIEW_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["sentence"] },
    detected_source_lang: {
      type: "string",
      description: "Detected source language code."
    },
    translation: {
      type: "string",
      description: "Natural translation in the requested target language."
    },
    explanation: {
      type: "string",
      description: "One concise explanation in the requested target language."
    }
  },
  required: ["type", "detected_source_lang", "translation", "explanation"]
} as const;

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
3. Each translation entry should include only text. Do not generate phonetic or audio_text fields.
4. The server will generate pronunciation fields separately.
5. If it is a single word, return:
{
  "type": "word",
  "detected_source_lang": "en",
  "translation": "target-language word",
  "translations": {
    "zh": {"text": "中文词"},
    "en": {"text": "English word"},
    "pt-BR": {"text": "palavra"},
    "ja": {"text": "日本語"}
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
  "explanation": "Write a real explanation for the input sentence in the requested target language.",
  "explanations": {
    "zh": "简体中文解释含义、语气和用法。不要使用日语假名。",
    "en": "Real English explanation for this exact sentence.",
    "pt-BR": "Explicação em português do Brasil sobre significado, tom e uso.",
    "ja": "意味、ニュアンス、使い方の日本語説明。"
  },
  "translations": {
    "zh": {"text": "中文翻译"},
    "en": {"text": "English translation"},
    "pt-BR": {"text": "Brazilian Portuguese translation"},
    "ja": {"text": "Japanese translation"}
  }
}
7. The language-keyed fields must be written in their own language:
- zh must be Simplified Chinese only. Do not use Japanese kana or Portuguese.
- en must be English only.
- pt-BR must be Brazilian Portuguese only.
- ja must be Japanese only.
8. Preserve the requested target language exactly and keep all text natural and concise.
9. Never copy placeholder wording such as "English explanation of meaning, tone, and usage" or "Real English explanation for this exact sentence".`;

const PREVIEW_SYSTEM_PROMPT = `You are a fast translation preview engine.
Return valid JSON only. Never wrap JSON in markdown fences.

Return only this compact shape:
{
  "type": "sentence",
  "detected_source_lang": "en",
  "translation": "natural translation in the requested target language",
  "explanation": "one concise explanation in the requested target language"
}

Keep the translation natural and concise. Do not include other languages, phonetics, examples, or markdown.`;

const ACTIVE_SYSTEM_PROMPT = `You are a translation engine for a mobile PWA.
Return valid JSON only. Never wrap JSON in markdown fences.

Rules:
1. Detect whether the input is a single word or a sentence/phrase.
2. Always provide translations for zh, en, pt-BR, and ja.
3. Translation entries must include only "text". Do not generate phonetic or audio_text fields.
4. The server will generate pronunciation fields separately.
5. Language-keyed fields must be written in their own language:
- zh: Simplified Chinese only. Do not use Japanese kana or Portuguese.
- en: English only.
- pt-BR: Brazilian Portuguese only.
- ja: Japanese only.
6. Explanations must be specific to the actual input text. Never copy placeholder wording from this prompt.
7. For word_details definitions, write only a concise definition in that language. Do not include pronunciation, part-of-speech labels, cross-language equivalents, markdown, bullet points, or comparisons such as "in Japanese/English/Portuguese". Keep each definition under 28 words or 45 Chinese/Japanese characters.

For a single word, return:
{
  "type": "word",
  "detected_source_lang": "en",
  "translation": "<target-language word>",
  "translations": {
    "zh": {"text": "<Simplified Chinese word>"},
    "en": {"text": "<English word>"},
    "pt-BR": {"text": "<Brazilian Portuguese word>"},
    "ja": {"text": "<Japanese word>"}
  },
  "word_details": {
    "zh": {"word": "<Simplified Chinese word>", "definition": "<concise Simplified Chinese definition only>"},
    "en": {"word": "<English word>", "definition": "<concise English definition only>"},
    "pt-BR": {"word": "<Brazilian Portuguese word>", "definition": "<concise Brazilian Portuguese definition only>"},
    "ja": {"word": "<Japanese word>", "definition": "<concise Japanese definition only>"}
  },
  "examples": [
    {
      "sentence": "<short source-language example sentence>",
      "translations": {
        "zh": "<Simplified Chinese example translation>",
        "en": "<English example translation>",
        "pt-BR": "<Brazilian Portuguese example translation>",
        "ja": "<Japanese example translation>"
      }
    }
  ]
}

For a sentence or phrase, return:
{
  "type": "sentence",
  "detected_source_lang": "en",
  "translation": "<target-language translation>",
  "explanation": "<real explanation in the requested target language>",
  "explanations": {
    "zh": "<real Simplified Chinese explanation for this exact sentence>",
    "en": "<real English explanation for this exact sentence>",
    "pt-BR": "<real Brazilian Portuguese explanation for this exact sentence>",
    "ja": "<real Japanese explanation for this exact sentence>"
  },
  "translations": {
    "zh": {"text": "<Simplified Chinese translation>"},
    "en": {"text": "<English translation>"},
    "pt-BR": {"text": "<Brazilian Portuguese translation>"},
    "ja": {"text": "<Japanese translation>"}
  }
}`;

const GEMINI_SYSTEM_PROMPT = `Translate the input for a mobile language-learning app.
Follow the provided JSON schema exactly.
Use zh, en, pt-BR, and ja fields in their own languages.
For word definitions, write concise definitions only; no pronunciation, part-of-speech labels, markdown, or cross-language equivalents.
Do not copy schema descriptions or placeholder wording.`;

const GEMINI_PREVIEW_SYSTEM_PROMPT = `Translate the input into the requested target language.
Follow the provided JSON schema exactly.
Return a natural translation and one concise explanation only.`;

const DEEPSEEK_SYSTEM_PROMPT = `You are a translation engine. Return valid json only.
The user provides source language, target language, and text.
Output this JSON shape exactly:
{"type":"sentence","detected_source_lang":"zh","translation":"target-language text","translations":{"zh":{"text":"简体中文"},"en":{"text":"English"},"pt-BR":{"text":"Português do Brasil"},"ja":{"text":"日本語"}},"explanations":{"zh":"简短中文解释","en":"Brief English explanation","pt-BR":"Breve explicação em português","ja":"短い日本語の説明"}}
For a single word, set type to "word" and also include word_details and examples. Definitions must be concise and written only in their own language.`;

const DEEPSEEK_PREVIEW_SYSTEM_PROMPT = `Return valid json only.
Output this JSON shape exactly:
{"type":"sentence","detected_source_lang":"zh","translation":"target-language text","explanation":"brief explanation in target language"}`;

const DASH_SCOPE_SYSTEM_PROMPT = `You are a translation engine. Return valid JSON only.
The user provides source language, target language, and text.
Return zh, en, pt-BR, and ja fields in their own languages.
For word definitions, write concise definitions only; no pronunciation, markdown, or cross-language equivalents.
Use the same JSON shape as the translation API schema.`;

const DASH_SCOPE_PREVIEW_SYSTEM_PROMPT = `Return valid JSON only.
Translate into the requested target language and return:
{"type":"sentence","detected_source_lang":"zh","translation":"target-language text","explanation":"brief explanation in target language"}`;

const OPENROUTER_SYSTEM_PROMPT = `Translate the input for a mobile language-learning app.
Follow the JSON schema exactly.
Use zh, en, pt-BR, and ja fields in their own languages.
For word definitions, write concise definitions only; no pronunciation, markdown, or cross-language equivalents.`;

const OPENROUTER_PREVIEW_SYSTEM_PROMPT = `Translate into the requested target language.
Follow the JSON schema exactly.
Return a natural translation and one concise explanation only.`;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === "/api/translate" && request.method === "POST") {
      return handleTranslate(request, env, ctx);
    }

    if (url.pathname === "/api/translate-stream" && request.method === "POST") {
      return handleTranslateStream(request, env, ctx);
    }

    if (url.pathname === "/api/models" && request.method === "GET") {
      return handleModels();
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

    validateInputLength(text);
    await assertRateLimit(request, env);

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

async function handleTranslateStream(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify({ event, data })}\n`));
      };

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

        validateInputLength(text);
        await assertRateLimit(request, env);

        send("status", { stage: "started" });

        const dictionaryResponse = await lookupDictionaryFirst({
          env,
          text,
          targetLang
        });

        if (dictionaryResponse) {
          send("final", dictionaryResponse);
          send("done", { ok: true });
          controller.close();
          return;
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
          send("final", { ...cached, cached: true });
          send("done", { ok: true });
          controller.close();
          return;
        }

        try {
          send("status", { stage: "preview" });
          const preview = await translateWithProvider({
            text,
            sourceLang,
            targetLang,
            provider: selected.provider,
            model: selected.model,
            apiKey: selected.apiKey,
            systemPrompt: PREVIEW_SYSTEM_PROMPT,
            prompt: buildUserPrompt(text, sourceLang, targetLang)
          });
          send(
            "partial",
            normalizePreviewResponse({
              translated: preview,
              text,
              targetLang,
              provider: selected.provider,
              model: selected.model
            })
          );
        } catch (error) {
          console.warn(
            JSON.stringify({
              level: "warn",
              message: "translate_preview_failed",
              provider: selected.provider,
              model: selected.model,
              error: error instanceof Error ? error.message : String(error)
            })
          );
        }

        send("status", { stage: "full" });
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

        send("final", normalizedResponse);
        send("done", { ok: true });
        controller.close();
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
            message: "translate_stream_failed",
            error_code: translateError.code,
            provider: translateError.provider,
            model: translateError.model,
            error: error instanceof Error ? error.message : String(error)
          })
        );
        send("error", {
          error: translateError.message,
          error_code: translateError.code,
          ...(translateError.provider ? { provider: translateError.provider } : {}),
          ...(translateError.model ? { model: translateError.model } : {})
        });
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      ...CORS_HEADERS,
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
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
      gemini: { configured: Boolean(env.GEMINI_API_KEY) },
      deepseek: { configured: Boolean(env.DEEPSEEK_API_KEY) }
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

function handleModels(): Response {
  return json({
    version: MODEL_OPTIONS_VERSION,
    providers: ["auto", ...EDITABLE_PROVIDERS],
    editableProviders: EDITABLE_PROVIDERS,
    defaults: DEFAULT_MODELS,
    options: MODEL_OPTIONS
  });
}

function validateInputLength(text: string) {
  if (text.length > MAX_INPUT_CHARS) {
    throw new TranslateError("INPUT_TOO_LONG", MESSAGES.inputTooLong, 413);
  }
}

async function assertRateLimit(request: Request, env: Env): Promise<void> {
  try {
    const clientId = await getRateLimitClientId(request);
    const bucket = Math.floor(Date.now() / (RATE_LIMIT_WINDOW_SECONDS * 1000));
    const key = `rate:${bucket}:${clientId}`;
    const current = Number((await env.CACHE.get(key)) || "0");

    if (current >= RATE_LIMIT_MAX_REQUESTS) {
      throw new TranslateError("RATE_LIMITED", MESSAGES.rateLimited, 429);
    }

    await env.CACHE.put(key, String(current + 1), {
      expirationTtl: RATE_LIMIT_WINDOW_SECONDS * 2
    });
  } catch (error) {
    if (error instanceof TranslateError) {
      throw error;
    }
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "rate_limit_unavailable",
        error: error instanceof Error ? error.message : String(error)
      })
    );
  }
}

async function getRateLimitClientId(request: Request): Promise<string> {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const raw =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("true-client-ip") ||
    forwardedFor ||
    "anonymous";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
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

  if (requestedProvider === "deepseek") {
    if (!env.DEEPSEEK_API_KEY) {
      throw new TranslateError(
        "PROVIDER_CONFIG_MISSING",
        "DeepSeek API Key is not configured.",
        500,
        "deepseek",
        requestedModel || DEFAULT_MODELS.deepseek
      );
    }
    return {
      provider: "deepseek",
      model: requestedModel || DEFAULT_MODELS.deepseek,
      apiKey: env.DEEPSEEK_API_KEY
    };
  }

  if (env.DASHSCOPE_API_KEY) {
    return {
      provider: "dashscope",
      model: selectModelForProvider(requestedProvider, "dashscope", requestedModel),
      apiKey: env.DASHSCOPE_API_KEY
    };
  }

  if (env.DEEPSEEK_API_KEY) {
    return {
      provider: "deepseek",
      model: selectModelForProvider(requestedProvider, "deepseek", requestedModel),
      apiKey: env.DEEPSEEK_API_KEY
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

function modelRequestTimeout(systemPrompt?: string): number {
  return isPreviewPrompt(systemPrompt)
    ? PREVIEW_TIMEOUT_MS
    : FULL_TRANSLATION_TIMEOUT_MS;
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

function normalizePreviewResponse(input: {
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

function emptyLocalizedText(): LocalizedText {
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

function isPreviewPrompt(systemPrompt?: string): boolean {
  return systemPrompt === PREVIEW_SYSTEM_PROMPT ||
    systemPrompt === GEMINI_PREVIEW_SYSTEM_PROMPT ||
    systemPrompt === DEEPSEEK_PREVIEW_SYSTEM_PROMPT ||
    systemPrompt === DASH_SCOPE_PREVIEW_SYSTEM_PROMPT ||
    systemPrompt === OPENROUTER_PREVIEW_SYSTEM_PROMPT;
}

async function translateWithProvider(input: {
  text: string;
  sourceLang: TranslateRequest["source_lang"];
  targetLang: LanguageCode;
  provider: Exclude<Provider, "auto">;
  model: string;
  apiKey: string;
  prompt?: string;
  systemPrompt?: string;
}): Promise<Record<string, unknown>> {
  const prompt = input.prompt || buildUserPrompt(input.text, input.sourceLang, input.targetLang);
  const request = {
    ...input,
    prompt,
    systemPrompt: selectProviderSystemPrompt(input.provider, input.systemPrompt)
  };

  try {
    return await callProvider(request);
  } catch (error) {
    if (
      !(error instanceof TranslateError) ||
      error.code !== "PROVIDER_INVALID_JSON" ||
      isPreviewPrompt(input.systemPrompt)
    ) {
      throw error;
    }

    return callProvider({
      ...request,
      prompt: buildJsonRepairPrompt(prompt, error.message),
      systemPrompt: ACTIVE_SYSTEM_PROMPT
    });
  }
}

function selectProviderSystemPrompt(
  provider: Exclude<Provider, "auto">,
  systemPrompt?: string
): string | undefined {
  const preview = isPreviewPrompt(systemPrompt);
  if (provider === "gemini") {
    return preview ? GEMINI_PREVIEW_SYSTEM_PROMPT : GEMINI_SYSTEM_PROMPT;
  }
  if (provider === "deepseek") {
    return preview ? DEEPSEEK_PREVIEW_SYSTEM_PROMPT : DEEPSEEK_SYSTEM_PROMPT;
  }
  if (provider === "dashscope") {
    return preview ? DASH_SCOPE_PREVIEW_SYSTEM_PROMPT : DASH_SCOPE_SYSTEM_PROMPT;
  }
  if (provider === "openrouter") {
    return preview ? OPENROUTER_PREVIEW_SYSTEM_PROMPT : OPENROUTER_SYSTEM_PROMPT;
  }
  return systemPrompt;
}

async function callProvider(input: {
  text: string;
  sourceLang: TranslateRequest["source_lang"];
  targetLang: LanguageCode;
  provider: Exclude<Provider, "auto">;
  model: string;
  apiKey: string;
  prompt: string;
  systemPrompt?: string;
}): Promise<Record<string, unknown>> {
  if (input.provider === "dashscope") {
    return translateWithDashScope(input);
  }

  if (input.provider === "openrouter") {
    return translateWithOpenRouter(input);
  }

  if (input.provider === "deepseek") {
    return translateWithDeepSeek(input);
  }

  return translateWithGemini(input);
}

function buildJsonRepairPrompt(originalPrompt: string, error: string): string {
  return [
    "The previous response did not match the required JSON schema.",
    `Validation error: ${error}`,
    "Return only corrected JSON. Do not include markdown, commentary, or extra text.",
    originalPrompt
  ].join("\n\n");
}

function withAdditionalPropertiesFalse(schema: unknown): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return schema;
  }

  const source = schema as Record<string, unknown>;
  const next: Record<string, unknown> = { ...source };
  if (next.type === "object") {
    next.additionalProperties = false;
  }
  if (source.properties && typeof source.properties === "object" && !Array.isArray(source.properties)) {
    next.properties = Object.fromEntries(
      Object.entries(source.properties as Record<string, unknown>).map(([key, value]) => [
        key,
        withAdditionalPropertiesFalse(value)
      ])
    );
  }
  if (source.items) {
    next.items = withAdditionalPropertiesFalse(source.items);
  }
  return next;
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
  systemPrompt?: string;
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
          { role: "system", content: input.systemPrompt || ACTIVE_SYSTEM_PROMPT },
          { role: "user", content: input.prompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: isPreviewPrompt(input.systemPrompt) ? 512 : 4096,
        enable_thinking: false
      }),
      signal: AbortSignal.timeout(modelRequestTimeout(input.systemPrompt))
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

  return parseProviderJson(rawText, provider, input.model, isPreviewPrompt(input.systemPrompt));
}

async function translateWithOpenRouter(input: {
  prompt: string;
  model: string;
  apiKey: string;
  systemPrompt?: string;
}): Promise<Record<string, unknown>> {
  const provider = "openrouter";
  let response = await fetchOpenRouter(input, openRouterSchemaResponseFormat(input.systemPrompt));

  if (!response.ok && (await shouldRetryOpenRouterJsonObject(response.clone()))) {
    response = await fetchOpenRouter(input, { type: "json_object" });
  }

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

  return parseProviderJson(rawText, provider, input.model, isPreviewPrompt(input.systemPrompt));
}

function fetchOpenRouter(
  input: {
    prompt: string;
    model: string;
    apiKey: string;
    systemPrompt?: string;
  },
  responseFormat: Record<string, unknown>
): Promise<Response> {
  return fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${input.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: "system", content: input.systemPrompt || ACTIVE_SYSTEM_PROMPT },
        { role: "user", content: input.prompt }
      ],
      response_format: responseFormat,
      provider: {
        require_parameters: responseFormat.type === "json_schema"
      },
      temperature: 0.2,
      max_tokens: isPreviewPrompt(input.systemPrompt) ? 512 : 4096
    }),
    signal: AbortSignal.timeout(modelRequestTimeout(input.systemPrompt))
  });
}

function openRouterSchemaResponseFormat(systemPrompt?: string): Record<string, unknown> {
  return {
    type: "json_schema",
    json_schema: {
      name: isPreviewPrompt(systemPrompt)
        ? "linguago_translation_preview"
        : "linguago_translation",
      strict: true,
      schema: withAdditionalPropertiesFalse(
        isPreviewPrompt(systemPrompt) ? PREVIEW_RESPONSE_SCHEMA : FULL_RESPONSE_SCHEMA
      )
    }
  };
}

async function shouldRetryOpenRouterJsonObject(response: Response): Promise<boolean> {
  if (![400, 404, 422].includes(response.status)) return false;
  const text = await response.text();
  return /response_format|json_schema|schema|require_parameters|not support|unsupported|provider/i.test(text);
}

async function translateWithDeepSeek(input: {
  prompt: string;
  model: string;
  apiKey: string;
  systemPrompt?: string;
}): Promise<Record<string, unknown>> {
  const provider = "deepseek";
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${input.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: "system", content: input.systemPrompt || ACTIVE_SYSTEM_PROMPT },
        { role: "user", content: input.prompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: isPreviewPrompt(input.systemPrompt) ? 512 : 4096,
      thinking: { type: "disabled" }
    }),
    signal: AbortSignal.timeout(modelRequestTimeout(input.systemPrompt))
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new TranslateError(
      "PROVIDER_API_ERROR",
      `DeepSeek API error: ${response.status} ${errorText}`,
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
      "DeepSeek returned empty content.",
      502,
      provider,
      input.model
    );
  }

  return parseProviderJson(rawText, provider, input.model, isPreviewPrompt(input.systemPrompt));
}

async function translateWithGemini(input: {
  prompt: string;
  model: string;
  apiKey: string;
  systemPrompt?: string;
}): Promise<Record<string, unknown>> {
  const provider = "gemini";
  let response = await fetchGemini(input, geminiStructuredConfig(input.systemPrompt));

  if (!response.ok && (await shouldRetryGeminiLegacySchema(response.clone()))) {
    response = await fetchGemini(input, geminiLegacyStructuredConfig(input.systemPrompt));
  }

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

  return parseProviderJson(rawText, provider, input.model, isPreviewPrompt(input.systemPrompt));
}

function fetchGemini(
  input: {
    prompt: string;
    model: string;
    apiKey: string;
    systemPrompt?: string;
  },
  generationConfig: Record<string, unknown>
): Promise<Response> {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(input.apiKey)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: input.systemPrompt || GEMINI_SYSTEM_PROMPT }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: input.prompt }]
          }
        ],
        generationConfig
      }),
      signal: AbortSignal.timeout(modelRequestTimeout(input.systemPrompt))
    }
  );
}

function geminiStructuredConfig(systemPrompt?: string): Record<string, unknown> {
  return {
    temperature: 0.2,
    responseFormat: {
      text: {
        mimeType: "APPLICATION_JSON",
        schema: isPreviewPrompt(systemPrompt)
          ? PREVIEW_RESPONSE_SCHEMA
          : FULL_RESPONSE_SCHEMA
      }
    }
  };
}

function geminiLegacyStructuredConfig(systemPrompt?: string): Record<string, unknown> {
  return {
    temperature: 0.2,
    responseMimeType: "application/json",
    responseSchema: isPreviewPrompt(systemPrompt)
      ? PREVIEW_RESPONSE_SCHEMA
      : FULL_RESPONSE_SCHEMA
  };
}

async function shouldRetryGeminiLegacySchema(response: Response): Promise<boolean> {
  if (response.status !== 400) return false;
  const text = await response.text();
  return /response_format|responseFormat|mime_type|response_schema|responseSchema/i.test(text);
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
  const normalized = `${TRANSLATION_CACHE_VERSION}::${provider}::${model}::${text.toLowerCase()}::${sourceLang ?? "auto"}::${targetLang}`;
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

function localPronunciationText(lang: DisplayLanguageCode, text: string): LocalizedText {
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

function parseProviderJson(
  rawText: string,
  provider: ResponseProvider,
  model: string,
  preview: boolean
): Record<string, unknown> {
  let payload: unknown;
  try {
    payload = JSON.parse(stripJsonFence(rawText));
  } catch (error) {
    throw new TranslateError(
      "PROVIDER_INVALID_JSON",
      `Provider returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      502,
      provider,
      model
    );
  }

  const errors = validateProviderPayload(payload, preview);
  if (errors.length) {
    throw new TranslateError(
      "PROVIDER_INVALID_JSON",
      `Provider JSON failed schema validation: ${errors.join("; ")}`,
      502,
      provider,
      model
    );
  }

  return payload as Record<string, unknown>;
}

function validateProviderPayload(payload: unknown, preview: boolean): string[] {
  const errors: string[] = [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return ["root must be an object"];
  }

  const item = payload as Record<string, unknown>;
  const type = normalizeStringOrText(item.type);
  if (preview) {
    if (type !== "sentence") errors.push("type must be sentence");
    requireString(item, "detected_source_lang", errors);
    requireString(item, "translation", errors);
    requireString(item, "explanation", errors);
    return errors;
  }

  if (type !== "word" && type !== "sentence") {
    errors.push("type must be word or sentence");
  }
  requireString(item, "detected_source_lang", errors);
  requireString(item, "translation", errors);
  validateTranslations(item.translations, errors);

  if (type === "sentence") {
    const explanations =
      item.explanations && typeof item.explanations === "object"
        ? (item.explanations as Record<string, unknown>)
        : null;
    if (!explanations && !normalizeStringOrText(item.explanation)) {
      errors.push("sentence requires explanations or explanation");
    }
  }

  if (type === "word") {
    const details =
      item.word_details && typeof item.word_details === "object"
        ? (item.word_details as Record<string, unknown>)
        : null;
    if (!details) {
      errors.push("word requires word_details");
    }
  }

  return errors;
}

function validateTranslations(value: unknown, errors: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push("translations must be an object");
    return;
  }

  const translations = value as Record<string, unknown>;
  for (const lang of ["zh", "en", "pt-BR", "ja"]) {
    const translation = translations[lang];
    if (!translation || typeof translation !== "object" || Array.isArray(translation)) {
      errors.push(`translations.${lang} must be an object`);
      continue;
    }
    requireString(translation as Record<string, unknown>, "text", errors, `translations.${lang}`);
  }
}

function requireString(
  item: Record<string, unknown>,
  key: string,
  errors: string[],
  prefix?: string
) {
  if (!normalizeStringOrText(item[key])) {
    errors.push(`${prefix ? `${prefix}.` : ""}${key} must be a non-empty string`);
  }
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
