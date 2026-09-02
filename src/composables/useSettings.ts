import { reactive, watch } from 'vue';
import { fetchRemoteSettings, fetchRemoteModels, saveRemoteSettings } from '../utils/api';

export const HISTORY_KEY = 'linguago-history-v5';
export const SETTINGS_KEY = 'linguago-settings-v1';
export const THEME_SETTINGS_VERSION = 2;
export const MODEL_OPTIONS_VERSION = 6;

export const RESULT_LANGUAGES = [
  { code: 'en', label: 'EN', speech: 'en-US' },
  { code: 'pt-BR', label: 'PT', speech: 'pt-BR' },
  { code: 'zh', label: '中', speech: 'zh-CN' },
  { code: 'ja', label: '日', speech: 'ja-JP' }
];

export const LANGUAGES = Object.fromEntries(RESULT_LANGUAGES.map((language) => [language.code, language]));

export const DEFAULT_MODELS: Record<string, string> = {
  auto: '@cf/zai-org/glm-4.7-flash',
  cloudflare: '@cf/zai-org/glm-4.7-flash',
  dashscope: 'qwen3.6-flash',
  gemini: 'gemini-2.5-flash',
  deepseek: 'deepseek-v4-flash'
};

export const PROVIDERS = ['auto', 'cloudflare', 'dashscope', 'gemini', 'deepseek'];
export const EDITABLE_PROVIDERS = ['cloudflare', 'dashscope', 'gemini', 'deepseek'];

export const DEFAULT_MODEL_OPTIONS: Record<string, string[]> = {
  auto: ['@cf/zai-org/glm-4.7-flash'],
  cloudflare: [
    '@cf/zai-org/glm-4.7-flash',
    '@cf/google/gemma-4-26b-a4b-it',
    '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    '@cf/qwen/qwen3-30b-a3b-fp8',
    '@cf/openai/gpt-oss-20b'
  ],
  dashscope: ['qwen3.6-flash', 'qwen3.6-35b-a3b', 'glm-5.1', 'deepseek-v4-pro', 'deepseek-v4-flash'],
  gemini: ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro'],
  deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro']
};

export function uniqueModels(models: string[]) {
  const seen = new Set();
  return models
    .map((model) => String(model || '').trim())
    .filter(Boolean)
    .filter((model) => {
      const key = model.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeModelOptions(value: any = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(
    PROVIDERS.map((provider) => {
      const defaults = DEFAULT_MODEL_OPTIONS[provider] || [DEFAULT_MODELS[provider]].filter(Boolean);
      const models = Array.isArray(source[provider]) ? uniqueModels(source[provider]) : uniqueModels(defaults);
      return [provider, models.length ? models : [DEFAULT_MODELS[provider] || DEFAULT_MODELS.auto]];
    })
  );
}

function normalizeTheme(theme: string) {
  return ['light', 'dark', 'system'].includes(theme) ? theme : 'system';
}

function readSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    const theme = stored.themeSettingsVersion === THEME_SETTINGS_VERSION ? normalizeTheme(stored.theme) : 'system';
    const provider = PROVIDERS.includes(stored.provider) ? stored.provider : 'auto';
    return {
      ...stored,
      provider,
      model: provider === stored.provider && stored.model ? stored.model : DEFAULT_MODELS[provider],
      modelOptions: normalizeModelOptions(
        stored.modelOptionsVersion === MODEL_OPTIONS_VERSION ? stored.modelOptions : {}
      ),
      modelOptionsVersion: MODEL_OPTIONS_VERSION,
      theme,
      colorScheme: stored.colorScheme || 'blue',
      themeSettingsVersion: THEME_SETTINGS_VERSION
    };
  } catch {
    return {
      provider: 'auto',
      model: DEFAULT_MODELS.auto,
      modelOptions: normalizeModelOptions(),
      modelOptionsVersion: MODEL_OPTIONS_VERSION,
      theme: 'system',
      colorScheme: 'blue',
      themeSettingsVersion: THEME_SETTINGS_VERSION
    };
  }
}

export const settings = reactive(readSettings());

// Automatically save to localStorage when settings change
watch(
  settings,
  (newSettings) => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
  },
  { deep: true }
);

export function getModelsForProvider(provider: string) {
  settings.modelOptions = normalizeModelOptions(settings.modelOptions);
  return (
    settings.modelOptions[provider] ||
    DEFAULT_MODEL_OPTIONS[provider] || [DEFAULT_MODELS[provider] || DEFAULT_MODELS.auto]
  );
}

export async function loadRemoteModels() {
  try {
    const data = await fetchRemoteModels();
    const remoteVersion = Number(data.version || 0);
    const remoteModelOptions: Record<string, string[]> = {};
    for (const provider of PROVIDERS) {
      const defaultModel = String(data.defaults?.[provider] || '').trim();
      if (defaultModel) {
        DEFAULT_MODELS[provider] = defaultModel;
      }

      const models = uniqueModels(data.options?.[provider] || []);
      if (models.length) {
        DEFAULT_MODEL_OPTIONS[provider] = models;
        remoteModelOptions[provider] = models;
      }
    }

    const shouldRefreshOptions = remoteVersion && remoteVersion > Number(settings.modelOptionsVersion || 0);
    settings.modelOptions = normalizeModelOptions({
      ...(shouldRefreshOptions ? {} : settings.modelOptions),
      ...remoteModelOptions
    });
    settings.modelOptionsVersion = remoteVersion || MODEL_OPTIONS_VERSION;

    const models = getModelsForProvider(settings.provider);
    if (!models.includes(settings.model)) {
      settings.model = models[0] || DEFAULT_MODELS[settings.provider] || DEFAULT_MODELS.auto;
    }
  } catch (e) {
    console.error('Failed to load remote models', e);
  }
}

export async function loadRemoteSettings() {
  try {
    const data = await fetchRemoteSettings();
    if (data.model) {
      settings.provider = data.provider || settings.provider;
      settings.model = data.model;
    }
  } catch (e) {
    console.error('Failed to load remote settings', e);
  }
}
