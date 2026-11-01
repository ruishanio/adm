<script setup lang="ts">
import { t } from '../../shared/i18n';
import { onBeforeUnmount } from 'vue';
import { useWorkbench } from '@/composables/workbench';
const w = useWorkbench(),
  s = w.state;
const clamp = (x: number) => Math.max(220, Math.min(x, s.viewport - 641));
let cleanup = () => {};
const save = () =>
  w.api.sidebarWidth(w.sidebar.value).catch((e) => {
    s.notice = { text: e.message, error: true };
  });
function start(e: MouseEvent) {
  if (e.button !== 0) return;
  e.preventDefault();
  (e.currentTarget as HTMLElement).focus();
  cleanup();
  const startX = e.clientX,
    startWidth = w.sidebar.value;
  const cursor = document.body.style.cursor,
    select = document.body.style.userSelect;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  const move = (event: MouseEvent) => {
    // 命中区比边界更宽，按位移调整可避免按下时侧栏突然跳动。
    s.width = clamp(startWidth + event.clientX - startX);
  };
  const stop = () => {
    cleanup();
    void save();
  };
  cleanup = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', stop);
    window.removeEventListener('blur', stop);
    document.body.style.cursor = cursor;
    document.body.style.userSelect = select;
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', stop);
  window.addEventListener('blur', stop);
}
function key(e: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(e.key)) return;
  e.preventDefault();
  s.width = clamp(e.key === 'Home' ? 248 : w.sidebar.value + (e.key === 'ArrowLeft' ? -10 : 10));
  void save();
}
onBeforeUnmount(() => cleanup());
</script>
<template>
  <div
    class="sidebar-divider"
    role="separator"
    :aria-label="t('调整设备列表宽度')"
    aria-controls="device-sidebar"
    :title="t('拖动调整设备列表宽度')"
    aria-orientation="vertical"
    :aria-valuemin="220"
    :aria-valuemax="s.viewport - 641"
    :aria-valuenow="w.sidebar.value"
    tabindex="0"
    @mousedown="start"
    @keydown="key"
  />
</template>
