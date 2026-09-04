<script setup lang="ts">
import { Sparkles, Loader2 } from 'lucide-vue-next';

const { isTranslating, colorScheme = 'blue' } = defineProps<{
  isTranslating: boolean;
  colorScheme?: string;
}>();
</script>

<template>
  <div class="flex flex-col items-center justify-center py-4 sm:py-8 gap-4 sm:gap-6 mt-1 sm:mt-4">
    <div class="flex flex-col items-center gap-4 sm:gap-6 animate-unified-float w-full">
      <!-- Themed Unified Continuous Loader Container -->
      <div
        class="relative flex items-center justify-center w-28 h-28 continuous-loader"
        :class="[`theme-loader-${colorScheme}`, { 'is-active': isTranslating }]"
      >
        <!-- Continuous Dual-Ring Halo System (Single unified primitive across idle & active) -->
        <div class="continuous-halo halo-ring-1"></div>
        <div class="continuous-halo halo-ring-2"></div>

        <!-- Center floating orb with morphing icon core -->
        <div
          class="center-orb relative bg-m3-surface-container w-16 h-16 rounded-full flex items-center justify-center shadow-sm border border-m3-outline-variant/15 z-10 text-m3-primary transition-all duration-500 ease-spring"
          :class="isTranslating ? 'scale-95 shadow-md' : 'scale-100'"
        >
          <!-- Sparkles (Idle): continuous organic shimmer breathing -->
          <Sparkles
            class="w-7 h-7 absolute transition-all duration-500 ease-spring"
            :class="
              isTranslating
                ? 'scale-0 rotate-45 opacity-0 pointer-events-none'
                : 'scale-100 rotate-0 opacity-100 animate-core-shimmer'
            "
          />
          <!-- Loader2 (Active): smooth accelerating spin -->
          <Loader2
            class="w-7 h-7 absolute transition-all duration-500 ease-spring"
            :class="
              isTranslating
                ? 'scale-100 rotate-0 opacity-100 animate-spin'
                : 'scale-0 -rotate-45 opacity-0 pointer-events-none'
            "
          />
        </div>
      </div>

      <!-- Status Text with M3 Mode-Out-In Smooth Crossfade -->
      <div class="flex flex-col items-center gap-1.5 opacity-80 min-h-[58px] justify-center">
        <Transition name="m3-fade-scale" mode="out-in">
          <div v-if="isTranslating" key="translating" class="flex flex-col items-center">
            <p class="text-m3-on-surface-variant font-bold tracking-[0.15em] text-[0.8rem] uppercase text-center flex items-center">
              <span>解析中</span>
              <span class="text-[0.68rem] opacity-70 tracking-normal font-normal border-l border-current/30 pl-1.5 ml-1.5">Analisando</span>
            </p>
            <p class="text-m3-outline text-[0.85rem] font-medium text-center mt-1 flex flex-col items-center">
              <span>正在加载翻译结果...</span>
              <span class="text-[0.72rem] opacity-70 inline-block mt-0.5">Carregando...</span>
            </p>
          </div>
          <div v-else key="idle" class="flex flex-col items-center">
            <p class="text-m3-on-surface-variant font-bold tracking-[0.15em] text-[0.8rem] uppercase text-center flex items-center">
              <span>等待输入</span>
              <span class="text-[0.68rem] opacity-70 tracking-normal font-normal border-l border-current/30 pl-1.5 ml-1.5">Aguardando</span>
            </p>
            <p class="text-m3-outline text-[0.85rem] font-medium text-center mt-1 flex flex-col items-center">
              <span>支持中 · 英 · 葡 · 日 自动识别</span>
              <span class="text-[0.72rem] opacity-70 inline-block mt-0.5">Suporta detecção auto ZH/EN/PT/JA</span>
            </p>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ==========================================================================
   Continuous Interruptible Motion Engine (FaceID-Style Seamless Transitions)
   ========================================================================== */

/* --- 1. Unified Gentle Float for Entire Element --- */
@keyframes unified-float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-6px);
  }
}

.animate-unified-float {
  animation: unified-float 5s ease-in-out infinite;
  will-change: transform;
}

/* --- 2. Core Star Sparkle Shimmer (Living Center) --- */
@keyframes core-shimmer {
  0%,
  100% {
    transform: scale(0.96);
    opacity: 0.8;
    filter: drop-shadow(0 0 0px transparent);
  }
  50% {
    transform: scale(1.06);
    opacity: 1;
    filter: drop-shadow(0 0 6px color-mix(in srgb, var(--color-m3-primary) 35%, transparent));
  }
}

.animate-core-shimmer {
  animation: core-shimmer 3.2s ease-in-out infinite;
}

