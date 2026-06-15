export const FULL_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: ["word", "sentence"],
      description: "Use word for a single lexical item; use sentence for phrases or sentences."
    },
    detected_source_lang: {
      type: "string",
      description: "Detected source language code, such as zh, en, pt-BR, ja, or auto."
    },
    translation: {
      type: "string",
      description: "Main translation in the requested target language."
    },
    translations: {
      type: "object",
      properties: {
        zh: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "Simplified Chinese translation text only."
            },
            phonetic: {
              type: "string",
              description: "Pinyin reading for the whole Chinese term or phrase, with tone marks."
            },
            audio_text: {
              type: "string",
              description: "Plain text suitable for text-to-speech, without inline reading markup."
            }
          },
          required: ["text"]
        },
        en: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "English translation text only."
            },
            phonetic: {
              type: "string",
              description: "IPA pronunciation for the whole English term or phrase, wrapped in slashes."
            },
            audio_text: {
              type: "string",
              description: "Plain text suitable for text-to-speech, without inline IPA markup."
            }
          },
          required: ["text"]
        },
        "pt-BR": {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "Brazilian Portuguese translation text only."
            },
            phonetic: {
              type: "string",
              description: "IPA pronunciation for the whole Brazilian Portuguese term or phrase, wrapped in slashes."
            },
            audio_text: {
              type: "string",
              description: "Plain text suitable for text-to-speech, without inline IPA markup."
            }
          },
          required: ["text"]
        },
        ja: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "Japanese translation text only."
            },
            phonetic: {
              type: "string",
              description: "Hiragana reading for the whole Japanese term or phrase."
            },
            audio_text: {
              type: "string",
              description: "Plain text suitable for text-to-speech, without inline reading markup."
            }
          },
          required: ["text"]
        }
      },
      required: ["zh", "en", "pt-BR", "ja"]
    },
    explanations: {
      type: "object",
      properties: {
        zh: {
          type: "string",
          description: "Simplified Chinese explanation for this exact sentence. Do not use Japanese kana or Portuguese."
        },
        en: {
          type: "string",
          description: "English explanation for this exact sentence."
        },
        "pt-BR": {
          type: "string",
          description: "Brazilian Portuguese explanation for this exact sentence."
        },
        ja: {
          type: "string",
          description: "Japanese explanation for this exact sentence."
        }
      }
    },
    word_details: {
      type: "object",
      properties: {
        zh: {
          type: "object",
          properties: {
            word: { type: "string", description: "Simplified Chinese word." },
            definition: {
              type: "string",
              description: "Concise Simplified Chinese definition only. No pronunciation, part-of-speech label, markdown, or cross-language equivalents."
            }
          }
        },
        en: {
          type: "object",
          properties: {
            word: { type: "string", description: "English word." },
            definition: {
              type: "string",
              description: "Concise English definition only. No pronunciation, part-of-speech label, markdown, or cross-language equivalents."
            }
          }
        },
        "pt-BR": {
          type: "object",
          properties: {
            word: { type: "string", description: "Brazilian Portuguese word." },
            definition: {
              type: "string",
              description: "Concise Brazilian Portuguese definition only. No pronunciation, part-of-speech label, markdown, or cross-language equivalents."
            }
          }
        },
        ja: {
          type: "object",
          properties: {
            word: { type: "string", description: "Japanese word." },
            definition: {
              type: "string",
              description: "Concise Japanese definition only. No pronunciation, part-of-speech label, markdown, or cross-language equivalents."
            }
          }
        }
      }
    },
    examples: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sentence: { type: "string" },
          translations: {
            type: "object",
            properties: {
              zh: { type: "string" },
              en: { type: "string" },
              "pt-BR": { type: "string" },
              ja: { type: "string" }
            }
          }
        },
        required: ["sentence", "translations"]
      }
    },
    senses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sense_order: { type: "number", description: "1-based order index of this sense" },
          part_of_speech: { type: "string", description: "Part of speech (e.g. NOUN, VERB, ADJ, ADV)" },
          gloss_key: { type: "string", description: "A very short core meaning or concept key" },
          definitions: {
            type: "object",
            properties: {
              zh: { type: "string", description: "Definition in Simplified Chinese" },
              en: { type: "string", description: "Definition in English" },
              "pt-BR": { type: "string", description: "Definition in Brazilian Portuguese" },
              ja: { type: "string", description: "Definition in Japanese" }
            },
            required: ["zh", "en", "pt-BR", "ja"]
          }
        },
        required: ["sense_order", "part_of_speech", "definitions"]
      }
    }
  },
  required: ["type", "detected_source_lang", "translation", "translations"]
} as const;

export const PREVIEW_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["sentence"] },
    detected_source_lang: {
      type: "string",
      description: "Detected source language code."
    },
    translation: {
      type: "string",
      description: "Natural translation in the requested target language."
    },
    explanation: {
      type: "string",
      description: "One concise explanation in the requested target language."
    }
  },
  required: ["type", "detected_source_lang", "translation", "explanation"]
} as const;
