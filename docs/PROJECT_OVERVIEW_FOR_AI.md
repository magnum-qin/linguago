# LinguaGo Project Overview For AI

This is the high-signal briefing for AI coding agents working in this repository.

## One-Sentence Summary

LinguaGo is a Cloudflare-hosted Vue PWA for multilingual translation and dictionary lookup, with dictionary-first word lookup, provider/model switching, KV caching, and structured streaming translation.

## Current Architecture

- Frontend: Vue 3 + Vuetify + Tailwind CSS built by Vite.
- Frontend entry: `index.html` -> `src/main.ts` -> `src/App.vue`.
- Backend: Cloudflare Worker in `worker/index.ts`.
- Static hosting: Workers Assets from `dist/`.
- Cache/settings/rate limits: Cloudflare KV binding `CACHE`.
- Dictionary: Cloudflare D1 binding `DB` is the production source of truth; optional Louis SQLite API support remains behind `DICTIONARY_API_URL` and `DICTIONARY_API_TOKEN`.
- Dictionary-generation LLM runtime: Unsloth Studio OpenAI-compatible API on the GPU cluster, replacing the older Ollama workflow.
- Deployment: Wrangler via `npm run deploy`.

## Read These First

```text
README.md
docs/PROJECT_OVERVIEW_FOR_AI.md
docs/ARCHITECTURE.md
docs/CODEX_HANDOFF.md
docs/DECISIONS.md
docs/TODO.md
package.json
wrangler.jsonc
src/App.vue
src/composables/useTranslation.ts
src/composables/useSettings.ts
worker/index.ts
worker/dictionary.ts
worker/config.ts
```

## Important Current Paths

- `src/components/TranslatorCard.vue`: input UI.
- `src/components/ResultCard.vue`: result tabs, dictionary/model badge, report action.
- `src/components/SettingsOverlay.vue`: provider/model settings and dictionary stats.
- `src/composables/useTranslation.ts`: streaming translation loop.
- `src/composables/useSettings.ts`: local settings, model defaults, language labels.
- `src/utils/api.js`: frontend API calls.
- `src/assets/tailwind.css`: app styling source.
- `public/sw.js`: PWA service worker.
- `worker/index.ts`: Worker route dispatch and translation orchestration.
- `worker/dictionary.ts`: D1/Louis/mock dictionary adapter stack.
- `worker/config.ts`: backend model catalog and cache version.

## Stale Historical Paths

The project used to be a plain frontend. These references are stale unless a migration task explicitly restores them:

- `public/index.html`
- `public/app.js`
- `public/styles.css`
- `src/index.ts`
- `src/styles.css`
- `npm run style:build`

If you see those in docs or scripts, update them to the Vue/Vite structure before relying on them.

## Runtime Flow

```text
Browser / installed PWA
  |
  | Vite assets + POST /api/*
  v
Cloudflare Worker
  |
  +-- KV cache/settings/rate-limit
  +-- D1 dictionary lookup
  +-- optional Louis dictionary API fallback
  +-- selected model provider
```

## API Routes

Implemented in `worker/index.ts`:

- `POST /api/translate`
- `POST /api/translate-stream`
- `POST /api/report-error`
- `GET /api/models`
- `GET/POST /api/settings`
- `GET /api/dictionary/stats`
- `GET /api/health`
- `GET /health`

Unknown routes are served through `env.ASSETS`.

## Translation Flow

```text
request
  |
  +-- normalize input and target language
  +-- rate-limit
  +-- select provider/model
  +-- check KV translation cache
  +-- if word-like: try dictionary adapters
  |     +-- D1
  |     +-- optional Louis SQLite API
  |     +-- mock JMDict test adapter
  +-- if dictionary miss: call model provider
  +-- parse and validate provider JSON
  +-- normalize frontend response
  +-- write KV cache
  +-- return final response
```

Streaming uses newline-delimited JSON events:

- `status`
- `partial_translation`
- `partial_explanation`
- `final`
- `done`
- `error`

Dictionary and cache hits can return only `status`, `final`, and `done`.

## Result Model

The normalized response includes:

```ts
{
  type: "word" | "sentence";
  detected_source_lang: string;
  target_lang: "en" | "zh" | "pt-BR" | "ja";
  original: string;
  translation: string;
  translations: Record<"en" | "zh" | "pt-BR" | "ja", {
    text: string;
    phonetic: string;
    audio_text: string;
  }>;
  provider: "dictionary" | "deepseek" | "gemini" | "dashscope" | "openrouter";
  model: string;
  cached: boolean;
}
```

Sentence responses also include `explanation` and language-keyed `explanations`.

Word responses also include `phonetic`, `audio_text`, `word_details`, `senses`, and `examples`.

## Current New/Old Mix Risks

- Documentation had many plain-frontend references after the Vue/Vite migration.
- `scripts/sw-cache-check.mjs` was still checking for removed `public/index.html`, `/app.js`, and `/styles.css`.
- `npm run check` needed Vue and JS API declaration files after the migration.
- `worker/dictionary.ts` still contains D1, Louis SQLite API, and mock JMDict adapters, but D1 v2 is the production source of truth. Dictionary adapter failures should fall back to model translation through `safeLookupDictionaryFirst`.
- Many untracked root files are SQL dumps, logs, transfer archives, and scratch scripts. Review before staging anything.

## Cache Rules

- Worker translation cache version is `TRANSLATION_CACHE_VERSION` in `worker/config.ts`.
- Service worker shell cache name is `CACHE_NAME` in `public/sw.js`.
- `/api/*` must stay network-only in the service worker.
- Vite hashed `/assets/*` can be cache-first.
- Navigations should stay network-first with cached `index.html` fallback.

