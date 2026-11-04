<script setup lang="ts">
import { computed } from 'vue';
import AppManagementItems from './AppManagementItems.vue';
import { Copy, Info, Play } from '@lucide/vue';
import { DropdownMenuItem, DropdownMenuSeparator } from 'reka-ui';
import { ContextMenuItem, ContextMenuSeparator } from '@/shared/ui/context-menu/index';
import type { AppAction, InstalledApp } from '@/shared/api/types';
import { t } from '@/shared/i18n/index';
const props = defineProps<{ app: InstalledApp; owner: boolean; busy: boolean; dropdown?: boolean }>();
const emit = defineEmits<{ action: [value: AppAction | 'details' | 'copy' | 'uninstall'] }>();
const item = computed(() => (props.dropdown ? DropdownMenuItem : ContextMenuItem));
const separator = computed(() => (props.dropdown ? DropdownMenuSeparator : ContextMenuSeparator));
const protectedApp = computed(() => props.app.system || props.owner);
</script>
<template>
  <component :is="item" :disabled="busy" @select="emit('action', 'details')"
    ><Info aria-hidden="true" />{{ t('应用信息') }}</component
  >
  <component
    :is="item"
    :disabled="busy || app.system || !app.enabled || !app.launchComponent"
    @select="emit('action', 'launch')"
    ><Play aria-hidden="true" />{{ t('打开应用') }}</component
  >
  <component :is="item" :disabled="busy" @select="emit('action', 'copy')"
    ><Copy aria-hidden="true" />{{ t('复制包名') }}</component
  >
  <component :is="separator" class="app-menu-separator" />
  <AppManagementItems
    :disabled="busy || protectedApp"
    :dropdown="dropdown"
    @action="emit('action', $event)"
  />
</template>
