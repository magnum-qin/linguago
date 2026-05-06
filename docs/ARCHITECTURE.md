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
```

## Frontend

Frontend files live in `public/`.

- `public/index.html`: PWA shell and semantic DOM.
- `public/app.js`: UI state, settings modal, translation requests, tabs, history, speech synthesis, and motion.
- `public/styles.css`: generated CSS. Do not edit by hand.
- `public/sw.js`: service worker cache shell.
- `public/manifest.webmanifest`: PWA metadata.
- `public/icons/`: install icons for iPhone and browsers.

The source stylesheet is `src/styles.css`. Always edit this file and run:

```bash
npm run style:build
```

## Cloudflare Worker

The Worker is implemented in `src/index.ts`.

Main responsibilities:

- Serve static assets through Workers Assets.
- Handle `/api/translate`.
- Handle backend settings through `/api/settings`.
- Proxy dictionary stats through `/api/dictionary/stats`.
- Cache translation responses in KV.
- Route requests to the configured model provider.
- Convert dictionary hits into the same frontend-compatible shape as model results.

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
- `provider`: provider name such as `dictionary`, `openrouter`, `dashscope`, or `gemini`.
- `cached`: boolean cache indicator.

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

Use these before changing mobile layout, buttons, tabs, or result cards.
