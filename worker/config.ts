import type { Provider } from './types';

export const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

export const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type'
};

export const MESSAGES = {
  emptyInput: '\u8bf7\u8f93\u5165\u8981\u7ffb\u8bd1\u7684\u5185\u5bb9\u3002',
  inputTooLong: '\u8f93\u5165\u8fc7\u957f\uff0c\u8bf7\u63a7\u5236\u5728 1200 \u4e2a\u5b57\u7b26\u4ee5\u5185\u3002',
  rateLimited: '\u8bf7\u6c42\u8fc7\u4e8e\u9891\u7e41\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002',
  serviceUnavailable:
    '\u7ffb\u8bd1\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u8bf7\u68c0\u67e5 API Key\u3001\u5e73\u53f0\u6216\u6a21\u578b\u540d\u79f0\u3002'
};

export const DEFAULT_MODELS: Record<Provider, string> = {
  auto: '@cf/zai-org/glm-4.7-flash',
  cloudflare: '@cf/zai-org/glm-4.7-flash',
  dashscope: 'qwen3.6-flash',
  gemini: 'gemini-3.5-flash',
  deepseek: 'deepseek-v4-flash'
};

export const MODEL_OPTIONS_VERSION = 6;
export const EDITABLE_PROVIDERS: Exclude<Provider, 'auto'>[] = ['cloudflare', 'dashscope', 'gemini', 'deepseek'];

export const MODEL_OPTIONS: Record<Provider, string[]> = {
  auto: ['@cf/zai-org/glm-4.7-flash'],
  cloudflare: [
    '@cf/zai-org/glm-4.7-flash',
    '@cf/google/gemma-4-26b-a4b-it',
    '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    '@cf/qwen/qwen3-30b-a3b-fp8',
    '@cf/openai/gpt-oss-20b'
  ],
  dashscope: [
    'qwen3.6-flash',
    'qwen3.6-35b-a3b',
    'glm-5.1',
    'qwen3.6-plus-2026-04-02',
    'qwen3.6-plus',
    'qwen3.5-plus-2026-04-20',
    'qwen3.6-max-preview',
    'qwen3.7-max',
    'kimi-k2.6',
    'qwen3.7-max-2026-05-20',
    'qwen-flash-character-2026-02-26',
    'deepseek-v4-pro',
    'qwen3.6-27b',
    'gui-plus-2026-02-26',
    'deepseek-v4-flash'
  ],
  gemini: ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview', 'gemini-2.5-flash', 'gemini-2.5-pro'],
  deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro']
};

export const TRANSLATION_CACHE_VERSION = 'v147-localized-sense-repair';
export const PREVIEW_TIMEOUT_MS = 10_000;
export const FULL_TRANSLATION_TIMEOUT_MS = 30_000;
export const MAX_INPUT_CHARS = 1200;
export const RATE_LIMIT_WINDOW_SECONDS = 60;
export const RATE_LIMIT_MAX_REQUESTS = 30;