/* --- 3. Base Continuous Halo Rings --- */
.continuous-halo {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  pointer-events: none;
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;
  transform: translate3d(0, 0, 0);
  will-change: transform, opacity, border-color;
  transition:
    border-color 500ms cubic-bezier(0.16, 1, 0.3, 1),
    border-style 500ms ease,
    border-width 500ms cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 500ms ease;
}

/* ==========================================================================
   Theme-Specific Continuous Dual-Wave Harmonic Motions
   ========================================================================== */

/* --- A. Rose Theme (Heartfelt Soft Organic Morphing) --- */
.theme-loader-rose .halo-ring-1 {
  border: 1.5px solid color-mix(in srgb, var(--color-m3-primary) 38%, transparent);
  animation: rose-continuous-wave 3.6s ease-in-out infinite;
}
.theme-loader-rose .halo-ring-2 {
  border: 1.5px solid color-mix(in srgb, var(--color-m3-primary) 20%, transparent);
  animation: rose-continuous-wave 3.6s ease-in-out infinite;
  animation-delay: -1.8s; /* 50% Phase Shift for continuous interlocking waves */
}
.theme-loader-rose.is-active .halo-ring-1 {
  border-width: 2px;
  border-color: color-mix(in srgb, var(--color-m3-primary) 65%, transparent);
  animation: continuous-spin-cw 3s linear infinite;
}
.theme-loader-rose.is-active .halo-ring-2 {
  border-width: 1.5px;
  border-color: color-mix(in srgb, var(--color-m3-primary) 30%, transparent);
  animation: continuous-spin-ccw 4.5s linear infinite;
  margin: -4px;
}

@keyframes rose-continuous-wave {
  0%,
  100% {
    transform: scale(0.92) rotate(0deg);
    opacity: 0.3;
    border-radius: 50% 50% 50% 50% / 46% 46% 54% 54%;
  }
  50% {
    transform: scale(1.18) rotate(180deg);
    opacity: 0.85;
    border-radius: 46% 54% 46% 54% / 54% 46% 54% 46%;
  }
}

/* --- B. Blue Theme (Harmonic Water Ripple) --- */
.theme-loader-blue .halo-ring-1 {
  border: 1.5px solid color-mix(in srgb, var(--color-m3-primary) 35%, transparent);
  animation: blue-continuous-wave 3.4s ease-in-out infinite;
}
.theme-loader-blue .halo-ring-2 {
  border: 1.5px solid color-mix(in srgb, var(--color-m3-primary) 20%, transparent);
  animation: blue-continuous-wave 3.4s ease-in-out infinite;
  animation-delay: -1.7s;
}
.theme-loader-blue.is-active .halo-ring-1 {
  border-width: 2.5px;
  border-style: double;
  border-color: color-mix(in srgb, var(--color-m3-primary) 60%, transparent);
  animation: continuous-spin-cw 2.8s linear infinite;
}
.theme-loader-blue.is-active .halo-ring-2 {
  border-width: 1.5px;
  border-color: color-mix(in srgb, var(--color-m3-primary) 35%, transparent);
  animation: continuous-spin-ccw 4.2s linear infinite;
  margin: -4px;
}

@keyframes blue-continuous-wave {
  0%,
  100% {
    transform: scale(0.9);
    opacity: 0.25;
  }
  50% {
    transform: scale(1.16);
    opacity: 0.8;
  }
}

/* --- C. Mint Theme (Forest Living Breath) --- */
.theme-loader-mint .halo-ring-1 {
  border: 1.5px solid color-mix(in srgb, var(--color-m3-primary) 35%, transparent);
  animation: mint-continuous-wave 4s ease-in-out infinite;
}
.theme-loader-mint .halo-ring-2 {
  border: 1.5px solid color-mix(in srgb, var(--color-m3-primary) 18%, transparent);
  animation: mint-continuous-wave 4s ease-in-out infinite;
  animation-delay: -2s;
}
.theme-loader-mint.is-active .halo-ring-1 {
  border-width: 2px;
  border-color: color-mix(in srgb, var(--color-m3-primary) 60%, transparent);
  animation: continuous-spin-cw 3.2s linear infinite;
}
.theme-loader-mint.is-active .halo-ring-2 {
  border-width: 1.5px;
  border-color: color-mix(in srgb, var(--color-m3-primary) 25%, transparent);
  animation: continuous-spin-ccw 5s linear infinite;
  margin: -5px;
}

@keyframes mint-continuous-wave {
  0%,
  100% {
    transform: scale(0.9) rotate(-12deg);
    border-radius: 55% 45% 55% 45% / 45% 55% 45% 55%;
    opacity: 0.3;
  }
  50% {
    transform: scale(1.16) rotate(12deg);
    border-radius: 45% 55% 45% 55% / 55% 45% 55% 45%;
    opacity: 0.85;
  }
}

