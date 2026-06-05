<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { ChevronDown, CheckCircle2, XCircle, Loader2 } from 'lucide-vue-next';

const props = defineProps<{
  modelValue: string | number;
  options: any[];
  status?: 'idle' | 'loading' | 'success' | 'error';
}>();

const emit = defineEmits(['update:modelValue']);

const isOpen = ref(false);
const selectRef = ref<HTMLElement | null>(null);

const formattedOptions = computed(() => {
  return props.options.map(opt => {
    if (typeof opt === 'object' && opt !== null) {
      return { label: opt.label || opt.value, value: opt.value };
    }
    return { label: opt, value: opt };
  });
});

const currentLabel = computed(() => {
  const found = formattedOptions.value.find(o => o.value === props.modelValue);
  return found ? found.label : props.modelValue;
});

const selectOption = (val: string | number) => {
  emit('update:modelValue', val);
  isOpen.value = false;
};

const toggle = () => {
  isOpen.value = !isOpen.value;
};

const close = (e: MouseEvent) => {
  if (selectRef.value && !selectRef.value.contains(e.target as Node)) {
    isOpen.value = false;
  }
};

onMounted(() => {
  document.addEventListener('click', close);
});

onUnmounted(() => {
  document.removeEventListener('click', close);
});
</script>

<template>
  <div class="relative w-full" ref="selectRef">
    <button 
      type="button"
      @click="toggle"
      class="w-full flex items-center justify-between min-h-[44px] rounded-[16px] border border-m3-outline-variant/30 bg-m3-surface-container px-4 py-2 text-m3-on-surface outline-none focus:ring-2 focus:ring-m3-primary/50 transition-all cursor-pointer"
      :class="isOpen ? 'ring-2 ring-m3-primary/50' : 'hover:bg-m3-surface-container-highest'"
    >
      <span class="truncate">{{ currentLabel }}</span>
      <div class="flex items-center gap-1.5 shrink-0">
        <Transition mode="out-in" name="fade">
          <Loader2 v-if="status === 'loading'" class="w-4 h-4 text-m3-primary animate-spin" />
          <CheckCircle2 v-else-if="status === 'success'" class="w-4 h-4 text-[#247060]" />
          <XCircle v-else-if="status === 'error'" class="w-4 h-4 text-[#BA1A1A] dark:text-[#FFB4AB]" />
          <div v-else></div>
        </Transition>
        <ChevronDown class="w-4 h-4 text-m3-on-surface-variant transition-transform duration-200" :class="isOpen ? 'rotate-180' : ''" />
      </div>
    </button>

    <Transition name="fade">
      <div 
        v-if="isOpen"
        class="absolute z-[2050] w-full mt-1.5 py-1.5 bg-m3-surface border border-m3-outline-variant/20 rounded-[16px] shadow-2xl max-h-[280px] overflow-y-auto"
      >
        <button
          v-for="opt in formattedOptions"
          :key="opt.value"
          @click="selectOption(opt.value)"
          class="w-full flex items-center px-4 py-2.5 text-[0.95rem] text-left transition-colors hover:bg-m3-surface-container-high"
          :class="opt.value === modelValue ? 'bg-m3-secondary-container/50 text-m3-primary font-bold' : 'text-m3-on-surface'"
        >
          <span class="truncate">{{ opt.label }}</span>
        </button>
      </div>
    </Transition>
  </div>
</template>
