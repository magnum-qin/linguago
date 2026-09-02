/**
 * Core Translation & Dictionary V2 Domain Types for Frontend
 */

export type SupportedLanguage = 'en' | 'pt-BR' | 'zh' | 'ja';

export interface LocalizedText {
  text: string;
  phonetic?: string;
  audio_text?: string;
}

export interface WordSenseLocalization {
  term?: string;
  reading?: string;
  reading_system?: string;
  pronunciation?: string;
  pronunciation_system?: string;
  definition: string;
  usage_note?: string;
}

export interface PronunciationGroupSummary {
  lang: string;
  reading: string;
  reading_key?: string;
  reading_system?: string;
}

export interface WordSense {
  sense_order: number;
  part_of_speech?: string;
  gloss_key?: string;
  definitions?: Partial<Record<SupportedLanguage | string, string>>;
  localizations?: Partial<Record<SupportedLanguage | string, WordSenseLocalization>>;
  domain?: string;
  register_label?: string;
  verification_level?: 'verified' | 'ai_reviewed';
  review_model?: string;
  evidence_families?: string[];
  examples?: WordExample[];
  pronunciation_group?: PronunciationGroupSummary;
}

export interface WordPronunciationGroup extends PronunciationGroupSummary {
  group_order?: number;
  audio_text?: string;
  senses: WordSense[];
}

export interface WordExample {
  sentence: string;
  translations?: Partial<Record<SupportedLanguage | string, string>>;
  source_lang?: string;
  source_reading?: string;
  localizations?: Partial<
    Record<
      SupportedLanguage | string,
      {
        text: string;
        reading?: string;
      }
    >
  >;
}

export interface WordDetail {
  word: string;
  definition: string;
}

export interface BaseTranslateResponse {
  detected_source_lang: string;
  target_lang?: string;
  original: string;
  translation: string;
  translations?: Partial<Record<SupportedLanguage | string, LocalizedText>>;
  provider: string;
  model?: string;
  cached?: boolean;
  cache_hit?: boolean;
}

export interface WordResponse extends BaseTranslateResponse {
  type: 'word';
  phonetic?: string;
  audio_text?: string;
  examples?: WordExample[];
  word_details?: Partial<Record<SupportedLanguage | string, WordDetail>>;
  senses?: WordSense[];
  pronunciation_groups?: WordPronunciationGroup[];
  related_entries?: Array<{
    headword: string;
    source_lang: string;
    reading?: string;
    summary?: string;
  }>;
}

export interface SentenceResponse extends BaseTranslateResponse {
  type: 'sentence';
  explanation?: string;
  explanations?: Partial<Record<SupportedLanguage | string, string>>;
}

export type TranslateResponse = WordResponse | SentenceResponse;

export interface TranslatePayload {
  text: string;
  source_lang?: string;
  target_lang?: string;
  provider?: string;
  model?: string;
}

export interface RemoteModelsResponse {
  version?: number;
  defaults?: Record<string, string>;
  options?: Record<string, string[]>;
  [key: string]: unknown;
}

export interface AppSettings {
  default_target_lang: string;
  provider: string;
  model: string;
  theme: string;
  auto_copy: boolean;
  auto_speech: boolean;
  [key: string]: unknown;
}

export interface ErrorReportPayload {
  term: string;
  lang: string;
  issue_type: string;
  description: string;
  user_agent?: string;
}
