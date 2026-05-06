# Codex Handoff

This file is written for a new Codex session. Read it before making changes.

## Project Goal

Build and maintain an iPhone-installable PWA translation app.

The app should feel like a small native dictionary/translator:

- Fast word lookup.
- Four-language results.
- Smooth mobile interactions.
- Stable card and button dimensions.
- Backend-controlled provider/model settings.

## Current Product Behavior

The UI supports:

- Input for words or sentences.
- Clear and translate buttons.
- Dark mode button.
- Settings modal for provider/model selection.
- Dictionary stats in settings.
- Result tabs ordered as EN, PT, Chinese, Japanese.
- Single-language scoped result display: selecting a tab shows only that language's translation, explanation, and example.
- Local history with duplicate promotion instead of duplicate rows.

## Core Files

Read these first:

```text
README.md
docs/ARCHITECTURE.md
public/index.html
public/app.js
src/styles.css
src/index.ts
```

Do not edit `public/styles.css` directly. Edit `src/styles.css`, then run:

```bash
npm run style:build
```

## Backend Flow

`src/index.ts` handles API routes.

Important routes:

- `/api/translate`: main translation API.
- `/api/settings`: reads/saves backend model provider settings.
- `/api/dictionary/stats`: proxies Louis dictionary stats.

Translation order:

1. Detect whether input is likely a single word.
2. If word-like, try Louis dictionary lookup first.
3. If dictionary hit, return a frontend-compatible response with `provider: "dictionary"` and `cached: true`.
4. If dictionary misses or is unavailable, silently fall back to configured model provider.
5. Sentences go directly to model providers.

## Frontend Constraints

The UI has been tuned repeatedly. Preserve these constraints:

- Mobile input focus must not cause sudden card jumps.
- Loading-to-result transition must not change result card height.
- Button text must not change button dimensions.
- Button feedback must not use `scale()` because it creates visual size jitter.
- Use brightness/filter/opacity feedback instead.
- Result tab switching must animate with a sliding indicator.
- Tab switching must not change `resultCard` or `translationCard` height.
- Settings overlay must cover the whole viewport and sit above result cards.
- Dark mode should update status bar/theme color immediately.
- Result layout on desktop is three-column: history, input, result.

## Current Motion System

Safe animation properties:

- `opacity`
- `filter`
- `background-color`
- `color`
- `box-shadow`
- `transform` only for non-layout overlays or pseudo-elements

Avoid animating:

- `height`
- `padding`
- `margin`
- `top`
- `scale()` on buttons

Important CSS pieces:

- `.result-language-tabs::before`: sliding tab indicator.
- `.content-swap`: language content transition.
- `.section-appear`: section reveal.
- `button:active`: brightness feedback, not scale.

## Verification Checklist

Before deploying UI changes, run:

```bash
npm run style:build
npm run check
node scripts/mobile-devtools-jump-audit.mjs
node scripts/mobile-translate-height-check.mjs
node scripts/interaction-motion-check.mjs
```

Expected results:

- Loading-to-result layout shift should be `0`.
- `resultCard`, `resultHead`, tabs, translation card, and buttons should keep stable dimensions.
- Tab indicator should animate between tabs.
- Tab switching should keep result and translation card height deltas at `0`.

## Common Commands

```bash
npm install
npm run style:build
npm run check
npm run deploy
```

## Current Production URL

```text
https://translation-pwa.qhzggzh-linguago.workers.dev
```

## Common Pitfalls

- Do not edit generated `public/styles.css` without also updating `src/styles.css`.
- Do not expose `DICTIONARY_API_TOKEN` to the browser.
- Do not assume frontend settings are enough; model settings can be stored in the backend.
- Do not reintroduce `button:active { transform: scale(...) }`.
- Do not let bilingual labels wrap inside fixed-size buttons.
- Do not rebuild result tabs on every click if you want smooth tab animation.
- Do not let loading UI use different heights than final result UI.

## Good First Task For New Codex Session

Ask the new session to run:

```text
Please read README.md and docs/CODEX_HANDOFF.md. Then summarize the architecture, current UI constraints, and deployment workflow before making changes.
```
