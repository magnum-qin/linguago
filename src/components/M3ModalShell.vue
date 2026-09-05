<script setup lang="ts">
import { computed, useSlots, watch } from 'vue';
import { X } from 'lucide-vue-next';
import { refreshStatusBarColor } from '../composables/useTheme';

const {
  modelValue,
  title,
  titleId,
  closeLabel = '关闭 | Fechar',
  maxWidth = 420,
  fixedHeight = false
} = defineProps<{
  modelValue: boolean;
  title: string;
  titleId: string;
  closeLabel?: string;
  maxWidth?: number | string;
  fixedHeight?: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
}>();

const slots = useSlots();
const contentClasses = computed(() => ['m3-dialog-content', fixedHeight ? 'm3-dialog-content--fixed' : '']);

const requestClose = () => emit('update:modelValue', false);

const handleAfterLeave = () => {
  refreshStatusBarColor();
  setTimeout(refreshStatusBarColor, 80);
};

watch(
  () => modelValue,
  (isOpen) => {
    if (!isOpen) {
      refreshStatusBarColor();
      setTimeout(refreshStatusBarColor, 120);
      setTimeout(refreshStatusBarColor, 260);
    }
  }
);
</script>

<template>
  <Teleport to="body">
    <Transition name="m3-scrim-fade" @after-leave="handleAfterLeave">
      <div
        v-if="modelValue"
        class="m3-dialog-scrim fixed inset-0 z-[2400]"
        @click="requestClose"
      />
    </Transition>
    <div
      v-if="modelValue"
      class="fixed inset-0 z-[2400] flex items-center justify-center p-3 pointer-events-none"
    >
      <Transition name="m3-dialog-transition" @after-leave="handleAfterLeave">
        <div
          v-if="modelValue"
          class="m3-dialog-content pointer-events-auto outline-none"
          :class="contentClasses"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          :style="{ maxWidth: typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth }"
        >
          <div class="m3-dialog-card" :class="{ 'm3-dialog-card--fixed': fixedHeight }">
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
          </div>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>

<style scoped>
.m3-dialog-scrim {
  background: rgb(0 0 0 / 0.45);
}

.m3-dialog-card {
  width: 100%;
  max-height: calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 24px);
  overflow: hidden;
  overscroll-behavior: none;
  display: flex;
  flex-direction: column;
  border: 1px solid color-mix(in srgb, var(--color-m3-outline-variant) 20%, transparent);
  border-radius: 26px;
  background: var(--color-m3-surface-container);
  box-shadow: 0 24px 64px rgb(0 0 0 / 0.22);
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

.m3-dialog-content {
  width: min(100% - 24px, 420px);
  margin: 12px;
  overscroll-behavior: none;
}

.m3-dialog-content--fixed {
  height: min(580px, calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 24px));
}

.m3-scrim-fade-enter-active {
  transition: opacity 340ms cubic-bezier(0.05, 0.7, 0.1, 1);
}

.m3-scrim-fade-leave-active {
  transition: opacity 220ms cubic-bezier(0.3, 0, 0.8, 0.15);
}

.m3-scrim-fade-enter-from,
.m3-scrim-fade-leave-to {
  opacity: 0;
}

.m3-dialog-transition-enter-active {
  transition:
    transform 340ms cubic-bezier(0.05, 0.7, 0.1, 1),
    opacity 260ms cubic-bezier(0.05, 0.7, 0.1, 1);
  will-change: transform, opacity;
}

.m3-dialog-transition-leave-active {
  transition:
    transform 220ms cubic-bezier(0.3, 0, 0.8, 0.15),
    opacity 180ms cubic-bezier(0.3, 0, 0.8, 0.15);
  will-change: transform, opacity;
}

.m3-dialog-transition-enter-from {
  transform: translate3d(0, 24px, 0) scale(0.92);
  opacity: 0;
}

.m3-dialog-transition-leave-to {
  transform: translate3d(0, 14px, 0) scale(0.96);
  opacity: 0;
}
</style>
