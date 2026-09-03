<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch, useTemplateRef } from 'vue';
import { ArrowRight } from 'lucide-vue-next';

const {
  modelValue,
  title,
  titleId,
  closeLabel = '关闭 | Fechar'
} = defineProps<{
  modelValue: boolean;
  title: string;
  titleId: string;
  closeLabel?: string;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
}>();

const drawer = useTemplateRef<HTMLElement>('drawer');
let previousFocus: HTMLElement | null = null;
let previousBodyOverflow = '';
let previousRootOverflow = '';

const restorePageScroll = () => {
  document.body.style.overflow = previousBodyOverflow;
  document.documentElement.style.overflow = previousRootOverflow;
};

const close = () => emit('update:modelValue', false);

const focusableElements = () =>
  drawer.value
    ? Array.from(
        drawer.value.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      )
    : [];

const handleKeydown = (event: KeyboardEvent) => {
  if (!modelValue) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== 'Tab') return;

  const elements = focusableElements();
  if (!elements.length) return;
  const first = elements[0];
  const last = elements[elements.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
};

watch(
  () => modelValue,
  async (open) => {
    if (open) {
      previousFocus = document.activeElement as HTMLElement | null;
      previousBodyOverflow = document.body.style.overflow;
      previousRootOverflow = document.documentElement.style.overflow;
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
      document.addEventListener('keydown', handleKeydown);
      await nextTick();
      focusableElements()[0]?.focus();
    } else {
      document.removeEventListener('keydown', handleKeydown);
      restorePageScroll();
      previousFocus?.focus();
      previousFocus = null;
    }
  }
);

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown);
  restorePageScroll();
});
</script>

<template>
  <Teleport to="body">
    <Transition name="m3-drawer-backdrop">
      <button
        v-if="modelValue"
        type="button"
        class="m3-drawer-backdrop"
        :aria-label="closeLabel"
        @click="close"
      ></button>
    </Transition>

    <Transition name="m3-drawer-slide">
      <aside
        v-if="modelValue"
        ref="drawer"
        class="m3-drawer"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
      >
        <header class="m3-drawer-header">
          <div class="m3-drawer-title-group">
            <slot name="icon"></slot>
            <h2 :id="titleId" class="m3-drawer-title">{{ title }}</h2>
          </div>
          <button type="button" class="m3-drawer-close" :aria-label="closeLabel" @click="close">
            <ArrowRight class="h-5 w-5" aria-hidden="true" />
          </button>
        </header>
        <div class="m3-drawer-body">
          <slot></slot>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.m3-drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  width: 100%;
  height: 100%;
  background: rgb(0 0 0 / 0.32);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}

.m3-drawer {
  position: fixed;
  inset-block: 0;
  right: 0;
  z-index: 50;
  width: min(400px, 90vw);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-m3-surface);
  color: var(--color-m3-on-surface);
  box-shadow: -18px 0 50px rgb(0 0 0 / 0.2);
}

.m3-drawer-header {
  min-height: 72px;
  padding: max(14px, env(safe-area-inset-top)) 16px 12px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex: 0 0 auto;
  border-bottom: 1px solid color-mix(in srgb, var(--color-m3-outline-variant) 20%, transparent);
}

.m3-drawer-title-group {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.m3-drawer-title {
  min-width: 0;
  font-size: 1.05rem;
  line-height: 1.25;
  font-weight: 800;
}

.m3-drawer-close {
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

.m3-drawer-close:hover {
  color: var(--color-m3-on-surface);
  background: var(--color-m3-surface-container-highest);
}

.m3-drawer-close:focus-visible {
  outline: 2px solid var(--color-m3-primary);
  outline-offset: 2px;
}

.m3-drawer-body {
  min-height: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  -webkit-overflow-scrolling: touch;
  padding: 20px 24px max(24px, env(safe-area-inset-bottom));
}

.m3-drawer-backdrop-enter-active,
.m3-drawer-backdrop-leave-active {
  transition: opacity 180ms ease;
}

.m3-drawer-backdrop-enter-from,
.m3-drawer-backdrop-leave-to {
  opacity: 0;
}

.m3-drawer-slide-enter-active,
.m3-drawer-slide-leave-active {
  transition: transform 320ms cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform;
}

.m3-drawer-slide-enter-from,
.m3-drawer-slide-leave-to {
  transform: translate3d(100%, 0, 0);
}

@media (max-width: 600px) {
  .m3-drawer-header {
    padding-left: 20px;
  }

  .m3-drawer-body {
    padding-left: 20px;
    padding-right: 20px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .m3-drawer-backdrop-enter-active,
  .m3-drawer-backdrop-leave-active,
  .m3-drawer-slide-enter-active,
  .m3-drawer-slide-leave-active {
    transition-duration: 1ms;
  }
}
</style>
