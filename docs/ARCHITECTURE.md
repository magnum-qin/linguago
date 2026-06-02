# Architecture

LinguaGo is a Cloudflare-hosted PWA with a dictionary-first translation path.

## Runtime Components

```text
iPhone / desktop browser
        |
        v
Cloudflare Worker + Assets
        |
        +-- KV cache
        |
        +-- Louis dictionary API
        |
        +-- Model providers
            +-- OpenRouter
            +-- Alibaba Cloud Bailian
            +-- Gemini
            +-- DeepSeek
```

## Frontend

Frontend files live in `public/`.

- `public/index.html`: PWA shell and semantic DOM.
- `public/app.js`: UI state, settings modal, translation requests, tabs, history, speech synthesis, and motion.
- `public/js/api.js`: frontend API wrappers for settings, model catalog, dictionary stats, translation, and translation streaming.
- `public/js/text-utils.js`: shared HTML escaping, attribute escaping, regex escaping, and HTML text extraction helpers.
- `public/js/pronunciation.js`: local display pronunciation formatting for English keywords and Japanese furigana-style annotations.
- `public/styles.css`: generated CSS. Do not edit by hand.
- `public/sw.js`: service worker app-shell cache. It cache-firsts shell/navigation assets, stale-while-revalidates same-origin static files, and sends `/api/*` directly to the network.
- `public/manifest.webmanifest`: PWA metadata, standalone display settings, and install theme colors.
- `public/icons/`: install icons for iPhone and browsers.

The app theme defaults to system preference. The theme button cycles system, dark, and light modes, and the head bootstrap script applies the stored/system theme before the main script loads to avoid a visible flash in installed PWA mode.

The source stylesheet is `src/styles.css`. Always edit this file and run:

```bash
npm run style:build
```

## Cloudflare Worker

The Worker entrypoint is `src/index.ts`. Supporting modules keep shared data and pure selection logic out of the route handler:

- `src/types.ts`: Worker bindings, language/provider types, and normalized response shapes.
- `src/config.ts`: headers, model catalogs, cache/rate-limit constants, and user-facing backend messages.
- `src/schemas.ts`: full and preview structured-output JSON schemas.
- `src/prompts.ts`: provider-specific system prompts plus prompt-selection helpers.
- `src/provider-selection.ts`: configured provider/model selection for explicit and `auto` routing.
- `src/provider-clients.ts`: provider HTTP clients for DashScope, OpenRouter, DeepSeek, and Gemini, including streaming provider reads.
- `src/provider-json.ts`: provider JSON parsing, fence stripping, and payload validation.
- `src/normalization.ts`: provider/dictionary response normalization, local pronunciation generation, explanation fallback, and word-definition cleanup.
- `src/dictionary.ts`: Louis dictionary API lookup, dictionary stats fetch, and dictionary-entry conversion to the normalized frontend response shape.
- `src/streaming.ts`: streaming translation orchestration and incremental partial-response extraction for the frontend.
- `src/settings.ts`: backend model catalog and persisted provider/model setting handlers.
- `src/errors.ts`: structured translation error class.

Main responsibilities:

- Serve static assets through Workers Assets.
- Handle `/api/translate`.
- Handle `/api/translate-stream` for progressive NDJSON responses.
- Handle `/api/models` for the backend model catalog.
- Handle backend settings through `/api/settings`.
- Report lightweight runtime status through `/api/health`.
- Proxy dictionary stats through `/api/dictionary/stats`.
- Cache translation responses in KV.
- Route requests to the configured model provider.
- Convert dictionary hits into the same frontend-compatible shape as model results.
- Validate model JSON responses before normalizing them for the frontend.
- Return structured translation errors with `error_code`, plus provider/model context when available.

## Translation Flow

```text
User input
  |
  v
Frontend POST /api/translate
  |
  v
Worker normalizes and classifies text
  |
  +-- word input
  |     |
  |     +-- lookup Louis dictionary API
  |     |     |
  |     |     +-- hit: return provider="dictionary", cached=true
  |     |     |
  |     |     +-- miss or API unavailable: fall back to model
  |
  +-- sentence input
        |
        +-- model provider
```

## Result Shape

The frontend expects a compatible response with these high-level fields:

- `type`: `word` or `sentence`.
- `original`: source text.
- `translation`: fallback/main translation.
- `translations`: language-keyed object for EN, PT-BR, ZH, JA tabs.
- `word_details`: language-keyed definitions for word mode.
- `examples`: examples and translations for word mode.
- `explanations`: language-keyed sentence explanation for sentence mode.
- `provider`: provider name such as `dictionary`, `openrouter`, `dashscope`, `gemini`, or `deepseek`.
- `cached`: boolean cache indicator.

