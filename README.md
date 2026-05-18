# LinguaGo Translation PWA

LinguaGo is an iPhone-friendly Progressive Web App for fast multilingual translation and dictionary lookup.

The app is designed around a simple flow:

1. Enter a word or sentence.
2. The Cloudflare Worker receives `/api/translate`.
3. Single-word input is looked up in the Louis dictionary API first.
4. If the dictionary misses, the Worker falls back to the configured model provider.
5. The UI shows results in language tabs: EN, PT-BR, Chinese, and Japanese.

## Features

- Installable PWA for iPhone Safari and desktop browsers.
- System-aware theme with manual light/dark/system cycling.
- Four-language result tabs: English, Brazilian Portuguese, Chinese, and Japanese.
- Dictionary-first lookup for accepted word entries.
- Model fallback through OpenRouter, Alibaba Cloud Bailian, Gemini, or automatic routing.
- Backend-stored model settings exposed through the settings modal.
- Cloudflare KV cache for repeated translation results.
- Structured provider errors and `/api/health` observability for KV, dictionary, and provider configuration.
- Stable provider badge showing dictionary hits or the selected model provider without changing result card dimensions.
- Mobile-first UI with stable button sizes, smooth tab transitions, and no layout jump during loading-to-result changes.
- Service worker app-shell caching that keeps the PWA fast while bypassing cache for `/api/*` requests.
- Dictionary pipeline scripts for downloading, cleaning, validating, importing, and syncing generated word entries.

## Tech Stack

- Frontend: plain HTML, CSS, and JavaScript in `public/`.
- Styling source: Tailwind CSS v4 entry file at `src/styles.css`.
- Backend: Cloudflare Worker in `src/index.ts`.
- Static hosting: Cloudflare Workers Assets.
- Cache: Cloudflare KV binding `CACHE`.
- Dictionary API: Louis server running `scripts/dictionary-api-server.mjs`.
- Dictionary storage: SQLite-compatible `dictionary.sqlite`.

## Project Layout

```text
public/              PWA shell, frontend logic, generated CSS, service worker, icons
src/index.ts         Cloudflare Worker API and provider routing
src/styles.css       Source stylesheet compiled into public/styles.css
scripts/             Dictionary pipeline, deployment helpers, and Playwright checks
docs/                Architecture, handoff, decisions, and operation notes
wrangler.jsonc       Cloudflare Worker configuration
```

## Local Development

Install dependencies:

```bash
npm install
```

Build CSS:

```bash
npm run style:build
```

Type-check the Worker:

```bash
npm run check
```

Run the Worker locally:

```bash
npm run dev
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

## Health And Errors

The Worker exposes:

- `GET /api/health`: reports Worker time, KV reachability, dictionary reachability/stats, and provider configuration booleans without exposing secrets.
- `GET /health`: compatibility alias for the same health payload.

`POST /api/translate` returns structured error responses:

```json
{
  "error": "翻译暂时不可用，请检查 API Key、平台或模型名称。",
  "error_code": "PROVIDER_CONFIG_MISSING",
  "provider": "openrouter",
  "model": "qwen/qwen3.6-30b-a3b:free"
}
```

## Useful Checks

```bash
node scripts/mobile-devtools-jump-audit.mjs
node scripts/mobile-translate-height-check.mjs
node scripts/interaction-motion-check.mjs
node scripts/result-tabs-check.mjs
npm run check:theme
```

These checks verify the mobile layout, tab animation, button size stability, loading-to-result layout stability, and system/manual theme behavior.

## Documentation For New Codex Sessions

When opening a new Codex conversation, ask it to read:

```text
README.md
docs/ARCHITECTURE.md
docs/CODEX_HANDOFF.md
docs/DECISIONS.md
docs/TODO.md
```

The fastest prompt is:

```text
Please read README.md and docs/CODEX_HANDOFF.md first, then summarize the architecture and current constraints before making changes.
```
