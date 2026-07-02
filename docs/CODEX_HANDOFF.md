# Codex Handoff

Read this before making changes.

## Project Goal

Maintain an iPhone-installable translation/dictionary PWA with:

- Fast word lookup.
- Four-language results.
- Smooth mobile interactions.
- Stable result and control dimensions.
- Backend-controlled provider/model settings.
- Observable provider/dictionary health without exposing secrets.

## Current Product Behavior

The current UI is Vue/Vuetify:

- Text input and translate/clear controls.
- Theme handling with system/light/dark support.
- Settings overlay for provider/model selection.
- Editable provider-specific model lists from `/api/models`.
- Dictionary stats in settings.
- Provider badge for dictionary/cache/model state.
- Result tabs ordered as EN, PT, Chinese, Japanese.
- Bookmarks/history stored locally.
- PWA shell caching with `/api/*` network-only.

## Core Files

Read these first:

```text
README.md
docs/ARCHITECTURE.md
src/App.vue
src/components/TranslatorCard.vue
src/components/ResultCard.vue
src/components/SettingsOverlay.vue
src/composables/useTranslation.ts
src/composables/useSettings.ts
src/utils/api.js
worker/index.ts
worker/dictionary.ts
worker/config.ts
public/sw.js
```

Historical docs may mention `public/app.js`, `public/styles.css`, `src/index.ts`, or `npm run style:build`; those are old plain-frontend paths.

## Backend Flow

`worker/index.ts` handles API routes:

- `/api/translate`
- `/api/translate-stream`
- `/api/report-error`
- `/api/models`
- `/api/settings`
- `/api/dictionary/stats`
- `/api/health`
- `/health`

Translation order:

1. Normalize input, target language, provider, and model.
2. Rate-limit by client IP hash.
3. Select provider/model or load backend settings from KV.
4. Check KV translation cache.
5. If word-like, try dictionary lookup through `CompositeDictionaryManager`.
6. If dictionary misses, call the selected provider.
7. Parse and validate structured provider JSON.
8. Normalize the response and cache it.

Provider JSON is validated in the Worker before normalization. Invalid complete responses retry once with a repair prompt.

Supported providers are `auto`, `openrouter`, `dashscope`, `gemini`, and `deepseek`.

## Dictionary Notes

Current production dictionary source of truth is Cloudflare D1 v2. The v73
baseline was published with:

- `TRANSLATION_CACHE_VERSION = "v73-four-node-source-gap-97"`
- Worker version `1ac2e9a2-b452-4ed9-b714-97a5eabb4014`
- `/health` counts: `entries=24054`, `senses=29571`,
  `sense_localizations=118284`, `examples=3030`,
  `example_localizations=11898`
- D1 `published_at`: `2026-07-02T11:35:54.965Z`

`worker/dictionary.ts` still contains multiple adapters:

- Cloudflare D1 dictionary lookup through `env.DB`.
- Louis SQLite API lookup through `DICTIONARY_API_URL` and `DICTIONARY_API_TOKEN`.
- A narrow mock JMDict adapter.

D1 should be treated as the production path unless a task explicitly asks to
revive Louis. Dictionary lookup failures are isolated by
`safeLookupDictionaryFirst` in `worker/index.ts`; D1/Louis errors should fall
through to model translation instead of failing the whole request.

Current source-gap generation uses Unsloth Studio, not Ollama. LLM output must
stay in draft/needs-review rows until deterministic promotion passes. The
latest pt-BR source-gap run completed `270/271` candidates; the remaining
manual item is `ouvintes` linked to singular entry `ouvinte`. The first zh-only
pilot promoted `19/19` generated draft senses after adding stricter prompt rules
that prevent Chinese source terms from being copied into English/Portuguese
terms.

The v69 A6000 source-gap follow-up used `a6000-143` and `a6000-147`
(`100.99.99.99:11441` and `100.99.99.99:11444`) with Unsloth
`unsloth/Qwen3.6-35B-A3B-MTP-GGUF` / `UD-Q4_K_XL`. The 20-row dry-run accepted
`20/20`; the 100-row draft apply accepted `99/100`; deterministic promote
accepted `94` senses and left `7` source-term mismatches in draft review
(`罷/霸`, `臺/苔`, `赴/敷`, `濟/積`, `扬/洋`, `ouvinte/ouvintes`,
`bisavô/bisavó`).

