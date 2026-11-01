import { useWorkbench } from '../hooks/useWorkbench';
import { Package, Upload, FilePlus2, Download, X } from 'lucide-react';

import { sizeLabel } from './format';
export function InstallPage() {
  const {
    api,
    tab,
    apk,
    setApk,
    setComponent,
    allowTest,
    setAllowTest,
    ownerAfter,
    setOwnerAfter,
    dragging,
    setDragging,
    busy,
    setNotice,
    online,
    title,
    run,
    chooseApk,
    install,
  } = useWorkbench();
  return (
    <>
      {tab === 'install' && (
        <>
          <section>
            <div className="section-heading">
              <h2>
                <Package className="icon-install" aria-hidden="true" />
                安装包
              </h2>
              {apk && (
                <button className="text-button" disabled={!!busy} onClick={() => void chooseApk()}>
                  更换 APK
                </button>
              )}
            </div>
            <div
              className={'drop-zone ' + (dragging ? 'dragging' : '') + (apk ? ' has-apk' : '')}
              onDragEnter={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (busy) return;
                if (e.dataTransfer.files.length !== 1) {
                  setNotice({ text: '请一次拖入一个完整 APK。', error: true });
                  return;
                }
                const file = e.dataTransfer.files[0];
                void run('读取安装包', async () => {
                  const next = await api.dropApk(file);
                  setApk(next);
                  setComponent(next.admins[0] || '');
                });
              }}
            >
              {apk ? (
                <>
                  <div className="package-symbol">
                    <Package aria-hidden="true" />
                  </div>
                  <div className="package-title">
                    <strong>{apk.fileName}</strong>
                    <span>
                      {sizeLabel(apk.size)}
                      <span className="separator-dot">·</span>APK 安装包
                    </span>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="移除安装包"
                    disabled={!!busy}
                    onClick={() => setApk(undefined)}
                  >
                    <X aria-hidden="true" />
                  </button>
                </>
              ) : (
                <>
                  <Upload aria-hidden="true" size={26} />
                  <strong>将 APK 拖到这里</strong>
                  <span>支持单个完整的 Android 安装包</span>
                  <button disabled={!!busy} onClick={() => void chooseApk()}>
                    <FilePlus2 className="icon-install" aria-hidden="true" />
                    选择文件
                  </button>
                </>
              )}
            </div>
            {apk && (
              <dl className="properties apk-properties">
                {[
                  ['应用包名', apk.packageName],
                  ['版本', `${apk.versionName} (${apk.versionCode})`],
                  ['最低 Android API', apk.minimumSdk],
                  ['管理组件', apk.admins.length ? `${apk.admins.length} 个已识别` : '未声明'],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd title={value}>{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
          <section className="install-options">
            <h2>安装选项</h2>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={allowTest}
                onChange={(e) => setAllowTest(e.target.checked)}
                disabled={!!busy}
              />
              允许安装测试包 <code>testOnly</code>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={ownerAfter}
                onChange={(e) => setOwnerAfter(e.target.checked)}
                disabled={!!busy}
              />
              安装后配置设备所有者
            </label>
            <p className="field-hint">覆盖升级保留应用数据。配置设备所有者需要再次检查并确认授权。</p>
          </section>
          <div className="install-action">
            <span className="muted">{online ? '目标：' + title : '请先选择已连接的设备'}</span>
            <button className="primary" disabled={!online || !apk || !!busy} onClick={() => void install()}>
              <Download aria-hidden="true" />
              安装到此设备
            </button>
          </div>
        </>
      )}
    </>
  );
}
