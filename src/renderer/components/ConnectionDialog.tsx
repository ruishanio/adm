import { useState } from 'react';
import { Cable, Network, Wifi } from 'lucide-react';
import { Dialog } from './Dialog';
const connectionTabs = [
  ['network', '网络连接', Network],
  ['pair', '无线配对', Wifi],
  ['usb', 'USB 连接', Cable],
] as const;
export function ConnectionDialog({
  endpoint,
  onClose,
  connected,
}: {
  endpoint: string;
  onClose: () => void;
  connected: (address: string) => Promise<void>;
}) {
  const [tab, setTab] = useState('network'),
    [address, setAddress] = useState(endpoint),
    [pairAddress, setPairAddress] = useState(''),
    [code, setCode] = useState('');
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(false);
  async function submit() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      if (tab === 'pair') {
        await window.androidTool.pair(pairAddress, code);
        setCode('');
        setTab('network');
        setMessage('配对成功，请填写无线调试主页上的连接地址。');
        setError(false);
      } else {
        await window.androidTool.connect(address);
        await connected(address.trim());
        onClose();
      }
    } catch (e) {
      setMessage((e as Error).message);
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="连接设备" onClose={onClose} busy={busy}>
      <div className="dialog-body">
        <div className="segmented" role="tablist" aria-label="连接方式">
          {connectionTabs.map(([value, label, Icon], index) => {
            return (
              <button
                key={value}
                id={'connection-tab-' + value}
                role="tab"
                aria-selected={tab === value}
                aria-controls="connection-panel"
                tabIndex={tab === value ? 0 : -1}
                disabled={busy}
                onClick={() => {
                  setTab(value);
                  setMessage('');
                }}
                onKeyDown={(e) => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
                  e.preventDefault();
                  const next =
                    e.key === 'Home'
                      ? 0
                      : e.key === 'End'
                        ? 2
                        : (index + (e.key === 'ArrowRight' ? 1 : 2)) % connectionTabs.length;
                  const nextTab = connectionTabs[next][0];
                  setTab(nextTab);
                  setMessage('');
                  document.getElementById('connection-tab-' + nextTab)?.focus();
                }}
              >
                <Icon aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>
        <div id="connection-panel" role="tabpanel" aria-labelledby={'connection-tab-' + tab}>
          {tab === 'usb' ? (
            <div className="usb-guide">
              <p>连接后，设备会自动出现在左侧列表。</p>
              <ol>
                <li>在 Android 设备上开启开发者选项与 USB 调试。</li>
                <li>使用支持数据传输的 USB 线连接电脑。</li>
                <li>解锁设备，允许这台电脑进行调试。</li>
              </ol>
              <p className="muted">Windows 未识别设备时，请安装设备厂商的 ADB 驱动。</p>
            </div>
          ) : (
            <form
              id="connect-form"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <label className="field">
                {tab === 'pair' ? '配对地址' : '设备地址'}
                <input
                  autoFocus
                  aria-describedby="connection-help connection-result"
                  placeholder="192.168.1.100:5555"
                  value={tab === 'pair' ? pairAddress : address}
                  onChange={(e) =>
                    tab === 'pair' ? setPairAddress(e.target.value) : setAddress(e.target.value)
                  }
                  disabled={busy}
                  required
                  spellCheck={false}
                />
              </label>
              {tab === 'pair' && (
                <label className="field">
                  配对码
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="6 位数字"
                    pattern="[0-9]{6}"
                    required
                    disabled={busy}
                  />
                </label>
              )}
              <p className="field-hint" id="connection-help">
                {tab === 'pair'
                  ? '在设备「无线调试 → 使用配对码配对设备」中查看地址和配对码。'
                  : '电脑与设备需处于可互通的网络。无线调试的连接端口与配对端口通常不同。'}
              </p>
            </form>
          )}
          {message && (
            <div
              id="connection-result"
              className={'inline-result ' + (error ? 'error' : 'success')}
              role={error ? 'alert' : 'status'}
            >
              {message}
            </div>
          )}
        </div>
      </div>
      <footer className="dialog-footer">
        {busy ? (
          <>
            <span className="muted">正在{tab === 'pair' ? '配对' : '连接'}…</span>
            <button onClick={() => void window.androidTool.cancel()}>停止等待</button>
          </>
        ) : (
          <>
            <button onClick={onClose}>{tab === 'usb' ? '完成' : '取消'}</button>
            {tab !== 'usb' && (
              <button className="primary" type="submit" form="connect-form">
                {tab === 'pair' ? '配对设备' : '连接'}
              </button>
            )}
          </>
        )}
      </footer>
    </Dialog>
  );
}
