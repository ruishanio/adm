import { onScopeDispose, ref, watch } from 'vue';
import { createSharedComposable, useEventListener } from '@vueuse/core';

// 在应用根部启用一次，写入 html 以覆盖 Teleport 弹窗、菜单及后续新增控件。
// 捕获阶段同步更新样式，防止控件随后调用 focus() 时短暂闪出键盘外框。
export const useFocusMode = createSharedComposable(() => {
  const root = document.documentElement;
  const previousMode = root.getAttribute('data-focus-mode');
  const focusMode = ref<'keyboard' | 'pointer'>('keyboard');
  watch(focusMode, (mode) => (root.dataset.focusMode = mode), { immediate: true, flush: 'sync' });
  useEventListener(document, 'pointerdown', () => (focusMode.value = 'pointer'), { capture: true });
  useEventListener(
    document,
    'keydown',
    (event) => {
      // 输入文字、中文组词和系统快捷键不切换焦点样式；导航、激活和退出才属于键盘交互。
      if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (
        [
          'Tab',
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
          'Home',
          'End',
          'PageUp',
          'PageDown',
          'Enter',
          ' ',
          'Escape',
        ].includes(event.key)
      ) {
        focusMode.value = 'keyboard';
      }
    },
    { capture: true },
  );
  onScopeDispose(() => {
    if (previousMode === null) root.removeAttribute('data-focus-mode');
    else root.setAttribute('data-focus-mode', previousMode);
  });
  return focusMode;
});
