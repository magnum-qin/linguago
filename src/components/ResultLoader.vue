<script setup lang="ts">
import { Sparkles, Loader2 } from 'lucide-vue-next';

defineProps<{
  isTranslating: boolean;
  colorScheme: string;
}>();
</script>

<template>
  <div class="flex flex-col items-center justify-center py-10 gap-6 mt-4 md:mt-10">
    <!-- Themed Unified Loader Container -->
    <div class="relative flex items-center justify-center w-28 h-28" :class="`theme-loader-${colorScheme}`">
      <!-- Idle decor elements (fade in/out smoothly) -->
      <div
        class="absolute inset-0 theme-decor-idle-1 transition-all duration-500 ease-spring"
        :class="isTranslating ? 'opacity-0 scale-90' : 'opacity-100 scale-100'"
      ></div>
      <div
        class="absolute inset-0 theme-decor-idle-2 transition-all duration-500 ease-spring"
        :class="isTranslating ? 'opacity-0 scale-90' : 'opacity-100 scale-100'"
      ></div>

      <!-- Active decor elements (fade in/out smoothly) -->
      <div
        class="absolute inset-0 theme-decor-active-1 transition-all duration-500 ease-spring"
        :class="isTranslating ? 'opacity-100 scale-100' : 'opacity-0 scale-90'"
      ></div>
      <div
        class="absolute inset-0 theme-decor-active-2 transition-all duration-500 ease-spring"
        :class="isTranslating ? 'opacity-100 scale-100' : 'opacity-0 scale-90'"
      ></div>

      <!-- Inner circle with smooth icon transition -->
      <div
        class="relative bg-m3-surface-container w-16 h-16 rounded-full flex items-center justify-center shadow-sm border border-m3-outline-variant/10 z-10 text-m3-primary/70 transition-all duration-500"
      >
        <!-- Sparkles (Idle) -->
        <Sparkles
          class="w-7 h-7 absolute transition-all duration-500 ease-spring"
          :class="isTranslating ? 'scale-0 rotate-45 opacity-0' : 'scale-100 rotate-0 opacity-100'"
        />
        <!-- Loader2 (Active) -->
        <Loader2
          class="w-7 h-7 absolute transition-all duration-500 ease-spring"
          :class="isTranslating ? 'scale-100 rotate-180 opacity-100 animate-spin' : 'scale-0 rotate-0 opacity-0'"
        />
      </div>
    </div>
    <div
      class="flex flex-col items-center gap-1.5 opacity-80"
      :class="{ 'animate-float': !isTranslating }"
      style="animation-delay: 0.2s"
    >
      <template v-if="isTranslating">
        <p class="text-m3-on-surface-variant font-bold tracking-[0.15em] text-[0.8rem] uppercase text-center">
          解析中<br /><span class="text-[0.7rem] opacity-70 tracking-normal mt-0.5 inline-block">Analisando</span>
        </p>
        <p class="text-m3-outline text-[0.85rem] font-medium text-center">
          正在加载翻译结果...<br /><span class="text-[0.75rem] opacity-70 mt-0.5 inline-block">Carregando...</span>
        </p>
      </template>
      <template v-else>
        <p class="text-m3-on-surface-variant font-bold tracking-[0.15em] text-[0.8rem] uppercase text-center">
          等待输入<br /><span class="text-[0.7rem] opacity-70 tracking-normal mt-0.5 inline-block">Aguardando</span>
        </p>
        <p class="text-m3-outline text-[0.85rem] font-medium text-center">
          支持中 / 英 / 葡 / 日 自动识别<br /><span class="text-[0.75rem] opacity-70 mt-0.5 inline-block"
            >Suporta detecção auto ZH/EN/PT/JA</span
          >
        </p>
      </template>
    </div>
  </div>
</template>

<style scoped>
@keyframes float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-8px);
  }
}
.animate-float {
  animation: float 4s ease-in-out infinite;
}
@keyframes pulse-ring {
  0% {
    transform: scale(0.8);
    opacity: 0.5;
  }
  100% {
    transform: scale(1.5);
    opacity: 0;
  }
}
.animate-pulse-ring {
  animation: pulse-ring 3s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
}

/* --- Themed wait/load loader animations --- */

.theme-decor-idle-1,
.theme-decor-idle-2,
.theme-decor-active-1,
.theme-decor-active-2 {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid transparent;
  pointer-events: none;
  /* Prevent WebKit/Safari round layer clipping bug on iOS */
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;
  transform: translate3d(0, 0, 0);
  will-change: transform, opacity;
}

