import { useWorkbench } from '../hooks/useWorkbench';

import { Dialog } from './Dialog';
import { APP_NAME, APP_SHORT_NAME } from '../../shared/app-info';
export function SettingsDialog() {
  const { api, snapshot, busy, notice, modal, setModal, run, refresh } = useWorkbench();
  return (
    <>
      {modal === 'settings' && (
        <Dialog title="设置" onClose={() => setModal(null)} busy={!!busy}>
          <div className="dialog-body">
            <h3>Android Debug Bridge</h3>
            <p className="field-hint">优先使用应用附带的 ADB，也可以选择本机版本。</p>
            <div className="path-display">{snapshot?.adbPath || '尚未找到 ADB'}</div>
            <div className="button-row">
              <button
                disabled={!!busy}
                onClick={() =>
                  void run('验证 ADB', async () => {
                    if (await api.chooseAdb()) await refresh();
                  })
                }
              >
                选择 ADB…
              </button>
              <button
                disabled={!!busy || !snapshot?.settings.adbPath}
                onClick={() =>
                  void run('恢复 ADB', async () => {
                    await api.resetAdb();
                    await refresh();
                  })
                }
              >
                恢复自动查找
              </button>
            </div>
            <div className="settings-section">
              <h3>设备列表</h3>
              <p className="field-hint">
                已移除 {snapshot?.settings.hiddenDevices.length || 0} 台设备。移除仅隐藏本机列表条目。
              </p>
              <button
                disabled={!!busy || !snapshot?.settings.hiddenDevices.length}
                onClick={() =>
                  void run('恢复设备列表', async () => {
                    await api.restore();
                    await refresh();
                  })
                }
              >
                恢复显示所有设备
              </button>
            </div>
            <div className="settings-about">
              <div className="app-identity">
                <strong>{APP_NAME}</strong>
                <span>{APP_SHORT_NAME}</span>
              </div>
              <span>版本 {snapshot?.version}</span>
            </div>
            {notice?.error && <p className="inline-result error">{notice.text}</p>}
          </div>
          <footer className="dialog-footer">
            <button onClick={() => setModal(null)} disabled={!!busy}>
              完成
            </button>
          </footer>
        </Dialog>
      )}
    </>
  );
}
