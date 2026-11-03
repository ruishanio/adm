<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Check, ChevronDown, Search } from '@lucide/vue';
import {
  ComboboxRoot,
  ComboboxAnchor,
  ComboboxTrigger,
  ComboboxPortal,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
} from 'reka-ui';

defineOptions({ inheritAttrs: false });
const props = defineProps<{
  id: string;
  modelValue: string;
  options: { value: string; label: string; description?: string }[];
  searchPlaceholder: string;
  emptyLabel: string;
  placeholder?: string;
  disabled?: boolean;
  contentClass?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const open = ref(false);
const query = ref('');
const selected = computed(() => props.options.find((option) => option.value === props.modelValue));
const filtered = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase();
  return props.options.filter((option) =>
    `${option.label} ${option.description || ''} ${option.value}`.toLocaleLowerCase().includes(keyword),
  );
});
// 检索只缩小候选列表，不修改已选应用；关闭后清空检索，重新展开可看到全部选项。
watch(open, () => (query.value = ''));
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) open.value = false;
  },
);
</script>

<template>
  <ComboboxRoot
    v-model:open="open"
    :model-value="modelValue"
    :disabled="disabled"
    ignore-filter
    class="app-search-select"
    @update:model-value="(value) => typeof value === 'string' && emit('update:modelValue', value)"
  >
    <ComboboxAnchor as-child>
      <ComboboxTrigger
        :id="id"
        v-bind="$attrs"
        tabindex="0"
        class="app-select-trigger"
        @keydown.enter.space.down.prevent="open = true"
      >
        <span class="app-select-value">{{ selected?.label || placeholder }}</span>
        <ChevronDown aria-hidden="true" />
      </ComboboxTrigger>
    </ComboboxAnchor>
    <ComboboxPortal>
      <ComboboxContent
        position="popper"
        align="start"
        :side-offset="4"
        class="app-select-menu app-search-menu"
        :class="contentClass"
      >
        <label class="app-select-search">
          <Search aria-hidden="true" />
          <ComboboxInput
            v-model="query"
            :display-value="() => ''"
            :aria-label="searchPlaceholder"
            :placeholder="searchPlaceholder"
            :maxlength="256"
            :spellcheck="false"
          />
        </label>
        <div class="app-search-options" role="presentation">
          <ComboboxItem
            v-for="option in filtered"
            :key="option.value"
            :value="option.value"
            :text-value="option.label"
            class="app-select-option"
          >
            <span class="app-search-option-text">
              <span>{{ option.label }}</span>
              <span v-if="option.description" class="app-search-option-description">{{
                option.description
              }}</span>
            </span>
            <ComboboxItemIndicator class="app-select-indicator"
              ><Check aria-hidden="true"
            /></ComboboxItemIndicator>
          </ComboboxItem>
          <p v-if="!filtered.length" class="app-select-empty" role="status">{{ emptyLabel }}</p>
        </div>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>
