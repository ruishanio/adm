<script setup lang="ts">
import { Check, ChevronDown } from '@lucide/vue';
import {
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectPortal,
  SelectContent,
  SelectViewport,
  SelectItem,
  SelectItemText,
  SelectItemIndicator,
} from 'reka-ui';
defineProps<{
  id: string;
  modelValue: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  variant?: 'default' | 'inline';
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
</script>
<template>
  <SelectRoot
    :model-value="modelValue"
    :disabled="disabled"
    @update:model-value="
      (value) => {
        if (typeof value === 'string') emit('update:modelValue', value);
      }
    "
  >
    <SelectTrigger :id="id" :class="['app-select-trigger', { 'app-select-inline': variant === 'inline' }]">
      <SelectValue class="app-select-value">{{
        options.find((option) => option.value === modelValue)?.label
      }}</SelectValue>
      <ChevronDown aria-hidden="true" />
    </SelectTrigger>
    <SelectPortal>
      <SelectContent position="popper" align="start" :side-offset="4" class="app-select-menu">
        <SelectViewport>
          <SelectItem
            v-for="option in options"
            :key="option.value"
            :value="option.value"
            class="app-select-option"
          >
            <SelectItemText class="app-select-option-label">{{ option.label }}</SelectItemText>
            <SelectItemIndicator class="app-select-indicator"
              ><Check aria-hidden="true"
            /></SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
