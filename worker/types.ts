export interface Env {
  ASSETS: Fetcher;
  CACHE: KVNamespace;
  OPENROUTER_API_KEY?: string;
  DASHSCOPE_API_KEY?: string;
  GEMINI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  DICTIONARY_API_URL?: string;
  DICTIONARY_API_TOKEN?: string;
}

export type LanguageCode = "en" | "zh" | "pt-BR" | "ja";
export type DisplayLanguageCode = LanguageCode;
export type Provider = "auto" | "openrouter" | "dashscope" | "gemini" | "deepseek";
export type ResponseProvider = Exclude<Provider, "auto"> | "dictionary";
export type ErrorCode =
  | "EMPTY_INPUT"
  | "INPUT_TOO_LONG"
  | "RATE_LIMITED"
  | "PROVIDER_CONFIG_MISSING"
  | "PROVIDER_API_ERROR"
  | "PROVIDER_EMPTY_RESPONSE"
  | "PROVIDER_INVALID_JSON"
  | "TRANSLATION_FAILED";

export interface LocalizedText {
  text: string;
  phonetic: string;
  audio_text: string;
}

export interface TranslateRequest {
  text?: string;
  source_lang?: LanguageCode | "auto";
  target_lang?: LanguageCode;
  provider?: Provider;
  model?: string;
}

export interface WordExample {
  sentence: string;
  translations: Record<LanguageCode, string>;
}

export interface WordDetail {
  word: string;
  definition: string;
}

export interface WordSense {
  sense_order: number;
  part_of_speech: string;
  gloss_key: string;
  definitions: Record<DisplayLanguageCode, string>;
}

export interface BaseResponse {
  detected_source_lang: string;
  target_lang: LanguageCode;
  original: string;
  translation: string;
  translations: Record<DisplayLanguageCode, LocalizedText>;
  provider: ResponseProvider;
  model: string;
  cached: boolean;
}

export interface WordResponse extends BaseResponse {
  type: "word";
  phonetic: string;
  audio_text: string;
  examples: WordExample[];
  word_details: Record<DisplayLanguageCode, WordDetail>;
  senses?: WordSense[];
}

export interface SentenceResponse extends BaseResponse {
  type: "sentence";
  explanation: string;
  explanations: Record<DisplayLanguageCode, string>;
}

export type TranslateResponse = WordResponse | SentenceResponse;
