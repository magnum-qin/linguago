# Refactoring to Vuetify while Preserving MD3 Expressive UI

This plan outlines how we will use Vuetify's native components (`v-btn`, `v-card`, `v-select`, `v-dialog`, `v-tabs`) without losing the highly polished, custom aesthetics of the original interface. Our previous attempt resulted in generic styles because Vuetify's default CSS overrode our meticulous Tailwind styles. This time, we will seamlessly blend Vuetify and Tailwind.

## User Review Required

> [!IMPORTANT]
> **Performance vs. Aesthetics Trade-off**
> Vuetify components come with built-in DOM structures (like ripples, overlays, and extra wrapper `div`s). To achieve the **exact same smooth spring animations** (especially for the sliding tab indicator) and **exact custom shapes** (like the asymmetric bottom-right translation button), we will need to use aggressive CSS overrides (`:deep()`) and hide some of Vuetify's default behaviors. 
> 
> Please confirm if you are okay with us using extensive `:deep()` CSS overrides on Vuetify components to force them into our custom shapes and animations.

## Open Questions

> [!WARNING]
> **Select Component vs. Menu Component**
> The original `M3Select.vue` was a fully custom button opening a floating menu. If we use Vuetify's native `<v-select>`, it comes with standard input field styling (like an underline or solo flat background) and a standard list popup. To keep it looking *exactly* like the original, we might need to use `<v-menu>` with a `<v-list>` attached to a custom `<v-btn>` instead of a `<v-select>`. 
> 
> **Question**: Should we strictly use `<v-select>` (and try to style it to look custom), or is it acceptable to use `<v-menu>` to build the select dropdown natively while preserving 100% of the original look?

## Proposed Changes

### 1. Project Configuration
- **Re-install Vuetify**: `npm install vuetify vite-plugin-vuetify`
- **Configure Vuetify Plugin**: Update `vite.config.ts` and `src/main.ts` to load Vuetify.
- **Tailwind Coexistence**: Update `src/assets/tailwind.css` to add reset classes that prevent Vuetify from modifying global font sizes, line heights, or overriding the active theme's background color.

---

### 2. UI Components

#### [MODIFY] TranslatorCard.vue
- **Cards**: Replace outer `<div class="bg-m3-surface-container ...">` with `<v-card class="...">`. We will keep `rounded-expressive-asym` and manually remove Vuetify's default `elevation`.
- **Buttons**: Replace native `<button>` with `<v-btn>`. 
  - To keep the exact bottom-right rectangular corner for the translation button, we will override its border radius using Tailwind classes (`!rounded-br-none` or similar).
  - To fix the text color issue, we will explicitly pass `color="primary"` or use `variant="text"` combined with Tailwind's text color utilities, disabling Vuetify's internal text-color computation where it conflicts.

#### [MODIFY] ResultCard.vue
- **Tabs**: Replace the custom CSS grid sliding indicator with `<v-tabs>`. 
  - **Critical Styling**: We will hide Vuetify's native `.v-tabs-slider-wrapper` completely via CSS. Instead, we will use our own floating pill `div` inside the tab container and bind its `left` and `width` dynamically using the `@update:modelValue` hook and DOM measurements, exactly as we did before, but layered over the `<v-tabs>`.
- **Action Buttons**: Convert Star, Flag, and Audio buttons to `<v-btn icon variant="flat">` with exact dimension overrides (`width="44" height="44"`).

#### [MODIFY] SettingsOverlay.vue
- **Dialog**: Replace the custom fixed backdrop with `<v-dialog max-width="420">`.
- **Dropdowns**: Convert `<M3Select>` to `<v-select variant="solo-flat" hide-details>`.
  - We will use `:deep(.v-field__overlay)` and `:deep(.v-field__outline)` to hide the default background and borders, injecting our `bg-m3-surface-container` and `border-m3-outline-variant/30` via classes.
- **Bottom Buttons**: Convert the Cancel and Confirm buttons to `<v-btn>`.
  - **Critical Fix**: We will explicitly set the text color of the Cancel button to avoid the "white text on white background" issue (e.g., `class="text-m3-on-surface-variant bg-m3-surface-container-highest"`).

#### [DELETE] M3Select.vue
- Remove this component as we will natively use `<v-select>` or `<v-menu>` with Vuetify inputs.

## Verification Plan

### Manual Verification
1. Open the UI and verify that the translation card's bottom-right button fits perfectly into the corner.
2. Open Settings and verify that the dropdown menus have proper borders, custom backgrounds, and the Cancel/Confirm buttons are highly readable.
3. Perform a translation and verify the Tab sliding pill animates smoothly without jumping.
4. Verify that the dynamic theme color switcher successfully changes both Tailwind's CSS variables and Vuetify's internal color palette simultaneously.
