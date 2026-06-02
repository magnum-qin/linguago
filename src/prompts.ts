import type { Provider } from "./types";
import type { LanguageCode, TranslateRequest } from "./types";

export const SYSTEM_PROMPT = `You are a translation engine for a mobile PWA.
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

export const PREVIEW_SYSTEM_PROMPT = `You are a fast translation preview engine.
Return valid JSON only. Never wrap JSON in markdown fences.

Return only this compact shape:
{
  "type": "sentence",
  "detected_source_lang": "en",
  "translation": "natural translation in the requested target language",
  "explanation": "one concise explanation in the requested target language"
}

Keep the translation natural and concise. Do not include other languages, phonetics, examples, or markdown.`;

export const ACTIVE_SYSTEM_PROMPT = `You are a translation engine for a mobile PWA.
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

export const GEMINI_SYSTEM_PROMPT = `Translate the input for a mobile language-learning app.
Follow the provided JSON schema exactly.
Use zh, en, pt-BR, and ja fields in their own languages.
For word definitions, write concise definitions only; no pronunciation, part-of-speech labels, markdown, or cross-language equivalents.
Do not copy schema descriptions or placeholder wording.`;

export const GEMINI_PREVIEW_SYSTEM_PROMPT = `Translate the input into the requested target language.
Follow the provided JSON schema exactly.
Return a natural translation and one concise explanation only.`;

export const DEEPSEEK_SYSTEM_PROMPT = `You are a translation engine. Return valid json only.
The user provides source language, target language, and text.
Output this JSON shape exactly:
{"type":"sentence","detected_source_lang":"zh","translation":"target-language text","translations":{"zh":{"text":"简体中文"},"en":{"text":"English"},"pt-BR":{"text":"Português do Brasil"},"ja":{"text":"日本語"}},"explanations":{"zh":"简短中文解释","en":"Brief English explanation","pt-BR":"Breve explicação em português","ja":"短い日本語の説明"}}
For a single word, set type to "word" and also include word_details and examples. Definitions must be concise and written only in their own language.`;

export const DEEPSEEK_PREVIEW_SYSTEM_PROMPT = `Return valid json only.
Output this JSON shape exactly:
{"type":"sentence","detected_source_lang":"zh","translation":"target-language text","explanation":"brief explanation in target language"}`;

export const DASH_SCOPE_SYSTEM_PROMPT = `You are a translation engine. Return valid JSON only.
The user provides source language, target language, and text.
Return zh, en, pt-BR, and ja fields in their own languages.
For word definitions, write concise definitions only; no pronunciation, markdown, or cross-language equivalents.
Use the same JSON shape as the translation API schema.`;

export const DASH_SCOPE_PREVIEW_SYSTEM_PROMPT = `Return valid JSON only.
Translate into the requested target language and return:
{"type":"sentence","detected_source_lang":"zh","translation":"target-language text","explanation":"brief explanation in target language"}`;

export const OPENROUTER_SYSTEM_PROMPT = `Translate the input for a mobile language-learning app.
Follow the JSON schema exactly.
Use zh, en, pt-BR, and ja fields in their own languages.
For word definitions, write concise definitions only; no pronunciation, markdown, or cross-language equivalents.`;

export const OPENROUTER_PREVIEW_SYSTEM_PROMPT = `Translate into the requested target language.
Follow the JSON schema exactly.
Return a natural translation and one concise explanation only.`;

export function isPreviewPrompt(systemPrompt?: string): boolean {
  return systemPrompt === PREVIEW_SYSTEM_PROMPT ||
    systemPrompt === GEMINI_PREVIEW_SYSTEM_PROMPT ||
    systemPrompt === DEEPSEEK_PREVIEW_SYSTEM_PROMPT ||
    systemPrompt === DASH_SCOPE_PREVIEW_SYSTEM_PROMPT ||
    systemPrompt === OPENROUTER_PREVIEW_SYSTEM_PROMPT;
}

export function selectProviderSystemPrompt(
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

export function buildUserPrompt(
  text: string,
  sourceLang: TranslateRequest["source_lang"],
  targetLang: LanguageCode
): string {
  return [
    `Source language: ${sourceLang}`,
    `Target language: ${targetLang}`,
    `When returning language-keyed JSON, put ${targetLang} first, then ${orderedLanguageCodes(targetLang).filter((lang) => lang !== targetLang).join(", ")}.`,
    `Text: ${text}`
  ].join("\n");
}

function orderedLanguageCodes(targetLang: LanguageCode): LanguageCode[] {
  const languages: LanguageCode[] = ["en", "pt-BR", "zh", "ja"];
  return [targetLang, ...languages.filter((language) => language !== targetLang)];
}
