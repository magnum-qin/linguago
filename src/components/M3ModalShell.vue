<script setup lang="ts">
import { computed, useSlots } from 'vue';
import { X } from 'lucide-vue-next';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    title: string;
    titleId: string;
    closeLabel?: string;
    maxWidth?: number | string;
    fixedHeight?: boolean;
  }>(),
  {
    closeLabel: '关闭 / Fechar',
    maxWidth: 420,
    fixedHeight: false
  }
);

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
}>();

const slots = useSlots();
const contentClasses = computed(() => ['m3-dialog-content', props.fixedHeight ? 'm3-dialog-content--fixed' : '']);

const requestClose = () => emit('update:modelValue', false);
</script>

<template>
  <v-dialog
    class="m3-dialog"
    :model-value="modelValue"
    :max-width="maxWidth"
    :scrim="true"
    :scrim-opacity="0.4"
    :aria-labelledby="titleId"
    scroll-strategy="block"
    transition="m3-dialog-transition"
    :content-props="{
      class: contentClasses,
      'aria-labelledby': titleId
    }"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card class="m3-dialog-card" :class="{ 'm3-dialog-card--fixed': fixedHeight }">
      <header class="m3-dialog-header" @touchmove.stop.prevent>
        <div class="m3-dialog-title-group">
          <slot name="leading"></slot>
          <slot name="title-icon"></slot>
          <h2 :id="titleId" class="m3-dialog-title">{{ title }}</h2>
        </div>
        <button type="button" class="m3-icon-button" :aria-label="closeLabel" @click="requestClose">
          <X class="h-5 w-5" aria-hidden="true" />
        </button>
      </header>

      <main class="m3-dialog-body">
        <slot></slot>
      </main>

      <footer v-if="slots.actions" class="m3-dialog-actions" @touchmove.stop.prevent>
        <slot name="actions"></slot>
      </footer>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.m3-dialog-card {
  width: 100%;
  max-height: calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 24px);
  overflow: hidden !important;
  overscroll-behavior: none;
  display: flex !important;
  flex-direction: column;
  border: 1px solid color-mix(in srgb, var(--color-m3-outline-variant) 20%, transparent);
  border-radius: 26px !important;
  background: var(--color-m3-surface-container) !important;
  box-shadow: 0 24px 64px rgb(0 0 0 / 0.22) !important;
}

.m3-dialog-card--fixed {
  height: min(580px, calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 24px));
}

.m3-dialog-header {
  min-height: 68px;
  padding: 14px 14px 10px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex: 0 0 auto;
  border-bottom: 1px solid color-mix(in srgb, var(--color-m3-outline-variant) 18%, transparent);
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.m3-dialog-title-group {
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  gap: 10px;
}

.m3-dialog-title {
  min-width: 0;
  color: var(--color-m3-on-surface);
  font-size: 1.08rem;
  line-height: 1.25;
  font-weight: 800;
  letter-spacing: -0.015em;
}

.m3-icon-button {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  border-radius: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-m3-on-surface-variant);
  transition:
    background-color 150ms ease,
    color 150ms ease;
}

.m3-icon-button:hover {
  background: var(--color-m3-surface-container-highest);
  color: var(--color-m3-on-surface);
}

.m3-icon-button:focus-visible {
  outline: 2px solid var(--color-m3-primary);
  outline-offset: 2px;
}

.m3-dialog-body {
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior-y: contain;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
  padding: 16px 20px;
}

.m3-dialog-actions {
  flex: 0 0 auto;
  padding: 12px 20px max(16px, env(safe-area-inset-bottom));
  border-top: 1px solid color-mix(in srgb, var(--color-m3-outline-variant) 18%, transparent);
  background: var(--color-m3-surface-container);
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

:global(.m3-dialog-content) {
  width: min(100% - 24px, 420px) !important;
  margin: 12px !important;
  overscroll-behavior: none;
}

:global(.m3-dialog-content--fixed) {
  height: min(580px, calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 24px));
}

:global(.m3-dialog .v-overlay__scrim) {
  background: rgb(0 0 0 / 0.4) !important;
  opacity: 1 !important;
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}

:global(.m3-dialog-transition-enter-active) {
  transition:
    transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
    opacity 140ms linear;
  will-change: transform, opacity;
}

:global(.m3-dialog-transition-leave-active) {
  transition:
    transform 120ms cubic-bezier(0.4, 0, 1, 1),
    opacity 100ms linear;
  will-change: transform, opacity;
}

:global(.m3-dialog-transition-enter-from),
:global(.m3-dialog-transition-leave-to) {
  transform: translate3d(0, 12px, 0) scale(0.985);
  opacity: 0;
}

@media (max-width: 600px) {
  .m3-dialog-header {
    padding-left: 16px;
  }

  .m3-dialog-body,
  .m3-dialog-actions {
    padding-left: 16px;
    padding-right: 16px;
  }
}

@media (prefers-reduced-motion: reduce) {
  :global(.m3-dialog-transition-enter-active),
  :global(.m3-dialog-transition-leave-active) {
    transition-duration: 1ms;
  }
}
</style>
