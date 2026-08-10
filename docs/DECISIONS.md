# Design And Engineering Decisions

This document records important decisions so future sessions do not repeat old mistakes.

## 1. Vue/Vite Frontend Is Current

The app currently uses Vue 3, Vuetify, Tailwind CSS, and Vite.

Reason:

- The previous plain frontend was replaced by componentized Vue code.
- Vite now owns build output, hashed assets, and development server behavior.
- Wrangler serves `dist/` through Workers Assets.

Decision:

- Treat `src/main.ts`, `src/App.vue`, `src/components/`, and `src/composables/` as the active frontend.
- Treat references to `public/app.js`, `public/index.html`, `public/styles.css`, `src/index.ts`, and `src/styles.css` as stale migration residue.

## 2. Styling Source Lives In The Vue App

`src/assets/tailwind.css` is imported by `src/main.ts` and bundled by Vite.

Reason:

- Tailwind is integrated through `@tailwindcss/vite`.
- The deployed CSS is a hashed file in `dist/assets/`, not a hand-maintained public CSS file.

Decision:

- Edit `src/assets/tailwind.css` and Vue component classes.
- Run `npm run build` for production assets.
- Do not reintroduce generated `public/styles.css`.

## 3. Dictionary First, Model Second

Single-word input checks dictionary adapters before calling a model.

Reason:

- Word lookup should be fast and cheap.
- Curated dictionary entries are more consistent than model output.
- Model calls remain useful for misses and sentences.

Decision:

- Keep dictionary lookup silent and resilient.
- If dictionary sources are unavailable or miss, the Worker should fall back to model providers.

## 4. Dictionary Source Is In Migration

The Worker currently composes D1, Louis SQLite API, and mock JMDict adapters.

Reason:

- D1 enables Cloudflare-native dictionary lookup.
- Louis remains useful for stats and legacy/remote data.
- The mock adapter appears to be test/migration residue.

Decision:

- Be explicit about adapter ordering and model labels.
- Do not assume Louis is the only dictionary source anymore.
- Clean up the mock adapter when a real test fixture or production source replaces it.

## 5. Worker Proxies Dictionary Stats

The frontend calls the Worker for dictionary stats instead of calling Louis directly.

Reason:

- The Louis API token must not be exposed to browsers.
- The Worker can normalize failures and keep the UI simple.

Decision:

- Keep `DICTIONARY_API_TOKEN` in Worker secrets.
- Keep browser calls token-free.

## 6. Backend-Stored Model Settings

The settings overlay can save provider/model name to the backend.

Reason:

- Users should not need to edit code to switch models.
- Installed PWA instances can share the backend preferred model.

Decision:

- Use `/api/settings` for persisted provider/model settings.
- Keep frontend local settings as a convenience, but keep backend settings authoritative for Worker calls.

## 7. Provider Support And Health

The Worker supports Cloudflare Workers AI, DashScope, Gemini, DeepSeek, and automatic routing.

Reason:

- The settings UI exposes these providers.
- Explicit provider errors help diagnose missing keys.
- Health checks should diagnose configuration without leaking secrets.

Decision:

- Keep structured translation error codes.
- `/api/health` may expose configured/reachable booleans and dictionary stats, but never secret values.

## 8. EN / PT / Chinese / Japanese Tab Order

Result tabs are ordered:

```text
EN, PT, 中, 日
```

Reason:

- This matches the user's desired learning flow.

Decision:

- Preserve this order unless the user explicitly changes it.

## 9. Stable Button And Card Dimensions

Buttons and result cards should not change height when labels, loading state, or tab content changes.

Reason:

- The mobile PWA feels poor when cards jump or bilingual labels wrap unexpectedly.

Decision:

- Keep controls dimension-stable.
- Avoid button `scale()` feedback.
- Keep provider badge dimensions stable.

## 10. Service Worker Matches Vite

The service worker caches app-shell files and Vite hashed assets.

Reason:

- Vite outputs hashed JS/CSS under `/assets/`.
- API responses must remain live.

Decision:

- Keep `/api/*` network-only.
- Cache `/assets/*` cache-first.
- Keep navigations network-first with cached index fallback.
- Bump `CACHE_NAME` when service worker behavior changes.