/* --- Blue Theme --- */
.theme-loader-blue .theme-decor-idle-1 {
  border-color: color-mix(in srgb, var(--color-m3-primary) 30%, transparent);
  animation: pulse-ring 3s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
}
.theme-loader-blue .theme-decor-idle-2 {
  border-color: color-mix(in srgb, var(--color-m3-primary) 15%, transparent);
  animation: pulse-ring 3s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
  animation-delay: 1.5s;
}
.theme-loader-blue .theme-decor-active-1 {
  border-style: double;
  border-width: 4px;
  border-color: color-mix(in srgb, var(--color-m3-primary) 50%, transparent);
  animation: classic-gear-cw 3s linear infinite;
}
.theme-loader-blue .theme-decor-active-2 {
  border-color: color-mix(in srgb, var(--color-m3-primary) 40%, transparent);
  animation: classic-gear-ccw 5s linear infinite;
  margin: -4px;
}

/* --- Rose Theme --- */
.theme-loader-rose .theme-decor-idle-1,
.theme-loader-rose .theme-decor-idle-2 {
  border-radius: 50% 50% 50% 50% / 40% 40% 60% 60%;
  border-color: color-mix(in srgb, var(--color-m3-primary) 35%, transparent);
}
.theme-loader-rose .theme-decor-idle-1 {
  animation: rose-heartbeat 2.4s ease-in-out infinite;
}
.theme-loader-rose .theme-decor-idle-2 {
  animation: rose-heartbeat 2.4s ease-in-out infinite;
  animation-delay: 1.2s;
}
.theme-loader-rose .theme-decor-active-1 {
  animation: rose-morph 4s ease-in-out infinite;
  border-color: color-mix(in srgb, var(--color-m3-primary) 60%, transparent);
}
.theme-loader-rose .theme-decor-active-2 {
  animation: rose-morph 6s ease-in-out infinite;
  animation-delay: -2s;
  border-color: color-mix(in srgb, var(--color-m3-primary) 25%, transparent);
  margin: -4px;
}

/* --- Mint Theme --- */
.theme-loader-mint .theme-decor-idle-1,
.theme-loader-mint .theme-decor-idle-2 {
  border-radius: 60% 40% 60% 40% / 40% 60% 40% 60%;
  border-color: color-mix(in srgb, var(--color-m3-primary) 30%, transparent);
}
.theme-loader-mint .theme-decor-idle-1 {
  animation: mint-breath 4s ease-in-out infinite;
}
.theme-loader-mint .theme-decor-idle-2 {
  animation: mint-breath 4s ease-in-out infinite;
  animation-delay: 2s;
}
.theme-loader-mint .theme-decor-active-1 {
  animation: mint-spin-cw 5s linear infinite;
  border-color: color-mix(in srgb, var(--color-m3-primary) 50%, transparent);
}
.theme-loader-mint .theme-decor-active-2 {
  animation: mint-spin-ccw 7s linear infinite;
  border-color: color-mix(in srgb, var(--color-m3-primary) 20%, transparent);
  margin: -6px;
}

/* --- Amber Theme --- */
.theme-loader-amber .theme-decor-idle-1,
.theme-loader-amber .theme-decor-idle-2 {
  border-style: dashed;
  border-width: 2px;
  border-color: color-mix(in srgb, var(--color-m3-primary) 35%, transparent);
}
.theme-loader-amber .theme-decor-idle-1 {
  animation: amber-flare 2.5s ease-out infinite;
}
.theme-loader-amber .theme-decor-idle-2 {
  animation: amber-flare 2.5s ease-out infinite;
  animation-delay: 1.25s;
}
.theme-loader-amber .theme-decor-active-1 {
  animation: amber-spin 3s linear infinite;
  border-color: color-mix(in srgb, var(--color-m3-primary) 60%, transparent);
}
.theme-loader-amber .theme-decor-active-2 {
  animation: amber-spin 4s linear infinite;
  animation-delay: -1.5s;
  border-color: color-mix(in srgb, var(--color-m3-primary) 25%, transparent);
  margin: -5px;
}

/* --- Violet Theme --- */
.theme-loader-violet .theme-decor-idle-1,
.theme-loader-violet .theme-decor-idle-2 {
  border-radius: 35% 65% 35% 65% / 65% 35% 65% 35%;
  border-color: color-mix(in srgb, var(--color-m3-primary) 30%, transparent);
}
.theme-loader-violet .theme-decor-idle-1 {
  animation: violet-twinkle 4s ease-in-out infinite;
}
.theme-loader-violet .theme-decor-idle-2 {
  animation: violet-twinkle 4s ease-in-out infinite;
  animation-delay: 2s;
}
.theme-loader-violet .theme-decor-active-1 {
  animation: violet-spin 6s linear infinite;
  border-color: color-mix(in srgb, var(--color-m3-primary) 50%, transparent);
}
.theme-loader-violet .theme-decor-active-2 {
  animation: violet-spin 9s linear infinite;
  animation-delay: -3s;
  border-color: color-mix(in srgb, var(--color-m3-primary) 20%, transparent);
  margin: -5px;
}

