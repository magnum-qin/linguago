import type {
  Env,
  LanguageCode,
  Provider,
  TranslateRequest
} from './types';
import { TranslateError } from './errors';
import { DEFAULT_MODELS } from './config';
import { isLikelyLexicalInput, normalizeStringOrText } from './normalization';
import {
  translateWithCloudflare,
  translateWithDashScope,
  translateWithDeepSeek,
  translateWithGemini
} from './provider-clients';
import { ACTIVE_SYSTEM_PROMPT, buildUserPrompt, isPreviewPrompt, selectProviderSystemPrompt } from './prompts';
import { streamStructuredTranslation } from './streaming';

export async function translateWithProvider(input: {
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

export function assertLexicalWordPayload(payload: Record<string, unknown>, text: string): void {
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

export async function translateWithProviderFallback(input: {
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

export async function streamStructuredTranslationWithFallback(
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

export function selectFallbackProvider(
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

export async function callProvider(input: {
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

export function buildJsonRepairPrompt(originalPrompt: string, error: string): string {
  return [
    'The previous response did not match the required JSON schema.',
    `Validation error: ${error}`,
    'For a single word or lexical phrase, return type word, include word_details, senses, examples, and non-empty translations.zh/en/pt-BR/ja.phonetic.',
    'Use pinyin for zh phonetic, IPA in slashes for en and pt-BR phonetic, and hiragana reading for ja phonetic.',
    'Return only corrected JSON. Do not include markdown, commentary, or extra text.',
    originalPrompt
  ].join('\n\n');
}
