# Design And Engineering Decisions

This document records important decisions so future sessions do not repeat old mistakes.

## 1. Plain Frontend Instead Of A Framework

The app currently uses plain HTML, CSS, and JavaScript.

Reason:

- The app is small and performance-sensitive.
- Cloudflare Workers Assets can serve it directly.
- The current UI behavior is highly custom and easier to tune without a component framework.

Decision:

- Keep plain frontend unless the app grows enough to justify React/Vue/Svelte.
- If a framework is introduced later, preserve the existing UX constraints first.

## 2. Tailwind Source CSS, Generated Public CSS

`src/styles.css` is the source file. `public/styles.css` is generated.

Reason:

- Tailwind v4 gives design-token utilities while still allowing custom CSS.
- The generated file is deployed as a static asset.

Decision:

- Edit `src/styles.css`.
- Run `npm run style:build`.
- Do not hand-edit `public/styles.css`.

## 3. Dictionary First, Model Second

Single-word input checks the Louis dictionary API before calling a model.

Reason:

- Word lookup should be fast and cheap.
- Dictionary entries can be curated and cached.
- Model calls remain useful for misses and sentences.

Decision:

- Keep dictionary lookup silent and resilient.
- If Louis is unavailable, the Worker should fall back to model providers instead of failing.

## 4. Worker Proxies Dictionary Stats

The frontend calls the Worker for dictionary stats instead of calling Louis directly.

Reason:

- The Louis API token must not be exposed to browsers.
- The Worker can normalize errors and keep the UI simple.

Decision:

- Keep `DICTIONARY_API_TOKEN` in Cloudflare Worker secrets.
- Keep browser calls token-free.

## 5. Backend-Stored Model Settings

The settings modal can save provider/model name to the backend.

Reason:

- The user should not need to edit code to switch models.
- PWA instances should share the backend's current preferred model.

Decision:

- Use `/api/settings` for persisted provider/model settings.
- The frontend can keep local settings as a convenience, but backend settings are authoritative.

## 6. EN / PT / Chinese / Japanese Tab Order

Result tabs are ordered:

```text
EN, PT, 中, 日
```

Reason:

- This matches the user's desired learning flow.

Decision:

- Preserve this order unless the user explicitly changes it.

## 7. One Language Per Tab

Each selected language tab should show only that language's result.

Reason:

- The user wanted less clutter than showing all languages at once.

Decision:

- Do not show four languages inside one selected tab.
- Word, explanation, and example sections should all scope to the selected tab.

## 8. Stable Button And Card Dimensions

Buttons and result cards must not change height when labels or loading state change.

Reason:

- iPhone UI felt jumpy when bilingual labels wrapped or when loading changed card height.

Decision:

- Buttons use fixed heights.
- Bilingual button labels are constrained.
- Loading and result states share stable dimensions.
- Avoid button `scale()` feedback.

## 9. Safe Motion Over Layout Motion

The interaction system prefers visual-only animations.

Reason:

- Layout-affecting motion caused repeated mobile jumps.

Decision:

- Prefer `opacity`, `filter`, `background-color`, `color`, and `box-shadow`.
- Use `transform` only when it does not affect layout, such as tab pseudo-element indicators.
- Avoid animating `height`, `padding`, `margin`, or button scale.

## 10. Playwright Checks Are Part Of The Design Process

Several scripts exist to verify layout stability.

Reason:

- Visual regressions were hard to judge by screenshots alone.

Decision:

- Run Playwright checks after changing mobile layout, result cards, tabs, settings modal, or buttons.