The v70 source-gap follow-up fixed an over-broad pre-generation skip rule so
Chinese source gaps with English glosses containing `one's` are not treated as
English possessive/demonstrative entries. A 20-row A6000 dry-run accepted all
`17/17` generated rows after three already-complete pt-BR rows were skipped.
The 100-row draft apply accepted `99/100`; deterministic promote accepted all
`99` draft senses.

The v71 source-gap follow-up tightened candidate filtering again: English
capitalized proper-like headwords and zh candidates whose gloss is only a
Latin proper name are filtered out, and the repeated `audible` football-play
residual is blocked for generic batches. The strict v71 filter found no clean
zh candidates; the batch was mostly English high-value gaps. A 20-row A6000
dry-run accepted `19/20` with only `audible` rejected, then the 100-row draft
apply accepted `98/100` after skipping three already-complete rows.
Deterministic promote accepted the `98` new draft senses. Product fast/full
audits and online API/render checks passed after publishing.

The v72 source-gap batch used all four active Unsloth nodes together:
`a6000-143` / `a6000-147` with
`unsloth/Qwen3.6-35B-A3B-MTP-GGUF` `UD-Q4_K_XL`, and `rtx4090-47` /
`rtx4090-56` with the lower-memory 35B MTP variant. The A6000 half accepted
`60/60`; the 4090 half selected `60`, skipped `3` already-linked complete
source gaps, accepted `56`, and rejected `1` transient JSON parse failure
(`touchy`). Deterministic promote accepted `116` new draft senses and `464`
localizations. Product fast audit, published-risk audit, and full D1 native
export audit passed. The export directory is
`outputs/d1-v2-product-native-export-v72-four-node-source-gap-116`, with
`entries=23957`, `senses=29474`, and `sense_localizations=117896`.

The v73 source-gap batch repeated the same four-node split after regenerating
coverage gaps from v72. The strict clean filter produced `137` candidates:
`134` English and `3` pt-BR. A 20-row dry-run accepted `20/20`; the 100-row
apply selected `100`, skipped `3` already-linked complete rows, generated `97`,
accepted `97`, and rejected `0`. Deterministic promote accepted all `97` new
draft senses and `388` localizations, while the seven older source-term
mismatch residual drafts remain in review. Product fast audit, published-risk
audit, and full D1 native export audit passed. The export directory is
`outputs/d1-v2-product-native-export-v73-four-node-source-gap-97`, with
`entries=24054`, `senses=29571`, and `sense_localizations=118284`.

## Frontend Constraints

Preserve these unless explicitly asked to redesign:

- Mobile input focus should not create sudden card jumps.
- Loading-to-result transition should keep result cards stable.
- Buttons should not resize between idle/loading states.
- Do not use `transform: scale()` for button feedback.
- Result tab switching should not make card height jump.
- Provider badge should stay compact and stable.
- Settings overlay must cover the viewport and sit above app content.
- Theme changes should update document theme data and status-bar color promptly.

## Service Worker Rules

- `public/sw.js` owns app-shell behavior.
- `/api/*` must stay network-only.
- Navigations should be network-first with cached index fallback.
- Vite hashed `/assets/*` can be cache-first.
- Bump `CACHE_NAME` when app-shell behavior changes.

## Verification Checklist

```bash
npm run build
npm run check
npm run check:all
npm run check:dictionary-fixture
npm run check:worker-dictionary-fallback
```

Use targeted Playwright scripts after layout or interaction changes:

```bash
node scripts/result-tabs-check.mjs
node scripts/system-theme-check.mjs
node scripts/mobile-translate-height-check.mjs
```

Some scripts were written for the old plain frontend. Confirm a script targets current Vue DOM before treating it as authoritative.

## Common Commands

```bash
npm install
npm run dev
npm run dev:worker
npm run build
npm run check
npm run deploy
```

In PowerShell, `npm` may be blocked by execution policy; use `npm.cmd run <script>`.

## Current Production URL

```text
https://translation-pwa.qhzggzh-linguago.workers.dev
```

## Common Pitfalls

- Do not edit deleted/plain-frontend files mentioned in stale docs.
- Do not expose `DICTIONARY_API_TOKEN` or provider API keys.
- Do not expose secret values through `/api/health`.
- Keep frontend model defaults aligned with backend `/api/models`.
- Do not bypass provider JSON validation.
- Do not let `/api/*` responses be cached by the service worker.
- Review untracked SQL/log/archive/scratch files before committing.
