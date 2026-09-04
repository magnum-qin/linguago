<script setup lang="ts">
import { computed, useId } from 'vue';
import {
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectPortal,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectItemIndicator
} from 'radix-vue';
import { ChevronDown, Check } from 'lucide-vue-next';

interface SelectOption {
  label: string;
  value: string;
}

const {
  modelValue,
  items,
  id,
  disabled = false
} = defineProps<{
  modelValue: string;
  items: Array<string | SelectOption>;
  id?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

const autoId = useId();
const resolvedId = computed(() => id || autoId);

const normalizedOptions = computed(() => {
  return items.map((item) => {
    if (typeof item === 'string') {
      return { label: item, value: item };
    }
    return item;
  });
});
const currentDisplayLabel = computed(() => {
  return normalizedOptions.value.find((o) => o.value === modelValue)?.label || modelValue;
});
</script>

<template>
  <div class="m3-select-wrapper relative w-full">
    <input
      :id="resolvedId"
      type="hidden"
      :value="currentDisplayLabel"
    />
    <SelectRoot
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="emit('update:modelValue', $event)"
    >
      <SelectTrigger
        :id="`${resolvedId}-trigger`"
        class="m3-native-select group w-full flex items-center justify-between px-4 py-3.5 rounded-2xl bg-m3-surface border border-m3-outline-variant/30 text-m3-on-surface font-medium text-[0.92rem] hover:bg-m3-surface-container-high focus:outline-none focus:ring-2 focus:ring-m3-primary transition-colors cursor-pointer select-none text-left"
      >
        <SelectValue class="truncate text-m3-on-surface">
          {{ currentDisplayLabel }}
        </SelectValue>
        <ChevronDown class="m3-select-chevron h-5 w-5 text-m3-on-surface-variant opacity-70 shrink-0 ml-2 transition-transform duration-200 ease-out group-data-[state=open]:rotate-180" aria-hidden="true" />
      </SelectTrigger>

      <SelectPortal>
        <SelectContent
          class="m3-select-menu-content z-[2600] rounded-2xl bg-m3-surface border border-m3-outline-variant/30 shadow-2xl p-1.5 min-w-[200px] max-h-[260px] overflow-y-auto outline-none"
          position="popper"
          :side-offset="6"
        >
          <SelectItem
            v-for="option in normalizedOptions"
            :key="option.value"
            :value="option.value"
            class="flex items-center justify-between px-3.5 py-2.5 rounded-xl text-[0.88rem] text-m3-on-surface hover:bg-m3-primary/10 hover:text-m3-primary focus:bg-m3-primary/15 focus:text-m3-primary cursor-pointer outline-none transition-colors select-none mb-0.5 data-[state=checked]:bg-m3-primary/12 data-[state=checked]:text-m3-primary font-medium"
          >
            <SelectItemText class="truncate">{{ option.label }}</SelectItemText>
            <SelectItemIndicator class="ml-2 text-m3-primary shrink-0">
              <Check class="h-4 w-4" aria-hidden="true" />
            </SelectItemIndicator>
          </SelectItem>
        </SelectContent>
      </SelectPortal>
    </SelectRoot>
  </div>
</template>
