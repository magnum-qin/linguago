# LinguaGo Project Overview For AI

This document is a high-signal briefing for AI coding agents that need to understand the project quickly before making changes.

## One-Sentence Summary

LinguaGo is a Cloudflare-hosted Progressive Web App for fast multilingual translation and dictionary lookup, optimized for mobile use, four-language result tabs, provider/model switching, dictionary-first word lookup, and progressive structured streaming.

## Product Goal

The product should feel like a lightweight native translator/dictionary app:

- The user enters a Chinese, English, Portuguese, or Japanese word/sentence.
- The app returns translations across English, Brazilian Portuguese, Simplified Chinese, and Japanese.
- Word-like input is checked against the Louis dictionary first.
- Sentence input uses the selected AI provider/model.
- Results are shown in one selected language tab at a time.
- The UI should feel stable: no card jumps, no button resizing, no blank tab content during loading.

## Current Production URL

```text
https://translation-pwa.qhzggzh-linguago.workers.dev
```

## Tech Stack

- Frontend: plain HTML, CSS, and JavaScript in `public/`.
- Styling source: `src/styles.css`, compiled into `public/styles.css`.
- Backend: Cloudflare Worker in `src/index.ts`.
- Hosting: Cloudflare Workers Assets.
- Cache: Cloudflare KV binding named `CACHE`.
- Dictionary: external Louis dictionary API backed by SQLite.
- Deployment: Wrangler through `npm run deploy`.

## Important Files

Read these first:

```text
README.md
docs/PROJECT_OVERVIEW_FOR_AI.md
docs/ARCHITECTURE.md
docs/CODEX_HANDOFF.md
docs/DECISIONS.md
public/index.html
public/app.js
src/index.ts
src/styles.css
```

Key responsibilities:

- `public/index.html`: DOM shell for input, results, settings, model editor, history.
- `public/app.js`: UI state, settings, streaming request handling, language tabs, history, speech synthesis, pronunciation hints.
- `src/styles.css`: source stylesheet. Edit this, then run `npm run style:build`.
- `public/styles.css`: generated CSS. Do not edit directly.
- `public/sw.js`: service worker app shell cache. `/api/*` must stay network-only.
- `src/index.ts`: Worker routes, provider routing, streaming, JSON validation, dictionary lookup, KV cache.
- `docs/CODEX_HANDOFF.md`: operational handoff and UI constraints.

## Runtime Architecture

```text
Browser / installed PWA
  |
  | static assets + POST /api/*
  v
Cloudflare Worker + Workers Assets
  |
  +-- Cloudflare KV cache
  |
  +-- Louis dictionary API
  |
  +-- Model providers
      +-- DeepSeek
      +-- Gemini
      +-- DashScope / Alibaba Cloud Bailian
      +-- OpenRouter
```

## API Routes

Implemented in `src/index.ts`:

- `POST /api/translate`: one-shot translation.
- `POST /api/translate-stream`: NDJSON progressive translation.
- `GET /api/models`: provider/model catalog for the settings UI.
- `GET/POST /api/settings`: backend provider/model settings.
- `GET /api/health` and `/health`: safe runtime status.
- `GET /api/dictionary/stats`: dictionary stats proxy.

The browser should never see provider API keys or the dictionary token.

## Translation Flow

Normal one-shot flow:

```text
request
  |
  +-- normalize input and target language
  +-- rate-limit
  +-- if word-like: try Louis dictionary API
  |     +-- hit: return dictionary result
  |     +-- miss: continue to model
  +-- select provider/model
  +-- check KV translation cache
  +-- call provider
  +-- parse and validate JSON
  +-- normalize frontend response
  +-- write KV cache
  +-- return JSON
```

Streaming flow:

```text
request
  |
  +-- dictionary and KV cache can still short-circuit to final
  +-- otherwise call the selected model once with structured JSON streaming
  +-- read provider SSE chunks
  +-- accumulate raw JSON text
  +-- opportunistically parse completed fields
  +-- emit NDJSON delta events as fields become available
  +-- parse final full JSON
  +-- normalize and cache final response
  +-- emit final and done
```

Important: the current streaming design is single-request structured streaming. It intentionally avoids the older two-request `preview + full` design because that could produce different translations.

## Streaming Event Shape

`POST /api/translate-stream` returns newline-delimited JSON events:

```text
status: started
status: stream
delta: partial structured response
delta: more fields
final: complete normalized response
done: ok
```

If KV cache or dictionary hits, the route may return:

```text
status: started
final
done
```

That is expected and means no model streaming happened.

## Provider Behavior

Supported providers:

- `auto`
- `deepseek`
- `gemini`
- `dashscope`
- `openrouter`

Observed behavior from recent tests:

- DeepSeek direct `deepseek-v4-flash`: fastest and best true streaming experience in current structured workflow.
- DeepSeek direct `deepseek-v4-pro`: also true streaming, slightly slower final output.
- Gemini `gemini-3.1-flash-lite` and `gemini-3.5-flash`: can stream structured fields, but first delta is slower than DeepSeek in this project.
- DashScope: supports `stream: true`, but JSON mode often buffers until complete JSON, so UI may receive no `delta`.
- OpenRouter free models: unstable; many fail, timeout, or return invalid JSON. Do not make OpenRouter free models the default without fallback logic.

## Result Data Model

