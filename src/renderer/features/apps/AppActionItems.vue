<script setup lang="ts">
import { computed } from 'vue';
import { Copy, Info, Play, Square, Eraser, Trash2 } from '@lucide/vue';
import { DropdownMenuItem, DropdownMenuSeparator } from 'reka-ui';
import { ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu';
import type { AppAction, InstalledApp } from '../../../shared/contracts';
import { t } from '../../../shared/i18n';
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
  <component :is="item" :disabled="busy || protectedApp" @select="emit('action', 'force-stop')"
    ><Square aria-hidden="true" />{{ t('强制停止应用') }}</component
  >
  <component
    :is="item"
    :disabled="busy || protectedApp"
    class="destructive"
    @select="emit('action', 'clear-data')"
    ><Eraser aria-hidden="true" />{{ t('清除应用数据') }}</component
  >
  <component
    :is="item"
    :disabled="busy || protectedApp"
    class="destructive"
    @select="emit('action', 'uninstall')"
    ><Trash2 aria-hidden="true" />{{ t('卸载应用') }}</component
  >
</template>
