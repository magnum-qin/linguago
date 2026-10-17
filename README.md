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
- Model fallback through Cloudflare Workers AI, Alibaba Cloud Bailian, Gemini, DeepSeek, or automatic routing.
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
- `DASHSCOPE_API_KEY`: Alibaba Cloud Bailian API key.
- `GEMINI_API_KEY`: Gemini API key.
- `DEEPSEEK_API_KEY`: DeepSeek API key.
- `UNSLOTH_API_KEY`: local Unsloth Studio bearer token for dictionary-generation scripts. Do not commit the token value.

Cloudflare bindings are configured in `wrangler.jsonc`:

- `ASSETS`: Workers Assets from `./dist`.
- `CACHE`: KV namespace for translation cache, rate limit counters, and model settings.
- `DB`: D1 database for dictionary lookup.
- `AI`: native Cloudflare Workers AI inference binding.

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
  "error": "DashScope API Key is not configured.",
  "error_code": "PROVIDER_CONFIG_MISSING",
  "provider": "dashscope",
  "model": "qwen3.6-flash"
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

## Local LLM Cluster: Unsloth Studio

Dictionary generation now targets Unsloth Studio's OpenAI-compatible API instead of Ollama. The service uses:

- `GET /v1/models` to list loaded models.
- `GET /v1/status` to inspect active/loading models and runtime capabilities.
- `POST /v1/load` to load a local model.
- `POST /v1/chat/completions` for non-streaming or streaming chat completion.

Every request must include:

```text
Authorization: Bearer <UNSLOTH_API_KEY>
```

Current jump-host forwarding for the nodes used by this project:

| Node         | Base URL                    | Target               |
| ------------ | --------------------------- | -------------------- |
| `gpu-node-a6000`  | `http://100.64.0.1:11441` | `10.0.0.143:8888` |
| `gpu-node-a6000`  | `http://100.64.0.1:11444` | `172.23.4.53:8888`   |
| `rtx4090-47` | `http://100.64.0.1:11448` | `172.23.4.47:8888`   |
| `rtx4090-56` | `http://100.64.0.1:11447` | `172.23.4.56:8888`   |

Smoke-test the cluster with:

```bash
UNSLOTH_API_KEY=sk-unsloth-... npm run dict:v2:test:unsloth -- --out logs/unsloth-studio-cluster-test.json
```

PowerShell:

```powershell
$env:UNSLOTH_API_KEY = "sk-unsloth-..."
npm run dict:v2:test:unsloth -- --out logs\unsloth-studio-cluster-test.json
```

The test script loads `unsloth/Qwen3.6-35B-A3B-MTP-GGUF` where needed, then runs a compact four-language dictionary JSON task. It automatically disables MTP speculation on nodes whose `/v1/status` reports that MTP is unsupported.

Latest smoke result on 2026-06-22: `gpu-node-a6000`, `gpu-node-a6000`, `rtx4090-47`, and `rtx4090-56` all loaded or reused `Qwen3.6-35B-A3B-MTP-GGUF` successfully and returned `10/10` structured dictionary smoke-test output. Detailed output is in `logs/unsloth-studio-cluster-test-20260622.json`.

Current dictionary-generation model choice, verified on 2026-06-23:

- Model: `unsloth/Qwen3.6-35B-A3B-MTP-GGUF`.
- Preferred GGUF quantization: `UD-IQ4_NL`.
- Runtime parameters: `max_seq_length=8192`, `speculative_type=mtp`, `batch-size=1`, one concurrent worker per GPU endpoint.
- `UD-IQ4_NL` is preferred over `UD-Q4_K_XL`, `MXFP4_MOE`, and `UD-Q4_K_S` for this project because it kept the same validation pass rate in the source-gap task while reducing VRAM pressure and improving speed.
- The repo is detected as a vision model by Unsloth Studio and currently auto-loads `mmproj-F16.gguf`. The `/v1/load` OpenAPI schema exposes `gguf_variant`, `max_seq_length`, `speculative_type`, `spec_draft_n_max`, `tensor_parallel`, and `llama_extra_args`, but no documented `vision=false` or `mmproj=false` switch. Plan capacity assuming `mmproj` remains loaded.

Verified source-gap dry-run benchmarks:

| Node(s)                     | Variant     | Result          | Throughput                           |
| --------------------------- | ----------- | --------------- | ------------------------------------ |
| `gpu-node-a6000`                 | `UD-IQ4_NL` | 48/50 accepted  | 38.96 accepted/min                   |
| `rtx4090-56`                | `UD-IQ4_NL` | 47/50 accepted  | 51.66 accepted/min                   |
| `rtx4090-47`                | `UD-IQ4_NL` | 47/50 accepted  | 46.64 accepted/min                   |
| `rtx4090-56` + `rtx4090-47` | `UD-IQ4_NL` | 96/100 accepted | about 90-100 accepted/min wall-clock |

On both 4090 nodes, `UD-IQ4_NL` loaded with `-ngl -1`, `--flash-attn on`, `--spec-type draft-mtp`, and about 19.8 GB / 24.6 GB VRAM used. This is effectively full GPU offload for the model layers; observed CPU usage is normal llama-server scheduling, tokenization, HTTP, and sampling overhead.

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
docs/dictionary-v83-large-batch-runbook.md
docs/DECISIONS.md
docs/TODO.md
```