Frontend-compatible response:

```ts
{
  type: "word" | "sentence";
  detected_source_lang: string;
  target_lang: "en" | "zh" | "pt-BR" | "ja";
  original: string;
  translation: string;
  translations: {
    en: { text: string; phonetic: string; audio_text: string };
    zh: { text: string; phonetic: string; audio_text: string };
    "pt-BR": { text: string; phonetic: string; audio_text: string };
    ja: { text: string; phonetic: string; audio_text: string };
  };
  provider: "dictionary" | "deepseek" | "gemini" | "dashscope" | "openrouter";
  model: string;
  cached: boolean;
}
```

Sentence responses also include:

```ts
{
  explanation: string;
  explanations: Record<"en" | "zh" | "pt-BR" | "ja", string>;
}
```

Word responses also include:

```ts
{
  phonetic: string;
  audio_text: string;
  word_details: Record<"en" | "zh" | "pt-BR" | "ja", { word: string; definition: string }>;
  senses?: Array<{
    sense_order: number;
    part_of_speech: string;
    gloss_key: string;
    definitions: Record<"en" | "zh" | "pt-BR" | "ja", string>;
  }>;
  examples: Array<{
    sentence: string;
    translations: Record<"en" | "zh" | "pt-BR" | "ja", string>;
  }>;
}
```

## Frontend Behavior

The result card has four tabs:

```text
EN | PT | 中 | 日
```

Only the selected tab is shown at one time:

- Translation card displays selected language text.
- Sentence explanation displays selected language explanation.
- Word details/examples display selected language definitions/examples.
- During streaming, if a tab has not arrived yet, show loading animation rather than blank content.

The user wanted English pronunciation hints only for key/difficult words, not every word. Japanese should show furigana for known kanji terms. This is currently handled in `public/app.js` with local rules, not by the model.

## Pronunciation And Reading Hints

Implemented locally in `public/app.js`:

- `formatEnglishKeywordPronunciation(text)`: adds small pronunciation hints for selected difficult English words such as `scenic`, `beautiful`, `Portuguese`, etc.
- `formatJapaneseFurigana(text)`: adds ruby/furigana for known Japanese kanji terms such as `観光`, `景色`, `美しい`, `公園`, `散歩`.
- Chinese pinyin is generated server-side through `pinyin-pro` in `src/index.ts`.
- Portuguese currently does not show phonetics because Portuguese spelling is generally more directly pronounceable for this product’s use case.

When adding more hints, keep the UI compact. Do not annotate every English word.

## Cache Rules

There are two cache layers:

1. Worker KV translation cache.
2. PWA service worker app-shell cache.

Important rules:

- Bump `TRANSLATION_CACHE_VERSION` in `src/index.ts` when response shape or normalization changes.
- Bump `CACHE_NAME` in `public/sw.js` when app-shell assets or cache behavior changes.
- `/api/*` must be network-only in the service worker.
- `app.js` and `styles.css` should stay network-first so UI fixes reach installed PWAs quickly.

## Settings And Models

The settings UI supports:

- Provider selection.
- Model dropdown for selected provider.
- Editable provider-specific model list.
- Model verification.
- Dictionary stats display.

Frontend defaults live in `public/app.js`.
Backend defaults/model catalog live in `src/index.ts`.

Keep them aligned when adding or removing model names.

## Environment Variables

Cloudflare Worker variables/secrets:

```text
DICTIONARY_API_URL
DICTIONARY_API_TOKEN
OPENROUTER_API_KEY
DASHSCOPE_API_KEY
GEMINI_API_KEY
DEEPSEEK_API_KEY
```

Never expose secrets in frontend code or health responses.

## Common Commands

```bash
npm install
npm run style:build
npm run check
npm run deploy
```

Useful UI checks:

```bash
node scripts/mobile-devtools-jump-audit.mjs
node scripts/mobile-translate-height-check.mjs
node scripts/interaction-motion-check.mjs
node scripts/result-tabs-check.mjs
npm run check:theme
```

## UI Constraints

Preserve these unless explicitly asked to redesign:

- Do not cause layout jumps when loading turns into results.
- Do not let result tab switching change card height.
- Do not resize buttons between idle/loading states.
- Do not use `transform: scale()` on buttons for feedback.
- Provider badge must keep stable dimensions.
- Settings and model editor overlays must cover the viewport and stay above result cards.
- Desktop layout is three columns: history, input, result.
- Mobile layout must remain stable during keyboard open/close.

## Common Pitfalls

- Do not edit `public/styles.css` directly.
- Do not let stale KV cache make streaming tests look non-streaming.
- Do not forget app-shell cache invalidation after changing `public/app.js`.
- Do not assume every provider streams the same way; DashScope may buffer JSON mode.
- Do not assume OpenRouter free models are reliable.
- Do not use a two-request preview/full translation flow unless the user accepts possible inconsistency.
- Do not add model output fields without updating validation, normalization, frontend rendering, and cache version.

## Recommended AI Onboarding Prompt

Use this prompt for a fresh AI coding session:

```text
Read README.md, docs/PROJECT_OVERVIEW_FOR_AI.md, docs/ARCHITECTURE.md, and docs/CODEX_HANDOFF.md. Summarize the runtime architecture, streaming translation flow, cache rules, UI constraints, and deployment workflow before editing files.
```

