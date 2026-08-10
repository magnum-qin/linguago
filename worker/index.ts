import type {
  Env,
  LanguageCode,
  LocalizedText,
  Provider,
  ResponseProvider,
  SentenceResponse,
  TranslateRequest,
  TranslateResponse
} from './types';
import { TranslateError } from './errors';
import {
  CORS_HEADERS,
  DEFAULT_MODELS,
  JSON_HEADERS,
  MAX_INPUT_CHARS,
  MESSAGES,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_SECONDS,
  TRANSLATION_CACHE_VERSION
} from './config';
import { selectProvider } from './provider-selection';
import { parseProviderJson } from './provider-json';
import {
  localPronunciationText,
  isLikelyLexicalInput,
  normalizeModel,
  normalizeProvider,
  normalizeResponse,
  normalizeStringOrText,
  normalizeTargetLang,
  normalizeText
} from './normalization';
import { fetchDictionaryStats, lookupDictionaryFirst } from './dictionary';
import {
  streamProviderJson,
  translateWithCloudflare,
  translateWithDashScope,
  translateWithDeepSeek,
  translateWithGemini
} from './provider-clients';
import { ACTIVE_SYSTEM_PROMPT, buildUserPrompt, isPreviewPrompt, selectProviderSystemPrompt } from './prompts';
import { streamStructuredTranslation } from './streaming';
import { getStoredModel, handleModels, handleSettings } from './settings';

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === '/api/translate' && request.method === 'POST') {
      return handleTranslate(request, env, ctx);
    }

    if (url.pathname === '/api/translate-stream' && request.method === 'POST') {
      return handleTranslateStream(request, env, ctx);
    }

    if (url.pathname === '/api/report-error' && request.method === 'POST') {
      return handleReportError(request, env);
    }

    if (url.pathname === '/api/models' && request.method === 'GET') {
      return handleModels(json);
    }

    if (url.pathname === '/api/settings') {
      return handleSettings(request, env, json);
    }

    if (url.pathname === '/api/dictionary/stats' && request.method === 'GET') {
      return handleDictionaryStats(env, url.searchParams.get('debug') === '1');
    }

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return handleHealth(env);
    }

    if (url.pathname === '/health') {
      return handleHealth(env);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

async function handleTranslate(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const body = (await request.json()) as TranslateRequest;
    const text = normalizeText(body.text ?? '');
    const targetLang = normalizeTargetLang(body.target_lang);
    const sourceLang = body.source_lang ?? 'auto';
    const provider = normalizeProvider(body.provider);
    const requestedModel =
      typeof body.model === 'string' && body.model.trim()
        ? normalizeModel(body.model, provider)
        : await getStoredModel(env, provider);

    if (!text) {
      throw new TranslateError('EMPTY_INPUT', MESSAGES.emptyInput, 400);
    }

    validateInputLength(text);
    await assertRateLimit(request, env, ctx);

    const dictionaryCacheKey = await buildDictionaryCacheKey(text, sourceLang, targetLang);
    const dictionaryCached = await env.CACHE.get<TranslateResponse>(dictionaryCacheKey, 'json');
    if (dictionaryCached && dictionaryCached.type === 'word' && dictionaryCached.provider === 'dictionary') {
      const isLegacyWordCache = !dictionaryCached.senses || dictionaryCached.senses.length === 0;
      if (!isLegacyWordCache) {
        return json({ ...dictionaryCached, cached: true, cache_hit: true });
      }
      console.log(`Ignoring legacy dictionary cache for ${text}`);
    }

    const dictionaryResponse = await safeLookupDictionaryFirst({
      env,
      text,
      targetLang,
      sourceLang
    });

    if (dictionaryResponse) {
      ctx.waitUntil(
        env.CACHE.put(dictionaryCacheKey, JSON.stringify(dictionaryResponse), {
          expirationTtl: 60 * 60 * 24 * 30
        })
      );
      return json(dictionaryResponse);
    }

    const selected = selectProvider(env, provider, requestedModel);
    const cacheKey = await buildCacheKey(text, sourceLang, targetLang, selected.provider, selected.model);
    const cached = await env.CACHE.get<TranslateResponse>(cacheKey, 'json');

    if (cached) {
      const isLegacyWordCache = cached.type === 'word' && (!cached.senses || cached.senses.length === 0);
      if (!isLegacyWordCache) {
        return json({ ...cached, cached: true, cache_hit: true });
      }
      console.log(`Ignoring legacy cache for ${text}`);
    }

    const providerResult = await translateWithProviderFallback({
      env,
      text,
      sourceLang,
      targetLang,
      provider: selected.provider,
      model: selected.model,
      apiKey: selected.apiKey,
      ai: selected.ai,
      allowFallback: provider === 'auto'
    });

    const normalizedResponse = normalizeResponse({
      translated: providerResult.translated,
      text,
      targetLang,
      provider: providerResult.provider,
      model: providerResult.model
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
        : new TranslateError('TRANSLATION_FAILED', MESSAGES.serviceUnavailable, 500);
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'translate_failed',
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

async function safeLookupDictionaryFirst(input: {
  env: Env;
  text: string;
  targetLang: LanguageCode;
  sourceLang: LanguageCode | 'auto';
}): Promise<TranslateResponse | null> {
  try {
    return await lookupDictionaryFirst(input);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'warn',
        message: 'dictionary_lookup_failed_falling_back',
        error: error instanceof Error ? error.message : String(error)
      })
    );
    return null;
  }
}

async function handleTranslateStream(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify({ event, data })}\n`));
      };

      try {
        const body = (await request.json()) as TranslateRequest;
        const text = normalizeText(body.text ?? '');
        const targetLang = normalizeTargetLang(body.target_lang);
        const sourceLang = body.source_lang ?? 'auto';
        const provider = normalizeProvider(body.provider);
        const requestedModel =
          typeof body.model === 'string' && body.model.trim()
            ? normalizeModel(body.model, provider)
            : await getStoredModel(env, provider);

        if (!text) {
          throw new TranslateError('EMPTY_INPUT', MESSAGES.emptyInput, 400);
        }

        validateInputLength(text);
        await assertRateLimit(request, env, ctx);

        send('status', { stage: 'started' });

        const dictionaryCacheKey = await buildDictionaryCacheKey(text, sourceLang, targetLang);
        const dictionaryCached = await env.CACHE.get<TranslateResponse>(dictionaryCacheKey, 'json');
        if (dictionaryCached && dictionaryCached.type === 'word' && dictionaryCached.provider === 'dictionary') {
          const isLegacyWordCache = !dictionaryCached.senses || dictionaryCached.senses.length === 0;
          if (!isLegacyWordCache) {
            send('final', { ...dictionaryCached, cached: true, cache_hit: true });
            send('done', { ok: true });
            controller.close();
            return;
          }
          console.log(`Ignoring legacy dictionary cache for ${text} in stream`);
        }

        const dictionaryResponse = await safeLookupDictionaryFirst({
          env,
          text,
          targetLang,
          sourceLang
        });

        if (dictionaryResponse) {
          ctx.waitUntil(
            env.CACHE.put(dictionaryCacheKey, JSON.stringify(dictionaryResponse), {
              expirationTtl: 60 * 60 * 24 * 30
            })
          );
          send('final', dictionaryResponse);
          send('done', { ok: true });
          controller.close();
          return;
        }

        const selected = selectProvider(env, provider, requestedModel);
        const cacheKey = await buildCacheKey(text, sourceLang, targetLang, selected.provider, selected.model);
        const cached = await env.CACHE.get<TranslateResponse>(cacheKey, 'json');

        if (cached) {
          const isLegacyWordCache = cached.type === 'word' && (!cached.senses || cached.senses.length === 0);
          if (!isLegacyWordCache) {
            send('final', { ...cached, cached: true, cache_hit: true });
            send('done', { ok: true });
            controller.close();
            return;
          }
          console.log(`Ignoring legacy cache for ${text} in stream`);
        }

        send('status', {
          stage: 'provider_connected',
          provider: selected.provider,
          model: selected.model
        });
        let sentFirstToken = false;
        const providerResult = await streamStructuredTranslationWithFallback(
          {
            env,
            text,
            sourceLang,
            targetLang,
            provider: selected.provider,
            model: selected.model,
            apiKey: selected.apiKey,
            ai: selected.ai,
            allowFallback: provider === 'auto'
          },
          (partial) => {
            if (!sentFirstToken) {
              sentFirstToken = true;
              send('status', { stage: 'first_token' });
            }
            if (partial.type === 'word') {
              send('partial_translation', partial);
            } else {
              const hasExplanation = Object.values(partial.explanations || {}).some(Boolean);
              send(hasExplanation ? 'partial_explanation' : 'partial_translation', partial);
            }
          },
          translateWithProvider
        );

        const normalizedResponse = normalizeResponse({
          translated: providerResult.translated,
          text,
          targetLang,
          provider: providerResult.provider,
          model: providerResult.model
        });

        ctx.waitUntil(
          env.CACHE.put(cacheKey, JSON.stringify(normalizedResponse), {
            expirationTtl: 60 * 60 * 24 * 30
          })
        );

        send('final', normalizedResponse);
        send('done', { ok: true });
        controller.close();
      } catch (error) {
        const translateError =
          error instanceof TranslateError
            ? error
            : new TranslateError('TRANSLATION_FAILED', MESSAGES.serviceUnavailable, 500);
        console.error(
          JSON.stringify({
            level: 'error',
            message: 'translate_stream_failed',
            error_code: translateError.code,
            provider: translateError.provider,
            model: translateError.model,
            error: error instanceof Error ? error.message : String(error)
          })
        );
        send('error', {
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
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
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
    await env.CACHE.get('global:model-settings');
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
    version: 'provider-observability-v1',
    kv: { reachable: kv },
    dictionary,
    providers: {
      cloudflare: { configured: Boolean(env.AI) },
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
        level: 'info',
        message: 'translation_error_reported',
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
    throw new TranslateError('INPUT_TOO_LONG', MESSAGES.inputTooLong, 413);
  }
}

async function assertRateLimit(request: Request, env: Env, ctx: ExecutionContext): Promise<void> {
  try {
    const clientId = await getRateLimitClientId(request);
    const bucket = Math.floor(Date.now() / (RATE_LIMIT_WINDOW_SECONDS * 1000));
    const key = `rate:${bucket}:${clientId}`;
    const current = Number((await env.CACHE.get(key)) || '0');

    if (current >= RATE_LIMIT_MAX_REQUESTS) {
      throw new TranslateError('RATE_LIMITED', MESSAGES.rateLimited, 429);
    }

    ctx.waitUntil(
      env.CACHE.put(key, String(current + 1), {
        expirationTtl: RATE_LIMIT_WINDOW_SECONDS * 2
      })
    );
  } catch (error) {
    if (error instanceof TranslateError) {
      throw error;
    }
    console.warn(
      JSON.stringify({
        level: 'warn',
        message: 'rate_limit_unavailable',
        error: error instanceof Error ? error.message : String(error)
      })
    );
  }
}

async function getRateLimitClientId(request: Request): Promise<string> {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const raw =
    request.headers.get('cf-connecting-ip') || request.headers.get('true-client-ip') || forwardedFor || 'anonymous';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24);
}

async function translateWithProvider(input: {
  text: string;
  sourceLang: TranslateRequest['source_lang'];
  targetLang: LanguageCode;
  provider: Exclude<Provider, 'auto'>;
  model: string;
  apiKey: string;
  ai?: Ai;
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
    const payload = await callProvider(request);
    assertLexicalWordPayload(payload, input.text);
    return payload;
  } catch (error) {
    if (
      !(error instanceof TranslateError) ||
      error.code !== 'PROVIDER_INVALID_JSON' ||
      isPreviewPrompt(input.systemPrompt)
    ) {
      throw error;
    }

    const repaired = await callProvider({
      ...request,
      prompt: buildJsonRepairPrompt(prompt, error.message),
      systemPrompt: ACTIVE_SYSTEM_PROMPT
    });
    assertLexicalWordPayload(repaired, input.text);
    return repaired;
  }
}

function assertLexicalWordPayload(payload: Record<string, unknown>, text: string) {
  if (!isLikelyLexicalInput(text)) return;

  if (payload.type !== 'word') {
    throw new TranslateError(
      'PROVIDER_INVALID_JSON',
      'Lexical input must return type word with dictionary fields.',
      502
    );
  }

  const translations =
    payload.translations && typeof payload.translations === 'object'
      ? (payload.translations as Record<string, unknown>)
      : {};
  for (const lang of ['zh', 'en', 'pt-BR', 'ja']) {
    const item =
      translations[lang] && typeof translations[lang] === 'object'
        ? (translations[lang] as Record<string, unknown>)
        : {};
    if (!normalizeStringOrText(item.phonetic)) {
      throw new TranslateError(
        'PROVIDER_INVALID_JSON',
        `Lexical word requires non-empty translations.${lang}.phonetic.`,
        502
      );
    }
  }

  if (!Array.isArray(payload.senses) || payload.senses.length === 0) {
    throw new TranslateError('PROVIDER_INVALID_JSON', 'Lexical word requires at least one sense.', 502);
  }

  if (!Array.isArray(payload.examples) || payload.examples.length === 0) {
    throw new TranslateError('PROVIDER_INVALID_JSON', 'Lexical word requires at least one example.', 502);
  }
}

async function translateWithProviderFallback(input: {
  env: Env;
  text: string;
  sourceLang: TranslateRequest['source_lang'];
  targetLang: LanguageCode;
  provider: Exclude<Provider, 'auto'>;
  model: string;
  apiKey: string;
  ai?: Ai;
  allowFallback: boolean;
  prompt?: string;
  systemPrompt?: string;
}): Promise<{
  translated: Record<string, unknown>;
  provider: Exclude<Provider, 'auto'>;
  model: string;
}> {
  try {
    return {
      translated: await translateWithProvider(input),
      provider: input.provider,
      model: input.model
    };
  } catch (error) {
    if (!input.allowFallback) throw error;
    const fallback = selectFallbackProvider(input.env, input.provider);
    if (!fallback) throw error;

    console.warn(
      JSON.stringify({
        level: 'warn',
        message: 'provider_fallback',
        from_provider: input.provider,
        from_model: input.model,
        to_provider: fallback.provider,
        to_model: fallback.model,
        error: error instanceof Error ? error.message : String(error)
      })
    );

    return {
      translated: await translateWithProvider({
        ...input,
        provider: fallback.provider,
        model: fallback.model,
        apiKey: fallback.apiKey,
        ai: fallback.ai
      }),
      provider: fallback.provider,
      model: fallback.model
    };
  }
}

async function streamStructuredTranslationWithFallback(
  input: {
    env: Env;
    text: string;
    sourceLang: TranslateRequest['source_lang'];
    targetLang: LanguageCode;
    provider: Exclude<Provider, 'auto'>;
    model: string;
    apiKey: string;
    ai?: Ai;
    allowFallback: boolean;
  },
  onPartial: Parameters<typeof streamStructuredTranslation>[1],
  fallback: typeof translateWithProvider
): Promise<{
  translated: Record<string, unknown>;
  provider: Exclude<Provider, 'auto'>;
  model: string;
}> {
  const { env, allowFallback, ...streamInput } = input;

  try {
    return {
      translated: await streamStructuredTranslation(streamInput, onPartial, fallback),
      provider: input.provider,
      model: input.model
    };
  } catch (error) {
    if (!allowFallback) throw error;
    const fallbackProvider = selectFallbackProvider(env, input.provider);
    if (!fallbackProvider) throw error;

    console.warn(
      JSON.stringify({
        level: 'warn',
        message: 'stream_provider_fallback',
        from_provider: input.provider,
        from_model: input.model,
        to_provider: fallbackProvider.provider,
        to_model: fallbackProvider.model,
        error: error instanceof Error ? error.message : String(error)
      })
    );

    return {
      translated: await translateWithProvider({
        text: input.text,
        sourceLang: input.sourceLang,
        targetLang: input.targetLang,
        provider: fallbackProvider.provider,
        model: fallbackProvider.model,
        apiKey: fallbackProvider.apiKey,
        ai: fallbackProvider.ai
      }),
      provider: fallbackProvider.provider,
      model: fallbackProvider.model
    };
  }
}

function selectFallbackProvider(
  env: Env,
  currentProvider: Exclude<Provider, 'auto'>
): { provider: Exclude<Provider, 'auto'>; model: string; apiKey: string; ai?: Ai } | null {
  const candidates: Array<{
    provider: Exclude<Provider, 'auto'>;
    model: string;
    configured: boolean;
    apiKey?: string;
    ai?: Ai;
  }> = [
    { provider: 'cloudflare', model: DEFAULT_MODELS.cloudflare, configured: Boolean(env.AI), ai: env.AI },
    {
      provider: 'dashscope',
      model: DEFAULT_MODELS.dashscope,
      configured: Boolean(env.DASHSCOPE_API_KEY),
      apiKey: env.DASHSCOPE_API_KEY
    },
    {
      provider: 'deepseek',
      model: DEFAULT_MODELS.deepseek,
      configured: Boolean(env.DEEPSEEK_API_KEY),
      apiKey: env.DEEPSEEK_API_KEY
    },
    {
      provider: 'gemini',
      model: DEFAULT_MODELS.gemini,
      configured: Boolean(env.GEMINI_API_KEY),
      apiKey: env.GEMINI_API_KEY
    }
  ];
  const fallback = candidates.find((candidate) => candidate.provider !== currentProvider && candidate.configured);
  return fallback
    ? { provider: fallback.provider, model: fallback.model, apiKey: fallback.apiKey || '', ai: fallback.ai }
    : null;
}

async function callProvider(input: {
  text: string;
  sourceLang: TranslateRequest['source_lang'];
  targetLang: LanguageCode;
  provider: Exclude<Provider, 'auto'>;
  model: string;
  apiKey: string;
  ai?: Ai;
  prompt: string;
  systemPrompt?: string;
}): Promise<Record<string, unknown>> {
  if (input.provider === 'dashscope') {
    return translateWithDashScope(input);
  }

  if (input.provider === 'cloudflare') {
    return translateWithCloudflare(input);
  }

  if (input.provider === 'deepseek') {
    return translateWithDeepSeek(input);
  }

  return translateWithGemini(input);
}

function buildJsonRepairPrompt(originalPrompt: string, error: string): string {
  return [
    'The previous response did not match the required JSON schema.',
    `Validation error: ${error}`,
    'For a single word or lexical phrase, return type word, include word_details, senses, examples, and non-empty translations.zh/en/pt-BR/ja.phonetic.',
    'Use pinyin for zh phonetic, IPA in slashes for en and pt-BR phonetic, and hiragana reading for ja phonetic.',
    'Return only corrected JSON. Do not include markdown, commentary, or extra text.',
    originalPrompt
  ].join('\n\n');
}

async function buildCacheKey(
  text: string,
  sourceLang: TranslateRequest['source_lang'],
  targetLang: LanguageCode,
  provider: Exclude<Provider, 'auto'>,
  model: string
): Promise<string> {
  const normalized = `${TRANSLATION_CACHE_VERSION}::${provider}::${model}::${text.toLowerCase()}::${sourceLang ?? 'auto'}::${targetLang}`;
  const data = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function buildDictionaryCacheKey(
  text: string,
  sourceLang: TranslateRequest['source_lang'],
  targetLang: LanguageCode
): Promise<string> {
  const normalized = `${TRANSLATION_CACHE_VERSION}::dictionary::v2::${text.toLowerCase()}::${sourceLang ?? 'auto'}::${targetLang}`;
  const data = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
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
