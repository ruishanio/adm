import { computed, onBeforeUnmount, ref } from 'vue';
import type { MessageKey } from '../../shared/i18n';

export interface ColumnDefinition {
  label: MessageKey;
  width: number;
  min: number;
  max: number;
  resizable?: boolean;
  hiddenLabel?: boolean;
}

/** 按表格分别保存列宽；flexColumn 填满剩余空间，spacing 表示列间距与外侧内边距之和。 */
export function useColumnWidths(
  definitions: readonly ColumnDefinition[],
  { storageKey, flexColumn, spacing = 0 }: { storageKey: string; flexColumn: number; spacing?: number },
) {
  const clamp = (value: number, index: number) =>
    Math.max(definitions[index].min, Math.min(definitions[index].max, Math.round(value)));

  const widths = ref<number[]>(definitions.map((column) => column.width));
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (Array.isArray(saved) && saved.length === definitions.length) {
      widths.value = saved.map((width, index) =>
        typeof width === 'number' && Number.isFinite(width) ? clamp(width, index) : definitions[index].width,
      );
    }
  } catch {
    // 本地偏好不可读时使用默认列宽，不影响列表查看。
  }
  const resizing = ref<number>();
  const viewportWidth = ref(0);
  const columns = computed(() =>
    definitions.map((column, index) => ({
      ...column,
      width:
        index === flexColumn
          ? Math.max(
              widths.value[index],
              viewportWidth.value -
                widths.value.reduce((sum, width, i) => sum + (i === flexColumn ? 0 : width), spacing),
            )
          : widths.value[index],
    })),
  );
  const gridTemplate = computed(() =>
    widths.value
      .map((width, index) => (index === flexColumn ? `minmax(${width}px, 1fr)` : `${width}px`))
      .join(' '),
  );
  // 表头和正文使用相同的总宽度与各列宽度，横向滚动时不会分离。
  const style = computed(() => ({
    minWidth: `${widths.value.reduce((sum, width) => sum + width, spacing)}px`,
  }));
  const save = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(widths.value));
    } catch {
      // 存储不可用时仍保留本次页面中的调整。
    }
  };
  let cleanup = () => {};
  function reset(index: number) {
    widths.value[index] = definitions[index].width;
    save();
  }
  function startResize(index: number, event: MouseEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    cleanup();
    const handle = event.currentTarget as HTMLElement;
    handle.focus({ preventScroll: true });
    const startX = event.clientX;
    // 弹性列会填满剩余空间，从实际宽度开始拖动可避免首次移动时跳变。
    const startWidth = handle.parentElement?.getBoundingClientRect().width || widths.value[index];
    const cursor = document.body.style.cursor;
    const selection = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    resizing.value = index;
    const move = (e: MouseEvent) => (widths.value[index] = clamp(startWidth + e.clientX - startX, index));
    const stop = () => {
      cleanup();
      save();
    };
    cleanup = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('blur', stop);
      document.body.style.cursor = cursor;
      document.body.style.userSelect = selection;
      resizing.value = undefined;
      cleanup = () => {};
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);
    window.addEventListener('blur', stop);
  }
  function onKey(index: number, event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Home') reset(index);
    else {
      const handle = event.currentTarget as HTMLElement;
      const width = handle.parentElement?.getBoundingClientRect().width || widths.value[index];
      widths.value[index] = clamp(width + (event.key === 'ArrowLeft' ? -10 : 10), index);
      save();
    }
  }
  onBeforeUnmount(() => cleanup());
  return { columns, style, gridTemplate, resizing, viewportWidth, startResize, onKey, reset };
}
