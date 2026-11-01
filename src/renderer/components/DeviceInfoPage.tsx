import { useWorkbench } from '../hooks/useWorkbench';
import { useEffect, useState } from 'react';
import { Smartphone, ArrowRight, ShieldCheck, ChevronRight, Cpu } from 'lucide-react';
import { deviceStatus } from '../../shared/contracts';

export function DeviceInfoPage() {
  const {
    api,
    tab,
    details,
    setDetails,
    apk,
    component,
    ownerAfter,
    setComponent,
    ownerCheck,
    setOwnerCheck,
    consent,
    setConsent,
    busy,
    setModal,
    device,
    online,
    run,
  } = useWorkbench();
  const [ownerExpanded, setOwnerExpanded] = useState(false);
  useEffect(() => {
    // 安装后继续配置或已有检查反馈时展开，避免下一步操作被折叠区域遮住。
    if (component || ownerCheck || ownerAfter) setOwnerExpanded(true);
  }, [component, ownerCheck, ownerAfter]);
  return (
    <>
      {tab === 'info' &&
        (!device || !online ? (
          <div className="empty-state">
            <Smartphone aria-hidden="true" />
            <h2>{device ? deviceStatus(device) : '从左侧选择设备'}</h2>
            <p>
              {device?.state === 'unauthorized'
                ? '请解锁设备并允许此电脑进行调试。'
                : '设备连接后，可查看系统信息并配置设备所有者。'}
            </p>
            <button onClick={() => setModal('connect')}>
              连接设备
              <ArrowRight aria-hidden="true" />
            </button>
          </div>
        ) : (
          <>
            <section>
              <div className="section-heading">
                <h2>
                  <Cpu className="icon-info" aria-hidden="true" />
                  系统信息
                </h2>
                {!details && <span className="muted">正在读取…</span>}
              </div>
              <dl className="properties system-properties">
                {[
                  ['制造商', details?.manufacturer],
                  ['型号', details?.model],
                  ['Android 版本', details ? `${details.android} · API ${details.api}` : undefined],
                  ['安全补丁', details?.patch],
                  ['处理器架构', details?.architecture],
                  ['设备序列号', details?.serial],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd title={value}>{value || '—'}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="owner-section">
              <div className="section-heading">
                <h2>
                  <ShieldCheck className="icon-owner" aria-hidden="true" />
                  设备所有者
                </h2>
              </div>
              <div className="owner-current">
                <span className="muted">当前所有者</span>
                <span className={details?.owner ? 'mono' : ''}>
                  {details ? details.owner || '尚未设置' : '读取中…'}
                </span>
              </div>
              <button
                className="quiet owner-config-toggle"
                aria-expanded={ownerExpanded}
                aria-controls="owner-configuration"
                onClick={() => setOwnerExpanded(!ownerExpanded)}
              >
                <ChevronRight aria-hidden="true" />
                配置设备所有者
              </button>
              <div className="owner-form" id="owner-configuration" hidden={!ownerExpanded}>
                {apk && apk.admins.length > 0 && (
                  <div className="form-row">
                    <label htmlFor="apk-admin">安装包组件</label>
                    <select
                      id="apk-admin"
                      aria-label="从安装包选择管理组件"
                      disabled={!!busy}
                      value={apk.admins.includes(component) ? component : ''}
                      onChange={(e) => setComponent(e.target.value)}
                    >
                      <option value="" disabled>
                        从安装包中选择
                      </option>
                      {apk.admins.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="form-row">
                  <label htmlFor="owner-component">管理组件</label>
                  <div className="component-input">
                    <input
                      id="owner-component"
                      aria-describedby={ownerCheck ? 'owner-result' : 'owner-help'}
                      placeholder="com.example.app/.DeviceAdminReceiver"
                      value={component}
                      disabled={!!busy}
                      spellCheck={false}
                      onChange={(e) => setComponent(e.target.value)}
                    />
                    <button
                      disabled={!!busy || !component.trim()}
                      onClick={() =>
                        void run('检查设备所有者条件', async () =>
                          setOwnerCheck(await api.checkOwner(device, component)),
                        )
                      }
                    >
                      检查条件
                    </button>
                  </div>
                </div>
                {ownerCheck ? (
                  <div
                    id="owner-result"
                    role="status"
                    className={
                      'inline-result ' + (ownerCheck.canSet || ownerCheck.alreadySet ? 'success' : 'error')
                    }
                  >
                    {ownerCheck.summary}
                  </div>
                ) : (
                  <p className="field-hint" id="owner-help">
                    先安装管理应用，再检查组件、主用户和账号状态。
                  </p>
                )}
                <div className="owner-actions">
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={consent}
                      disabled={!!busy || !ownerCheck?.canSet}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    <span>确认将此设备授权给上述管理应用</span>
                  </label>
                  <button
                    className="primary"
                    disabled={!!busy || !consent || !ownerCheck?.canSet}
                    onClick={() =>
                      void run(
                        '设置设备所有者',
                        async () => {
                          await api.setOwner(device, component, consent);
                          setDetails(await api.details(device));
                          setConsent(false);
                          setOwnerCheck({
                            canSet: false,
                            alreadySet: true,
                            summary: '已设置并回读确认设备所有者。',
                          });
                        },
                        '设备所有者设置成功。',
                      )
                    }
                  >
                    设置设备所有者
                  </button>
                </div>
              </div>
            </section>
          </>
        ))}
    </>
  );
}
