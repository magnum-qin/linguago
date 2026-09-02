import type { Env } from './types';
import { TranslateError } from './errors';
import {
  MAX_INPUT_CHARS,
  MESSAGES,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_SECONDS
} from './config';

export function validateInputLength(text: string): void {
  if (text.length > MAX_INPUT_CHARS) {
    throw new TranslateError('INPUT_TOO_LONG', MESSAGES.inputTooLong, 413);
  }
}

export async function assertRateLimit(request: Request, env: Env, ctx: ExecutionContext): Promise<void> {
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

export async function getRateLimitClientId(request: Request): Promise<string> {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const raw =
    request.headers.get('cf-connecting-ip') || request.headers.get('true-client-ip') || forwardedFor || 'anonymous';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24);
}