/* --- D. Amber Theme (Warm Solar Halo) --- */
.theme-loader-amber .halo-ring-1 {
  border: 1.5px solid color-mix(in srgb, var(--color-m3-primary) 35%, transparent);
  animation: amber-continuous-wave 3.2s ease-in-out infinite;
}
.theme-loader-amber .halo-ring-2 {
  border: 1.5px solid color-mix(in srgb, var(--color-m3-primary) 20%, transparent);
  animation: amber-continuous-wave 3.2s ease-in-out infinite;
  animation-delay: -1.6s;
}
.theme-loader-amber.is-active .halo-ring-1 {
  border-width: 2px;
  border-color: color-mix(in srgb, var(--color-m3-primary) 65%, transparent);
  animation: continuous-spin-cw 2.6s linear infinite;
}
.theme-loader-amber.is-active .halo-ring-2 {
  border-width: 1.5px;
  border-color: color-mix(in srgb, var(--color-m3-primary) 30%, transparent);
  animation: continuous-spin-ccw 4s linear infinite;
  margin: -5px;
}

@keyframes amber-continuous-wave {
  0%,
  100% {
    transform: scale(0.92) rotate(0deg);
    opacity: 0.25;
  }
  50% {
    transform: scale(1.18) rotate(90deg);
    opacity: 0.85;
    box-shadow: 0 0 10px color-mix(in srgb, var(--color-m3-primary) 20%, transparent);
  }
}

/* --- E. Violet Theme (Cosmic Astral Shimmer) --- */
.theme-loader-violet .halo-ring-1 {
  border: 1.5px solid color-mix(in srgb, var(--color-m3-primary) 35%, transparent);
  animation: violet-continuous-wave 3.8s ease-in-out infinite;
}
.theme-loader-violet .halo-ring-2 {
  border: 1.5px solid color-mix(in srgb, var(--color-m3-primary) 18%, transparent);
  animation: violet-continuous-wave 3.8s ease-in-out infinite;
  animation-delay: -1.9s;
}
.theme-loader-violet.is-active .halo-ring-1 {
  border-width: 2px;
  border-color: color-mix(in srgb, var(--color-m3-primary) 65%, transparent);
  animation: continuous-spin-cw 3.5s linear infinite;
}
.theme-loader-violet.is-active .halo-ring-2 {
  border-width: 1.5px;
  border-color: color-mix(in srgb, var(--color-m3-primary) 25%, transparent);
  animation: continuous-spin-ccw 5.5s linear infinite;
  margin: -5px;
}

@keyframes violet-continuous-wave {
  0%,
  100% {
    transform: scale(0.9) rotate(0deg);
    border-radius: 40% 60% 40% 60% / 60% 40% 60% 40%;
    opacity: 0.3;
  }
  50% {
    transform: scale(1.17) rotate(180deg);
    border-radius: 60% 40% 60% 40% / 40% 60% 40% 60%;
    opacity: 0.85;
  }
}

/* --- F. Classic Theme (Precision Minimal Concentric Rhythms) --- */
.theme-loader-classic .halo-ring-1 {
  border: 1.5px solid color-mix(in srgb, var(--color-m3-primary) 30%, transparent);
  animation: classic-continuous-wave 3.6s ease-in-out infinite;
}
.theme-loader-classic .halo-ring-2 {
  border: 1px solid color-mix(in srgb, var(--color-m3-primary) 18%, transparent);
  animation: classic-continuous-wave 3.6s ease-in-out infinite;
  animation-delay: -1.8s;
}
.theme-loader-classic.is-active .halo-ring-1 {
  border-width: 2px;
  border-style: dashed;
  border-color: color-mix(in srgb, var(--color-m3-primary) 60%, transparent);
  animation: continuous-spin-cw 6s linear infinite;
}
.theme-loader-classic.is-active .halo-ring-2 {
  border-width: 1.5px;
  border-style: dotted;
  border-color: color-mix(in srgb, var(--color-m3-primary) 30%, transparent);
  animation: continuous-spin-ccw 9s linear infinite;
  margin: -5px;
}

@keyframes classic-continuous-wave {
  0%,
  100% {
    transform: scale(0.92);
    opacity: 0.3;
  }
  50% {
    transform: scale(1.15);
    opacity: 0.8;
  }
}

/* --- Global Continuous Rotations (No jumps across cycles) --- */
@keyframes continuous-spin-cw {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

@keyframes continuous-spin-ccw {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(-360deg);
  }
}
</style>