/* --- Classic Theme --- */
.theme-loader-classic .theme-decor-idle-1,
.theme-loader-classic .theme-decor-idle-2 {
  border-color: color-mix(in srgb, var(--color-m3-primary) 25%, transparent);
}
.theme-loader-classic .theme-decor-idle-1 {
  animation: classic-tick 4s steps(4, end) infinite;
}
.theme-loader-classic .theme-decor-idle-2 {
  animation: classic-tick 4s steps(4, end) infinite;
  animation-delay: 2s;
}
.theme-loader-classic .theme-decor-active-1 {
  border-style: dotted;
  border-width: 3px;
  animation: classic-gear-cw 12s linear infinite;
  border-color: color-mix(in srgb, var(--color-m3-primary) 50%, transparent);
}
.theme-loader-classic .theme-decor-active-2 {
  border-style: dotted;
  border-width: 3px;
  animation: classic-gear-ccw 18s linear infinite;
  border-color: color-mix(in srgb, var(--color-m3-primary) 20%, transparent);
  margin: -6px;
}

/* --- Keyframe Animations --- */
@keyframes rose-heartbeat {
  0% {
    transform: scale(0.9);
    opacity: 0.7;
  }
  15% {
    transform: scale(1.12);
    opacity: 0.95;
  }
  30% {
    transform: scale(0.96);
    opacity: 0.8;
  }
  45% {
    transform: scale(1.22);
    opacity: 0.45;
  }
  70%,
  100% {
    transform: scale(1.4);
    opacity: 0;
  }
}

@keyframes rose-morph {
  0%,
  100% {
    border-radius: 50% 50% 50% 50% / 40% 40% 60% 60%;
    transform: rotate(0deg);
  }
  50% {
    border-radius: 40% 60% 40% 60% / 60% 40% 60% 40%;
    transform: rotate(180deg);
  }
}

@keyframes mint-breath {
  0%,
  100% {
    transform: scale(0.85) rotate(-15deg);
    opacity: 0.6;
  }
  50% {
    transform: scale(1.08) rotate(15deg);
    opacity: 0.85;
  }
}

@keyframes mint-spin-cw {
  0% {
    transform: rotate(0deg);
    border-radius: 60% 40% 60% 40% / 40% 60% 40% 60%;
  }
  100% {
    transform: rotate(360deg);
    border-radius: 60% 40% 60% 40% / 40% 60% 40% 60%;
  }
}
@keyframes mint-spin-ccw {
  0% {
    transform: rotate(0deg);
    border-radius: 40% 60% 40% 60% / 60% 40% 60% 40%;
  }
  100% {
    transform: rotate(-360deg);
    border-radius: 40% 60% 40% 60% / 60% 40% 60% 40%;
  }
}

@keyframes amber-flare {
  0% {
    transform: scale(0.8) rotate(0deg);
    opacity: 0.7;
  }
  100% {
    transform: scale(1.45) rotate(45deg);
    opacity: 0;
  }
}

@keyframes amber-spin {
  0% {
    transform: rotate(0deg) scale(0.95);
    filter: blur(0.5px);
  }
  50% {
    transform: rotate(180deg) scale(1.06);
    filter: blur(1.5px);
  }
  100% {
    transform: rotate(360deg) scale(0.95);
    filter: blur(0.5px);
  }
}

@keyframes violet-twinkle {
  0%,
  100% {
    transform: scale(0.8) rotate(0deg);
    opacity: 0.45;
  }
  50% {
    transform: scale(1.12) rotate(90deg);
    opacity: 0.95;
  }
}

@keyframes violet-spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

@keyframes classic-tick {
  0%,
  100% {
    transform: scale(0.88);
    opacity: 0.85;
  }
  25% {
    transform: scale(0.94);
    opacity: 0.7;
  }
  50% {
    transform: scale(1);
    opacity: 0.55;
  }
  75% {
    transform: scale(1.06);
    opacity: 0.35;
  }
}

@keyframes classic-gear-cw {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
@keyframes classic-gear-ccw {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(-360deg);
  }
}
</style>