For sentence mode, the Worker normalizes `explanations` for all four result tabs and keeps `explanation` as a target-language compatibility field. Bump the KV cache version whenever sentence response shape changes so old single-language explanations do not persist.

## Provider Routing

Supported providers are:

- `auto`: DashScope first, then DeepSeek, then Gemini, then OpenRouter.
- `openrouter`: OpenRouter chat completions.
- `dashscope`: Alibaba Cloud Bailian compatible chat completions.
- `gemini`: Gemini `generateContent`.
- `deepseek`: DeepSeek OpenAI-compatible chat completions.

The frontend settings modal can save any supported provider/model pair through `/api/settings`.
Explicit provider selections fail with `PROVIDER_CONFIG_MISSING` when the matching secret is absent.
The model dropdown is seeded from `GET /api/models`, then users can edit provider-specific model lists locally.

Provider responses use JSON mode where supported:

- DashScope, DeepSeek, and OpenRouter use OpenAI-compatible `response_format: { type: "json_object" }`.
- Gemini uses `responseMimeType: "application/json"` with a response schema.
- The Worker validates required fields after parsing. Invalid complete responses are retried once with a JSON repair prompt.

## Health And Error Shape

`GET /api/health` and the compatibility `/health` route return only safe booleans/status data:

- Worker timestamp and version.
- KV reachability.
- Louis dictionary configured/reachable status and stats when reachable.
- Provider `configured` booleans for OpenRouter, DashScope, Gemini, and DeepSeek.

`POST /api/translate` errors use:

- `EMPTY_INPUT`
- `INPUT_TOO_LONG`
- `RATE_LIMITED`
- `PROVIDER_CONFIG_MISSING`
- `PROVIDER_API_ERROR`
- `PROVIDER_EMPTY_RESPONSE`
- `PROVIDER_INVALID_JSON`
- `TRANSLATION_FAILED`

## Dictionary Service

The Louis API is implemented by `scripts/dictionary-api-server.mjs`.

Expected endpoints:

- `GET /health`
- `GET /api/dictionary/stats`
- `GET /api/dictionary/lookup?term=...`

All `/api/*` requests require:

```text
Authorization: Bearer <token>
```

The Cloudflare Worker stores the token as `DICTIONARY_API_TOKEN` and does not expose it to the browser.

## Dictionary Pipeline

Dictionary scripts live in `scripts/`.

Important scripts:

- `download-dictionaries.mjs`: download public dictionaries.
- `clean-dictionaries.mjs`: normalize and merge candidates.
- `download-frequency-lists.mjs`: download frequency lists.
- `prepare-frequency-batch.mjs`: build generation batches.
- `run-dictionary-batch.mjs`: run model generation batches.
- `validate-generated-dictionary.mjs`: validate generated JSON.
- `import-generated-dictionary.mjs`: import accepted entries into SQLite.
- `query-dictionary.mjs`: local query helper.
- `dictionary-api-server.mjs`: Louis API server.
- `remote-hz-qwen35b-sync-batch.sh`: remote Qwen batch runner and Louis sync helper. It writes `state/batches/<run>.status` with the current state, counts, output paths, and timestamp for each batch.

See `docs/dictionary-pipeline.md` for more details.

## Deployment

Build and deploy:

```bash
npm run style:build
npm run check
npm run deploy
```

Production URL:

```text
https://translation-pwa.qhzggzh-linguago.workers.dev
```

## Verification

The key UI regression checks are Playwright scripts:

- `scripts/mobile-devtools-jump-audit.mjs`: checks mobile layout shift and frame stability.
- `scripts/mobile-translate-height-check.mjs`: checks translation/loading/result dimensions.
- `scripts/interaction-motion-check.mjs`: checks tab animation and interaction transitions.
- `scripts/result-tabs-check.mjs`: checks result tab behavior.
- `scripts/button-stability-check.mjs`: checks button size stability.
- `scripts/system-theme-check.mjs`: checks system/default theme and manual theme cycling.
- `scripts/api-smoke.mjs`: checks health, model catalog, and backend settings; set `RUN_TRANSLATE=1` to include a real translation call.
- `scripts/check-all.mjs`: local quality gate for TypeScript, service-worker cache coverage, and frontend/script syntax checks.
- `scripts/stream-benchmark.mjs`: measures first partial and final response timing for comma-separated `BENCHMARK_MODELS`.
- `scripts/sw-cache-check.mjs`: verifies service-worker shell cache includes required frontend module assets and bypasses `/api/*`.

Use these before changing mobile layout, buttons, tabs, or result cards.
