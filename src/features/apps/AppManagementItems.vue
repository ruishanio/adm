<script setup lang="ts">
import { computed } from 'vue';
import { Square, Eraser, Trash2 } from '@lucide/vue';
import { DropdownMenuItem } from 'reka-ui';
import { ContextMenuItem } from '@/shared/ui/context-menu/index';
import type { AppAction } from '@/shared/api/types';
import { t } from '@/shared/i18n/index';
const props = defineProps<{ disabled: boolean; dropdown?: boolean }>();
const emit = defineEmits<{ action: [value: Exclude<AppAction, 'launch'> | 'uninstall'] }>();
const item = computed(() => (props.dropdown ? DropdownMenuItem : ContextMenuItem));
</script>
<template>
  <component :is="item" :disabled="disabled" @select="emit('action', 'force-stop')"
    ><Square aria-hidden="true" />{{ t('强制停止应用') }}</component
  >
  <component :is="item" :disabled="disabled" class="destructive" @select="emit('action', 'clear-data')"
    ><Eraser aria-hidden="true" />{{ t('清除应用数据') }}</component
  >
  <component :is="item" :disabled="disabled" class="destructive" @select="emit('action', 'uninstall')"
    ><Trash2 aria-hidden="true" />{{ t('卸载应用') }}</component
  >
</template>
