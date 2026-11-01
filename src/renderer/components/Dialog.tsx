import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
export function Dialog({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const trigger = useRef(document.activeElement);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    // showModal 后再聚焦，避免 React 挂载时的 autoFocus 被浏览器默认焦点覆盖。
    const input = dialog.querySelector<HTMLInputElement>('input:not([disabled])');
    input?.focus();
    input?.select();
    return () => {
      dialog.close();
      // 对话框卸载后回到打开它的控件，键盘用户可从原位置继续操作。
      if (trigger.current instanceof HTMLElement && trigger.current.isConnected) trigger.current.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="dialog-header">
        <h2 id="dialog-title">{title}</h2>
        <button className="icon-button" aria-label="关闭对话框" onClick={onClose} disabled={busy}>
          <X aria-hidden="true" />
        </button>
      </header>
      {children}
    </dialog>
  );
}
