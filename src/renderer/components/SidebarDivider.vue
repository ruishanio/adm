<script setup lang="ts">
import { onBeforeUnmount } from 'vue';
import { useWorkbench } from '@/composables/workbench';
const w = useWorkbench(),
  s = w.state;
const clamp = (x: number) => Math.max(220, Math.min(x, s.viewport - 645));
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
  const cursor = document.body.style.cursor,
    select = document.body.style.userSelect;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  const move = (event: MouseEvent) => {
    s.width = clamp(event.clientX);
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
    aria-label="调整设备列表宽度"
    aria-orientation="vertical"
    :aria-valuemin="220"
    :aria-valuemax="s.viewport - 645"
    :aria-valuenow="w.sidebar.value"
    tabindex="0"
    @mousedown="start"
    @keydown="key"
  />
</template>
