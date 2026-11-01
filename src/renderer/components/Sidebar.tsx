import { useWorkbench } from '../hooks/useWorkbench';
import { RefreshCw, Plus, Settings2, Search, Cable, Smartphone } from 'lucide-react';
import { connection, deviceName, deviceStatus, targetKey, type Device } from '../../shared/contracts';
import { APP_NAME, APP_SHORT_NAME } from '../../shared/app-info';

export function Sidebar() {
  const {
    snapshot,
    selected,
    busy,
    setNotice,
    query,
    setQuery,
    setModal,
    refresh,
    editName,
    contextMenu,
    select,
    detailRequest,
  } = useWorkbench();
  const connectedDevices = snapshot?.devices.filter((d) => d.state === 'device') || [];
  const otherDevices = snapshot?.devices.filter((d) => d.state !== 'device') || [];
  const deviceRows = (items: Device[]) =>
    items
      .filter((d) =>
        `${deviceName(d, snapshot?.settings)} ${d.serial}`.toLowerCase().includes(query.toLowerCase()),
      )
      .map((d) => (
        <button
          className={'device-row ' + (selected === targetKey(d) ? 'selected' : '')}
          key={targetKey(d)}
          disabled={!!busy}
          aria-pressed={selected === targetKey(d)}
          title={`${deviceName(d, snapshot?.settings)}\n${d.serial} · ${deviceStatus(d)}`}
          onClick={() => select(d)}
          onContextMenu={(e) => {
            e.preventDefault();
            void contextMenu(d).catch((e) => setNotice({ text: e.message, error: true }));
          }}
          onKeyDown={(e) => {
            if (e.key === 'F2') {
              e.preventDefault();
              editName(d);
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.device-row'));
              buttons[
                (buttons.indexOf(e.currentTarget) + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) %
                  buttons.length
              ]?.focus();
            }
          }}
        >
          <Smartphone
            className={'device-icon' + (d.state === 'device' ? ' connected' : '')}
            aria-hidden="true"
          />
          <span className="device-name">{deviceName(d, snapshot?.settings)}</span>
          <span
            className={
              'status-dot ' + (d.state === 'device' ? 'online' : d.state === 'unauthorized' ? 'pending' : '')
            }
            aria-label={deviceStatus(d)}
          />
          <span className="device-caption">
            {d.state === 'device' ? connection(d) : deviceStatus(d)}
            <span>·</span>
            {d.serial}
          </span>
        </button>
      ));

  return (
    <>
      <aside className="sidebar">
        <header className="sidebar-heading">
          <span className="app-mark" aria-hidden="true">
            <Smartphone />
          </span>
          <h1 title={APP_NAME}>{APP_SHORT_NAME}</h1>
        </header>
        {(snapshot?.devices.length || 0) > 5 && (
          <label className="device-search">
            <Search aria-hidden="true" />
            <input
              aria-label="查找设备"
              placeholder="查找设备"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        )}
        <nav className="device-list" aria-label="设备列表">
          {/* 分组标题始终保留，零台在线设备时也能通过此处刷新。 */}
          <div className="device-group-heading">
            <h2 className="group-title">已连接</h2>
            <span className="device-count" aria-label={`${connectedDevices.length} 台已连接设备`}>
              {connectedDevices.length}
            </span>
            <button
              className="icon-button"
              aria-label="刷新设备"
              title="刷新设备 · ⌘/Ctrl+R"
              disabled={!!busy}
              onClick={() => {
                detailRequest.current = '';
                void refresh();
              }}
            >
              <RefreshCw aria-hidden="true" />
            </button>
          </div>
          {deviceRows(connectedDevices)}
          {otherDevices.length > 0 && (
            <>
              <h2 className="group-title">其他设备</h2>
              {deviceRows(otherDevices)}
            </>
          )}
          {snapshot && !snapshot.devices.length && (
            <div className="sidebar-empty">
              <Cable aria-hidden="true" size={24} />
              <p>尚未发现设备</p>
              <span>连接 USB，或添加网络设备</span>
            </div>
          )}
        </nav>
        <footer className="sidebar-footer">
          <button className="connect-button" disabled={!!busy} onClick={() => setModal('connect')}>
            <Plus aria-hidden="true" />
            连接设备
          </button>
          <div className="sidebar-settings">
            <button className="quiet" disabled={!!busy} onClick={() => setModal('settings')}>
              <Settings2 aria-hidden="true" />
              设置
            </button>
            <span>v{snapshot?.version || '1.0.0'}</span>
          </div>
        </footer>
      </aside>
    </>
  );
}