## Commands

```bash
npm install
npm run dev
npm run dev:worker
npm run build
npm run check
npm run check:all
npm run deploy
```

PowerShell may block `npm.ps1`; use `npm.cmd run <script>` if needed.

## GPU Cluster Notes

The active local LLM API is Unsloth Studio, not Ollama. Use OpenAI-compatible endpoints with a bearer token:

- `GET /v1/status`
- `GET /v1/models`
- `POST /v1/load`
- `POST /v1/chat/completions`

Project-approved test nodes and jump-host forwarding:

| Node | Base URL | Target |
| --- | --- | --- |
| `a6000-143` | `http://100.99.99.99:11441` | `192.168.2.143:8888` |
| `a6000-147` | `http://100.99.99.99:11444` | `172.23.4.53:8888` |
| `rtx4090-47` | `http://100.99.99.99:11448` | `172.23.4.47:8888` |
| `rtx4090-56` | `http://100.99.99.99:11447` | `172.23.4.56:8888` |

Run the cluster smoke test with `UNSLOTH_API_KEY` set:

```bash
npm run dict:v2:test:unsloth -- --out logs/unsloth-studio-cluster-test.json
```

The smoke test currently targets `unsloth/Qwen3.6-35B-A3B-MTP-GGUF`, uses `/v1/load` before `/v1/chat/completions`, and disables MTP automatically for nodes whose `/v1/status` reports no MTP support. On 2026-06-22 all four listed nodes passed the structured dictionary test with `10/10`; see `logs/unsloth-studio-cluster-test-20260622.json`.

Current production-generation guidance from the 2026-06-23 source-gap benchmarks:

- Use `unsloth/Qwen3.6-35B-A3B-MTP-GGUF` with `gguf_variant=UD-IQ4_NL`.
- Use `max_seq_length=8192`, `speculative_type=mtp`, `batch-size=1`, and one worker per GPU endpoint.
- `rtx4090-56` (`11447`) and `rtx4090-47` (`11448`) both run `UD-IQ4_NL` with `-ngl -1` full layer GPU offload, `--flash-attn on`, `--spec-type draft-mtp`, and about 19.8 GB VRAM used. This avoids the previous `UD-Q4_K_XL` 4090 VRAM pressure and CPU offload problem.
- Measured source-gap dry-run throughput: `rtx4090-56` 47/50 accepted at 51.66 accepted/min, `rtx4090-47` 47/50 accepted at 46.64 accepted/min, dual 4090 96/100 accepted at about 90-100 accepted/min wall-clock. `a6000-155` with the same variant produced 48/50 accepted at 38.96 accepted/min.
- Unsloth Studio detects the Qwen3.6 MTP repo as a vision model and auto-adds `mmproj-F16.gguf`. Local OpenAPI exposes `gguf_variant`, `max_seq_length`, `speculative_type`, `spec_draft_n_max`, `tensor_parallel`, and `llama_extra_args`, but no supported `vision=false` or `mmproj=false` load option. Do not assume mmproj can be disabled through `/v1/load`.

## Current Dictionary Baseline

The current online D1 baseline is v68:

- Worker cache version: `v68-source-gap-25`.
- Worker version: `884c0937-2e60-4c6d-873b-0de5516328c6`.
- Published counts: `entries=23550`, `senses=29067`,
  `sense_localizations=116268`, `examples=3030`,
  `example_localizations=11898`.
- D1 `published_at`: `2026-06-30T17:05:29.385Z`.
- The pt-BR source-gap pass is complete for `270/271` candidates. The remaining
  candidate is `ouvintes/ouvinte`, kept in `needs_review` because the plural
  source row was linked to a singular entry.
- The zh-only source-gap pilot has two published batches: first `19/19`, then
  `80/80` after excluding low-value/proper-name candidates and tightening
  `gloss_key` width validation.
- The first balanced v64 source-gap batch accepted `80/80` in dry-run and
  promoted `78/80`; the two rejected pt-BR plural/gender form rows remain in
  draft review because their source term does not match the reused entry.
- The v66 strict zh pass used `Qwen3.6-27B-MTP-GGUF` with `--prompt-mode ultra`,
  accepted `20/21` dry-run rows, promoted `20` new zh source-gap senses, and
  left `平安夜` for review because the model returned romaji instead of kana.
- The v67 follow-up manually repaired and promoted `平安夜` as `Christmas Eve`
  with four-language localizations after the model repeatedly returned romaji
  for Japanese reading.
- The v68 follow-up generated a strict zh-first source-gap batch on `rtx4090-56`:
  `25/25` generated rows passed dry-run, `25` draft senses were written, and
  deterministic promote accepted all `25`. The two known pt-BR residual drafts
  are still held in review.

Source-gap generation flow:

1. Filter clean coverage gaps.
2. Run Unsloth dry-run first.
3. Apply only to draft/needs-review rows.
4. Promote only through deterministic validation.
5. Run product fast/full audits and online focused checks before publishing.

## UI Constraints

Preserve these unless explicitly asked to redesign:

- Result tabs should keep stable layout.
- Loading and final results should not create avoidable card jumps.
- Settings overlay must stay above app content.
- Theme should apply before first paint via the head bootstrap script.
- Service worker must not cache API responses.
- Keep model defaults aligned between `worker/config.ts` and `src/composables/useSettings.ts`.

## Recommended AI Onboarding Prompt

```text
Read README.md, docs/PROJECT_OVERVIEW_FOR_AI.md, docs/ARCHITECTURE.md, and docs/CODEX_HANDOFF.md. Summarize the current Vue/Vite frontend, Worker API, dictionary adapter stack, cache rules, and known migration cleanup items before editing files.
```
