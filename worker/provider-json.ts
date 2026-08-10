import { TranslateError } from './errors';
import type { ResponseProvider } from './types';

export function parseProviderJson(
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
      'PROVIDER_INVALID_JSON',
      `Provider returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      502,
      provider,
      model
    );
  }

  const errors = validateProviderPayload(payload, preview);
  if (errors.length) {
    throw new TranslateError(
      'PROVIDER_INVALID_JSON',
      `Provider JSON failed schema validation: ${errors.join('; ')}`,
      502,
      provider,
      model
    );
  }

  return payload as Record<string, unknown>;
}

function validateProviderPayload(payload: unknown, preview: boolean): string[] {
  const errors: string[] = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return ['root must be an object'];
  }

  const item = payload as Record<string, unknown>;
  const type = normalizeStringOrText(item.type);
  if (preview) {
    if (type !== 'sentence') errors.push('type must be sentence');
    requireString(item, 'detected_source_lang', errors);
    requireString(item, 'translation', errors);
    requireString(item, 'explanation', errors);
    return errors;
  }

  if (type !== 'word' && type !== 'sentence') {
    errors.push('type must be word or sentence');
  }
  requireString(item, 'detected_source_lang', errors);
  requireString(item, 'translation', errors);
  validateTranslations(item.translations, errors);

  if (type === 'sentence') {
    const explanations =
      item.explanations && typeof item.explanations === 'object'
        ? (item.explanations as Record<string, unknown>)
        : null;
    if (!explanations && !normalizeStringOrText(item.explanation)) {
      errors.push('sentence requires explanations or explanation');
    }
  }

  if (type === 'word') {
    validateWordTranslationPronunciations(item.translations, errors);

    const details =
      item.word_details && typeof item.word_details === 'object'
        ? (item.word_details as Record<string, unknown>)
        : null;
    if (!details) {
      errors.push('word requires word_details');
    } else {
      validateWordDetails(details, errors);
    }

    validateWordSenses(item.senses, errors);
    validateWordExamples(item.examples, errors);
  }

  return errors;
}

function validateWordTranslationPronunciations(value: unknown, errors: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return;
  }

  const translations = value as Record<string, unknown>;
  for (const lang of ['zh', 'en', 'pt-BR', 'ja']) {
    const translation = translations[lang];
    if (!translation || typeof translation !== 'object' || Array.isArray(translation)) {
      continue;
    }
    requireString(translation as Record<string, unknown>, 'phonetic', errors, `translations.${lang}`);
  }
}

function validateWordDetails(value: Record<string, unknown>, errors: string[]) {
  for (const lang of ['zh', 'en', 'pt-BR', 'ja']) {
    const detail = value[lang];
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
      errors.push(`word_details.${lang} must be an object`);
      continue;
    }
    requireString(detail as Record<string, unknown>, 'word', errors, `word_details.${lang}`);
    requireString(detail as Record<string, unknown>, 'definition', errors, `word_details.${lang}`);
  }
}

function validateWordSenses(value: unknown, errors: string[]) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push('word requires at least one sense');
    return;
  }

  for (const [index, sense] of value.entries()) {
    if (!sense || typeof sense !== 'object' || Array.isArray(sense)) {
      errors.push(`senses.${index} must be an object`);
      continue;
    }

    const item = sense as Record<string, unknown>;
    const definitions =
      item.definitions && typeof item.definitions === 'object' ? (item.definitions as Record<string, unknown>) : null;
    if (!definitions) {
      errors.push(`senses.${index}.definitions must be an object`);
      continue;
    }

    for (const lang of ['zh', 'en', 'pt-BR', 'ja']) {
      requireString(definitions, lang, errors, `senses.${index}.definitions`);
    }
  }
}

function validateWordExamples(value: unknown, errors: string[]) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push('word requires at least one example');
    return;
  }

  for (const [index, example] of value.entries()) {
    if (!example || typeof example !== 'object' || Array.isArray(example)) {
      errors.push(`examples.${index} must be an object`);
      continue;
    }

    const item = example as Record<string, unknown>;
    requireString(item, 'sentence', errors, `examples.${index}`);
    validateTranslationsAsStrings(item.translations, errors, `examples.${index}.translations`);
  }
}

function validateTranslationsAsStrings(value: unknown, errors: string[], prefix: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${prefix} must be an object`);
    return;
  }

  const translations = value as Record<string, unknown>;
  for (const lang of ['zh', 'en', 'pt-BR', 'ja']) {
    requireString(translations, lang, errors, prefix);
  }
}

function validateTranslations(value: unknown, errors: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push('translations must be an object');
    return;
  }

  const translations = value as Record<string, unknown>;
  for (const lang of ['zh', 'en', 'pt-BR', 'ja']) {
    const translation = translations[lang];
    if (!translation || typeof translation !== 'object' || Array.isArray(translation)) {
      errors.push(`translations.${lang} must be an object`);
      continue;
    }
    requireString(translation as Record<string, unknown>, 'text', errors, `translations.${lang}`);
  }
}

function requireString(item: Record<string, unknown>, key: string, errors: string[], prefix?: string) {
  if (!normalizeStringOrText(item[key])) {
    errors.push(`${prefix ? `${prefix}.` : ''}${key} must be a non-empty string`);
  }
}

function stripJsonFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function normalizeStringOrText(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'object') {
    const item = value as Record<string, unknown>;
    return String(item.text ?? item.translation ?? '');
  }
  return String(value);
}
