import type { LanguageCode, Provider, TranslateRequest } from './types';
import { TRANSLATION_CACHE_VERSION } from './config';

export async function buildCacheKey(
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

export async function buildDictionaryCacheKey(
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
