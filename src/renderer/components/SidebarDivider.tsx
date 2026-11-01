import { useEffect, useRef } from 'react';
import { useWorkbench } from '../hooks/useWorkbench';

export function SidebarDivider() {
  const { api, sidebar, viewport, setWidth, setNotice } = useWorkbench();
  const cleanup = useRef<() => void>(() => {});
  useEffect(() => () => cleanup.current(), []);
  const clamp = (value: number) => Math.max(220, Math.min(value, window.innerWidth - 645));
  const save = (value: number) => {
    void api.sidebarWidth(value).catch((e) => setNotice({ text: e.message, error: true }));
  };
  return (
    <div
      className="splitter"
      role="separator"
      aria-label="调整设备列表宽度"
      aria-orientation="vertical"
      aria-valuemin={220}
      aria-valuemax={viewport - 645}
      aria-valuenow={sidebar}
      tabIndex={0}
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        cleanup.current();
        // 在窗口范围内监听拖动，离开细分隔条后仍可连续调整；结束或卸载时恢复文本选择。
        const previousCursor = document.body.style.cursor,
          previousSelect = document.body.style.userSelect;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        const move = (e: MouseEvent) => setWidth(clamp(e.clientX));
        const up = (e: MouseEvent) => {
          const next = clamp(e.clientX);
          setWidth(next);
          save(next);
          cleanup.current();
        };
        const stop = () => cleanup.current();
        cleanup.current = () => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          window.removeEventListener('blur', stop);
          document.body.style.cursor = previousCursor;
          document.body.style.userSelect = previousSelect;
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
        window.addEventListener('blur', stop);
      }}
      onKeyDown={(e) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(e.key)) return;
        e.preventDefault();
        const next = e.key === 'Home' ? 248 : clamp(sidebar + (e.key === 'ArrowLeft' ? -10 : 10));
        setWidth(next);
        save(next);
      }}
    />
  );
}
