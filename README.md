# LinguaGo Translation PWA

LinguaGo is an iPhone-friendly Progressive Web App for multilingual translation and dictionary lookup.

The current app flow is:

1. The Vue frontend sends text to the Cloudflare Worker.
2. The Worker handles `/api/translate` or `/api/translate-stream`.
3. Single-word input is looked up in the dictionary layer first.
4. Dictionary misses and sentence input fall back to the selected model provider.
5. The UI renders English, Brazilian Portuguese, Chinese, and Japanese result tabs.

## Features

- Installable PWA for iPhone Safari and desktop browsers.
- Vue 3 + Vuetify frontend with Tailwind CSS utilities.
- Four-language result tabs: EN, PT-BR, Chinese, and Japanese.
- Dictionary-first lookup through Cloudflare D1 and/or the Louis dictionary API.
- Model fallback through OpenRouter, Alibaba Cloud Bailian, Gemini, DeepSeek, or automatic routing.
- Backend-stored provider/model settings exposed through the settings overlay.
- Cloudflare KV cache for repeated translation results and backend settings.
- Structured provider errors and `/api/health` observability for KV, dictionary, and provider configuration.
- Service worker app-shell caching that bypasses `/api/*` requests and caches Vite hashed assets.
- Dictionary pipeline scripts for downloading, cleaning, validating, importing, and syncing generated word entries.

## Tech Stack

- Frontend: Vue 3, Vuetify, Tailwind CSS, Vite.
- Frontend entry: `src/main.ts`, `src/App.vue`, `src/components/`, `src/composables/`, `src/utils/`.
- Backend: Cloudflare Worker modules in `worker/`.
- Static hosting: Cloudflare Workers Assets served from `dist/`.
- Cache/settings: Cloudflare KV binding `CACHE`.
- Dictionary storage: Cloudflare D1 binding `DB`, with Louis SQLite API as an external fallback/source.
- Deployment: Wrangler through `npm run deploy`.

## Project Layout

```text
index.html                Vite HTML entry and PWA head bootstrap
src/
  main.ts                 Vue app entry
  App.vue                 Main app shell
  assets/tailwind.css     Tailwind and app styling source
  components/             Translator, result, bookmarks, settings, furigana UI
  composables/            Shared settings, theme, translation, bookmarks state
  utils/                  Frontend API, text, and pronunciation helpers
worker/
  index.ts                Cloudflare Worker routes and orchestration
  config.ts               Model catalog, messages, cache/rate-limit constants
  dictionary.ts           D1/Louis/mock dictionary adapters and normalization
  provider-*.ts           Provider calls, selection, JSON parsing
  streaming.ts            Structured streaming orchestration
  settings.ts             `/api/models` and `/api/settings`
public/
  sw.js                   Service worker
  manifest.webmanifest    PWA manifest
  icons/                  PWA icons
scripts/                  Dictionary pipeline, checks, smoke tests, remote helpers
docs/                     Architecture, handoff, decisions, TODO, pipeline notes
wrangler.jsonc            Cloudflare Worker, Assets, KV, and D1 configuration
```

## Local Development

Install dependencies:

```bash
npm install
```

Run the Vite frontend:

```bash
npm run dev
```

Run the Worker locally:

```bash
npm run dev:worker
```

Build:

```bash
npm run build
```

Type-check:

```bash
npm run check
```

Deploy:

```bash
npm run deploy
```

Current production URL:

```text
https://translation-pwa.qhzggzh-linguago.workers.dev
```

## Important Environment Variables

Configure these as Cloudflare Worker secrets or variables where applicable:

- `DICTIONARY_API_URL`: Louis dictionary API base URL.
- `DICTIONARY_API_TOKEN`: Bearer token for Louis dictionary API.
- `OPENROUTER_API_KEY`: OpenRouter API key.
- `DASHSCOPE_API_KEY`: Alibaba Cloud Bailian API key.
- `GEMINI_API_KEY`: Gemini API key.
- `DEEPSEEK_API_KEY`: DeepSeek API key.

Cloudflare bindings are configured in `wrangler.jsonc`:

- `ASSETS`: Workers Assets from `./dist`.
- `CACHE`: KV namespace for translation cache, rate limit counters, and model settings.
- `DB`: D1 database for dictionary lookup.

## Worker API

- `GET /api/health`: Worker, KV, dictionary, and provider configuration status.
- `GET /health`: compatibility alias for `/api/health`.
- `GET /api/models`: backend provider/model catalog.
- `GET/POST /api/settings`: persisted backend provider/model settings.
- `GET /api/dictionary/stats`: dictionary stats proxy.
- `POST /api/translate`: one-shot translation response.
- `POST /api/translate-stream`: NDJSON progressive translation events.
- `POST /api/report-error`: edge-side logging endpoint for frontend translation reports.

`POST /api/translate` returns structured errors:

```json
{
  "error": "OpenRouter API Key is not configured.",
  "error_code": "PROVIDER_CONFIG_MISSING",
  "provider": "openrouter",
  "model": "qwen/qwen3-next-80b-a3b-instruct:free"
}
```

## Useful Checks

```bash
npm run build
npm run check
npm run check:all
node scripts/api-smoke.mjs
node scripts/result-tabs-check.mjs
node scripts/system-theme-check.mjs
```

Use the Playwright layout scripts before and after changing mobile layout, result cards, tabs, settings overlays, or service worker behavior.

## Current Cleanup Notes

The project recently moved from a plain `public/app.js` frontend to a Vue/Vite frontend. Treat old references to `public/index.html`, `public/app.js`, `public/styles.css`, `src/index.ts`, or `npm run style:build` as stale unless a migration task explicitly restores those files.

Several large SQL dumps, logs, scratch scripts, and transfer archives are currently present as untracked files in the repository root. They should be reviewed before committing; most look operational or temporary rather than source code.

## Documentation For New Codex Sessions

When opening a new Codex conversation, ask it to read:

```text
README.md
docs/PROJECT_OVERVIEW_FOR_AI.md
docs/ARCHITECTURE.md
docs/CODEX_HANDOFF.md
docs/DECISIONS.md
docs/TODO.md
```
