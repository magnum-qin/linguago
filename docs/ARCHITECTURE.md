# Architecture

LinguaGo is a Cloudflare-hosted Vue PWA with a dictionary-first translation path.

## Runtime Components

```text
iPhone / desktop browser
        |
        v
Vite-built Vue app served by Cloudflare Workers Assets
        |
        v
Cloudflare Worker API
        |
        +-- KV cache and backend model settings
        +-- Cloudflare D1 dictionary database
        +-- Louis dictionary API fallback/source
        +-- Model providers
            +-- DeepSeek
            +-- Gemini
            +-- Alibaba Cloud Bailian / DashScope
            +-- OpenRouter
```

## Frontend

The frontend is a Vue 3 application built by Vite.

- `index.html`: Vite HTML entry, PWA metadata, and early theme bootstrap.
- `src/main.ts`: mounts Vue and Vuetify.
- `src/App.vue`: app shell and layout.
- `src/components/TranslatorCard.vue`: input and translate controls.
- `src/components/ResultCard.vue`: result rendering, tabs, provider badge, feedback reporting.
- `src/components/SettingsOverlay.vue`: provider/model settings and dictionary stats.
- `src/components/BookmarksCard.vue`: local saved/history UI.
- `src/components/FuriganaText.vue`: Japanese reading display.
- `src/composables/useTranslation.ts`: streaming request loop and shared result state.
- `src/composables/useSettings.ts`: local settings, model catalog sync, language metadata.
- `src/composables/useTheme.ts`: system/light/dark theme handling.
- `src/utils/api.js`: browser API wrappers.
- `src/utils/pronunciation.js`: local display pronunciation helpers.
- `src/assets/tailwind.css`: app CSS source imported by Vite.
- `public/sw.js`: service worker. It network-firsts navigations, bypasses `/api/*`, and cache-firsts hashed `/assets/*`.
- `public/manifest.webmanifest` and `public/icons/`: PWA install metadata/assets.

Build output goes to `dist/`, and `wrangler.jsonc` serves that directory through Workers Assets.

## Cloudflare Worker

The Worker entrypoint is `worker/index.ts`.

Supporting modules:

- `worker/types.ts`: bindings, language/provider types, normalized response shapes.
- `worker/config.ts`: headers, model catalog, cache/rate-limit constants, messages.
- `worker/schemas.ts`: structured-output JSON schemas.
- `worker/prompts.ts`: provider-specific system prompts and prompt selection.
- `worker/provider-selection.ts`: configured provider/model selection for explicit and `auto` routing.
- `worker/provider-clients.ts`: DashScope, OpenRouter, DeepSeek, and Gemini clients.
- `worker/provider-json.ts`: provider JSON parsing and validation.
- `worker/normalization.ts`: model/dictionary response normalization and local fallback fields.
- `worker/dictionary.ts`: dictionary adapters for Cloudflare D1, Louis SQLite API, and a mock JMDict adapter.
- `worker/streaming.ts`: structured streaming orchestration and partial response extraction.
- `worker/settings.ts`: `/api/models` and `/api/settings` handlers.
- `worker/errors.ts`: structured translation errors.

Main responsibilities:

- Serve static assets through `env.ASSETS`.
- Handle translation, streaming translation, model catalog, backend settings, dictionary stats, health, and error-report routes.
- Rate-limit requests through KV counters.
- Cache normalized translation responses in KV.
- Look up dictionary entries before model calls for word-like input.
- Validate provider JSON before normalizing it for the frontend.

## API Routes

- `POST /api/translate`
- `POST /api/translate-stream`
- `POST /api/report-error`
- `GET /api/models`
- `GET/POST /api/settings`
- `GET /api/dictionary/stats`
- `GET /api/health`
- `GET /health`

Unknown routes fall through to Workers Assets.

## Translation Flow

```text
User input
  |
  v
Frontend POST /api/translate-stream
  |
  v
Worker normalizes text, target language, provider, and model
  |
  +-- rate-limit
  +-- select explicit provider/model or backend setting
  +-- check KV cache
  +-- if word-like: try dictionary manager
  |     +-- D1 hit: return provider="dictionary"
  |     +-- Louis hit: return provider="dictionary"
  |     +-- miss/unavailable: continue
  +-- call selected model provider
  +-- parse/validate structured JSON
  +-- normalize to frontend response shape
  +-- cache final response
  +-- emit final/done
```

Streaming emits newline-delimited JSON objects shaped like:

```json
{ "event": "status", "data": { "stage": "started" } }
{ "event": "partial_translation", "data": {} }
{ "event": "partial_explanation", "data": {} }
{ "event": "final", "data": {} }
{ "event": "done", "data": { "ok": true } }
```

Dictionary and KV hits may skip partial events and return `final` followed by `done`.

## Result Shape

The frontend expects:

- `type`: `word` or `sentence`.
- `detected_source_lang`
- `target_lang`
- `original`
- `translation`
- `translations`: keyed by `en`, `pt-BR`, `zh`, `ja`.
- `provider`: `dictionary`, `openrouter`, `dashscope`, `gemini`, or `deepseek`.
- `model`
- `cached`

Sentence responses include `explanation` and language-keyed `explanations`.

Word responses include `phonetic`, `audio_text`, `word_details`, `senses`, and `examples`.

Bump `TRANSLATION_CACHE_VERSION` in `worker/config.ts` whenever response shape or normalization changes.

## Provider Routing

Supported providers:

- `auto`
- `openrouter`
- `dashscope`
- `gemini`
- `deepseek`

Backend defaults and model options live in `worker/config.ts`. Frontend defaults and editable local options live in `src/composables/useSettings.ts`; keep them aligned with `/api/models`.

Explicit provider selections fail with `PROVIDER_CONFIG_MISSING` when the matching secret is absent. Health responses may expose booleans but must not expose secret values.

## Dictionary Layer

`worker/dictionary.ts` currently composes three adapters:

- `CloudflareD1Adapter`: uses `env.DB` and the D1 schema expected by the imported dictionary database.
- `LouisSQLiteAdapter`: calls the external Louis API with `DICTIONARY_API_URL` and `DICTIONARY_API_TOKEN`.
- `MockJMDictAdapter`: local mock enrichment for a narrow test case.

This mixed adapter stack is useful for migration, but it is also a cleanup hotspot. Make adapter ordering, model names, and stats behavior explicit before relying on a single dictionary source in production.

The Louis API endpoints expected by the Worker are:

- `GET /health`
- `GET /api/dictionary/stats`
- `GET /api/dictionary/lookup?term=...`

## Deployment

```bash
npm run build
npm run check
npm run deploy
```

`npm run deploy` runs the Vite build and then `wrangler deploy`. Assets come from `dist/`, not `public/`.

## Verification

Primary checks:

- `npm run build`
- `npm run check`
- `npm run check:all`
- `node scripts/api-smoke.mjs`
- `node scripts/result-tabs-check.mjs`
- `node scripts/system-theme-check.mjs`

Several Playwright scripts still encode historical UI constraints. Before trusting one, verify it targets the current Vue DOM rather than the removed `public/app.js` frontend.
