import { SidebarDivider } from './components/SidebarDivider';
import type { CSSProperties } from 'react';
import { Smartphone, X, Check, LoaderCircle, Package, FolderOpen } from 'lucide-react';
import { connection, deviceStatus, targetKey } from '../shared/contracts';
import { useWorkbench, useWorkbenchState, WorkbenchContext } from './hooks/useWorkbench';
import { Dialog } from './components/Dialog';
import { ConnectionDialog } from './components/ConnectionDialog';
import { Sidebar } from './components/Sidebar';
import { DeviceInfoPage } from './components/DeviceInfoPage';
import { InstallPage } from './components/InstallPage';
import { FilesPage } from './components/FilesPage';
import { SettingsDialog } from './components/SettingsDialog';
const tabs = [
  ['info', '设备信息', Smartphone],
  ['install', '安装应用', Package],
  ['files', '文件管理', FolderOpen],
] as const;
export function App() {
  const workbench = useWorkbenchState();
  return (
    <WorkbenchContext.Provider value={workbench}>
      <AppShell />
    </WorkbenchContext.Provider>
  );
}
function AppShell() {
  const {
    api,
    snapshot,
    setSnapshot,
    setSelected,
    tab,
    setTab,
    details,
    busy,
    notice,
    setNotice,
    modal,
    setModal,
    renameDevice,
    name,
    setName,
    sidebar,
    path,
    setFiles,
    device,
    online,
    title,
    run,
    refresh,
  } = useWorkbench();
  return (
    <div
      className={'app ' + (snapshot?.platform || '')}
      style={{ '--sidebar-width': `${sidebar}px` } as CSSProperties}
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
      }}
    >
      <Sidebar />
      <SidebarDivider />
      <main className="workspace">
        <header className="device-header">
          <div className="device-symbol">
            <Smartphone aria-hidden="true" />
          </div>
          <div className="device-title">
            <h1 title={title}>{title}</h1>
            <p>
              {device ? (
                <>
                  <span className={'status-dot ' + (online ? 'online' : '')} />
                  {deviceStatus(device)}
                  <span className="separator-dot">·</span>
                  {connection(device)}
                  {details && online && (
                    <>
                      <span className="separator-dot">·</span>Android {details.android}
                    </>
                  )}
                  <span className="separator-dot">·</span>
                  <span className="serial">{device.serial}</span>
                </>
              ) : (
                '连接 Android 设备，开始管理'
              )}
            </p>
          </div>
        </header>
        <div className="tabs" role="tablist" aria-label="设备操作">
          {tabs.map(([value, label, Icon], i) => (
            <button
              role="tab"
              id={'tab-' + value}
              key={value}
              aria-selected={tab === value}
              aria-controls="task-panel"
              tabIndex={tab === value ? 0 : -1}
              disabled={!!busy}
              onClick={() => setTab(value)}
              onKeyDown={(e) => {
                if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
                  const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : 2)) % 3][0];
                  setTab(next);
                  document.getElementById('tab-' + next)?.focus();
                }
              }}
            >
              <Icon className={'icon-' + value} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        <div className="task-content" id="task-panel" role="tabpanel" aria-labelledby={'tab-' + tab}>
          <DeviceInfoPage />
          <InstallPage />
          <FilesPage />
        </div>
        {(busy || notice) && (
          <div
            className={'task-notice ' + (notice?.error ? 'error' : '')}
            role={notice?.error ? 'alert' : 'status'}
          >
            {busy ? (
              <LoaderCircle aria-hidden="true" className="spin" />
            ) : notice?.error ? (
              <span className="error-mark">!</span>
            ) : (
              <Check aria-hidden="true" />
            )}
            <span>{busy || notice?.text}</span>
            {busy ? (
              <button onClick={() => void api.cancel()}>停止等待</button>
            ) : (
              <button className="icon-button" aria-label="关闭提示" onClick={() => setNotice(null)}>
                <X aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </main>
      {modal === 'connect' && (
        <ConnectionDialog
          endpoint={snapshot?.settings.endpoint || ''}
          onClose={() => setModal(null)}
          connected={async (address) => {
            await refresh();
            const next = await api.refresh();
            setSnapshot(next);
            const d = next.devices.find((d) => d.serial === address);
            if (d) setSelected(targetKey(d));
          }}
        />
      )}
      <SettingsDialog />
      {(modal === 'rename' || modal === 'folder') && (
        <Dialog
          title={modal === 'rename' ? '备注名称' : '新建文件夹'}
          onClose={() => setModal(null)}
          busy={!!busy}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(modal === 'rename' ? '保存备注' : '创建文件夹', async () => {
                if (modal === 'rename') {
                  await api.rename(renameDevice!.serial, name);
                  await refresh();
                } else {
                  await api.mkdir(device!, path, name);
                  setFiles(await api.listFiles(device!, path));
                }
                setModal(null);
              });
            }}
          >
            <div className="dialog-body">
              <label className="field">
                {modal === 'rename' ? '设备备注' : '文件夹名称'}
                <input
                  autoFocus
                  value={name}
                  maxLength={modal === 'rename' ? 80 : 255}
                  required={modal === 'folder'}
                  disabled={!!busy}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <p className="field-hint">
                {modal === 'rename' ? '备注仅在本机显示，留空恢复设备原名称。' : `创建于 ${path}`}
              </p>
              {notice?.error && <p className="inline-result error">{notice.text}</p>}
            </div>
            <footer className="dialog-footer">
              <button type="button" onClick={() => setModal(null)} disabled={!!busy}>
                取消
              </button>
              <button className="primary" type="submit" disabled={!!busy}>
                {modal === 'rename' ? '保存' : '创建'}
              </button>
            </footer>
          </form>
        </Dialog>
      )}
    </div>
  );
}
