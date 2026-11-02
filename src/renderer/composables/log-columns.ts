import { computed } from 'vue';
import { useColumnWidths } from './column-widths';

export function useLogColumns() {
  const columns = useColumnWidths(
    [
      { label: '时间', width: 95, min: 80, max: 400 },
      { label: '级别', width: 36, min: 36, max: 160 },
      { label: 'PID / TID', width: 80, min: 64, max: 600 },
      { label: 'Tag', width: 100, min: 64, max: 1600 },
      { label: '日志内容', width: 180, min: 180, max: 16000 },
    ],
    { storageKey: 'adm.log-column-widths', flexColumn: 4, spacing: 72 },
  );
  return {
    ...columns,
    style: computed(() => ({ ...columns.style.value, '--log-columns': columns.gridTemplate.value })),
  };
}
