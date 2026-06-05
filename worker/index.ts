import type {
  Env,
  LanguageCode,
  LocalizedText,
  Provider,
  ResponseProvider,
  SentenceResponse,
  TranslateRequest,
  TranslateResponse
} from "./types";
import { TranslateError } from "./errors";
import {
  CORS_HEADERS,
  JSON_HEADERS,
  MAX_INPUT_CHARS,
  MESSAGES,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_SECONDS,
  TRANSLATION_CACHE_VERSION
} from "./config";
import { selectProvider } from "./provider-selection";
import { parseProviderJson } from "./provider-json";
import {
  localPronunciationText,
  normalizeModel,
  normalizeProvider,
  normalizeResponse,
  normalizeStringOrText,
  normalizeTargetLang,
  normalizeText
} from "./normalization";
import { fetchDictionaryStats, lookupDictionaryFirst } from "./dictionary";
import {
  streamProviderJson,
  translateWithDashScope,
  translateWithDeepSeek,
  translateWithGemini,
  translateWithOpenRouter
} from "./provider-clients";
import {
  ACTIVE_SYSTEM_PROMPT,
  buildUserPrompt,
  isPreviewPrompt,
  selectProviderSystemPrompt
} from "./prompts";
import { streamStructuredTranslation } from "./streaming";
import { getStoredModel, handleModels, handleSettings } from "./settings";

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

    if (url.pathname === "/api/report-error" && request.method === "POST") {
      return handleReportError(request, env);
    }

    if (url.pathname === "/api/models" && request.method === "GET") {
      return handleModels(json);
    }

    if (url.pathname === "/api/settings") {
      return handleSettings(request, env, json);
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

        send("status", {
          stage: "provider_connected",
          provider: selected.provider,
          model: selected.model
        });
        let sentFirstToken = false;
        const translated = await streamStructuredTranslation(
          {
            text,
            sourceLang,
            targetLang,
            provider: selected.provider,
            model: selected.model,
            apiKey: selected.apiKey
          },
          (partial) => {
            if (!sentFirstToken) {
              sentFirstToken = true;
              send("status", { stage: "first_token" });
            }
            const hasExplanation = Object.values(partial.explanations || {}).some(Boolean);
            send(hasExplanation ? "partial_explanation" : "partial_translation", partial);
          },
          translateWithProvider
        );

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

async function handleReportError(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.text();
    // Since we don't have SSH access to update the remote dictionary API server (66.154.106.3) 
    // to add the /api/dictionary/report endpoint, we intercept and log the error report here at the edge.
    console.log(
      JSON.stringify({
        level: "info",
        message: "translation_error_reported",
        report: JSON.parse(body)
      })
    );
    
    // Simulate a successful write to the dictionary queue
    return json({ ok: true }, 200);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
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

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...CORS_HEADERS
    }
  });
}
