// @vitest-environment jsdom
import { effectScope, nextTick } from 'vue';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWorkbench } from '@/app/workbench';
import { type Api, type Snapshot } from '@/shared/api/types';
import { targetKey } from '@/shared/utils/device';
import { language, setLanguage } from '@/shared/i18n/index';
const first = { serial: 'one', transportId: '1', model: '第一台', network: false, state: 'device' };
const second = { serial: 'two', transportId: '2', model: '第二台', network: false, state: 'device' };
let snapshot: Snapshot, api: Api;
const scopes: ReturnType<typeof effectScope>[] = [];
beforeEach(() => {
  snapshot = {
    devices: [first, second],
    settings: {
      adbSource: 'bundled',
      adbPath: '',
      endpoint: '',
      deviceNames: {},
      hiddenDevices: [],
      sidebarWidth: 248,
    },
    adbPath: '/adb',
    platform: 'darwin',
    version: '0.1.0',
  };
  api = {
    refresh: vi.fn(async () => structuredClone(snapshot)),
    language: vi.fn(async () => {}),
    details: vi.fn(async (d) => ({
      android: '10',
      api: '29',
      owner: null,
      manufacturer: 'Test',
      model: d.serial,
      architecture: 'arm64',
      patch: '2026-01-01',
      serial: d.serial,
    })),
    listFiles: vi.fn(async (d) => [
      { name: d.serial + '.txt', path: '/sdcard/' + d.serial + '.txt', type: 'file', size: 1, modified: 1 },
    ]),
    chooseApk: vi.fn(async () => ({
      id: 'apk',
      fileName: 'test.apk',
      packageName: 'com.test.app',
      versionName: '1',
      versionCode: '1',
      minimumSdk: '23',
      testOnly: false,
      size: 5,
      admins: [],
    })),
    install: vi.fn(async () => {}),
  } as unknown as Api;
});
afterEach(() => scopes.splice(0).forEach((scope) => scope.stop()));
async function ready() {
  const scope = effectScope();
  scopes.push(scope);
  const w = scope.run(() => createWorkbench(api))!;
  await w.devices.refresh();
  await vi.waitFor(() => {
    expect(w.devices.state.details?.serial).toBe('one');
    expect(w.workspace.state.busy).toBe('');
  });
  return w;
}
it('文件页切换设备等待信息读取后再读取新目录', async () => {
  const w = await ready();
  w.workspace.state.tab = 'files';
  await vi.waitFor(() => expect(w.files.state.files[0]?.name).toBe('one.txt'));
  w.devices.select(second);
  await vi.waitFor(() => expect(w.files.state.files[0]?.name).toBe('two.txt'));
  w.devices.select(first);
  await vi.waitFor(() => expect(w.files.state.files[0]?.name).toBe('one.txt'));
});
it('合并后保留当前传输，失去该传输时只接回已核实的在线成员', async () => {
  const mdns = { ...first, serial: 'adb-A._adb-tls-connect._tcp', network: true, networkBootId: 'boot-a' };
  const ip = { ...mdns, serial: '10.0.0.2:5555', transportId: '20' };
  snapshot.devices = [mdns];
  const scope = effectScope();
  scopes.push(scope);
  const w = scope.run(() => createWorkbench(api))!;
  await w.devices.refresh();
  snapshot.devices = [mdns, ip, second];
  await w.devices.refresh();
  expect(w.devices.rows.value.map((row) => row.primary.serial)).toEqual([ip.serial, second.serial]);
  expect(w.workspace.state.selected).toBe(targetKey(mdns));
  snapshot.devices = [ip, second];
  await w.devices.refresh();
  expect(w.workspace.state.selected).toBe(targetKey(ip));
  snapshot.devices = [{ ...ip, transportId: '99' }, second];
  await w.devices.refresh();
  expect(w.devices.device.value).toBeUndefined();
});
it('首次保存确定的语言，后续刷新不重新识别或覆盖手动选择', async () => {
  const w = await ready();
  expect(api.language).toHaveBeenCalledExactlyOnceWith('en');
  setLanguage('zh-CN');
  await w.devices.refresh();
  expect(api.language).toHaveBeenCalledTimes(1);
  expect(language.value).toBe('zh-CN');
});
it('已有明确语言时不再次写入偏好', async () => {
  snapshot.settings.language = 'zh-CN';
  await ready();
  expect(api.language).not.toHaveBeenCalled();
  expect(language.value).toBe('zh-CN');
});
it('首次语言持久化完成前不启动设备详情请求，避免原生任务互斥冲突', async () => {
  let saved!: () => void;
  vi.mocked(api.language).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        saved = resolve;
      }),
  );
  const scope = effectScope();
  scopes.push(scope);
  const w = scope.run(() => createWorkbench(api))!;
  const refresh = w.devices.refresh();
  await vi.waitFor(() => expect(api.language).toHaveBeenCalledTimes(1));
  expect(api.details).not.toHaveBeenCalled();
  saved();
  await refresh;
  await vi.waitFor(() => expect(w.devices.state.details?.serial).toBe('one'));
  expect(w.workspace.state.notice).toBeNull();
});
it('切回曾访问的设备不会把空缓存误当作已加载', async () => {
  const w = await ready();
  w.workspace.state.tab = 'files';
  await vi.waitFor(() => expect(w.files.state.files).toHaveLength(1));
  w.workspace.state.tab = 'info';
  w.devices.select(second);
  await vi.waitFor(() => expect(w.devices.state.details?.serial).toBe('two'));
  w.devices.select(first);
  await vi.waitFor(() => expect(w.devices.state.details?.serial).toBe('one'));
  w.workspace.state.tab = 'files';
  await vi.waitFor(() => expect(w.files.state.files[0]?.name).toBe('one.txt'));
});
it('断连撤销所有者授权，重连要求重新选择传输会话', async () => {
  const w = await ready();
  w.owner.state.ownerCheck = { canSet: true, alreadySet: false, summary: 'ok' };
  w.owner.state.consent = true;
  snapshot.devices = [{ ...first, transportId: '99' }];
  await w.devices.refresh();
  expect(w.workspace.device.value).toBeUndefined();
  expect(w.owner.state.consent).toBe(false);
  expect(w.owner.state.ownerCheck).toBeUndefined();
  expect(w.workspace.state.selected).toBe(targetKey(first));
});
it('切换设备关闭安装弹窗并清除文件和安装选项', async () => {
  const w = await ready();
  await w.install.chooseApk();
  expect(w.workspace.state.tab).toBe('apps');
  w.workspace.state.tab = 'info';
  w.devices.select(second);
  await vi.waitFor(() => expect(w.devices.state.details?.serial).toBe('two'));
  expect(w.workspace.state.modal).toBeNull();
  expect(w.install.state.apk).toBeUndefined();
  expect(w.install.state.ownerConsent).toBeUndefined();
});
it('无接收器时不能从安装流程配置所有者，仍可正常安装', async () => {
  const w = await ready();
  await w.install.chooseApk();
  w.install.requestOwnerAfter(true);
  w.install.finishOwnerWarning(true);
  expect(w.install.state.ownerWarningOpen).toBe(false);
  expect(w.install.state.ownerConsent).toBeUndefined();
  await w.install.install();
  expect(api.install).toHaveBeenCalledTimes(1);
  expect(w.owner.state.ownerExpanded).toBe(false);
  expect(w.owner.state.consent).toBe(false);
});
it('变更组件撤销旧检查和授权', async () => {
  const w = await ready();
  w.owner.state.ownerCheck = { canSet: true, alreadySet: false, summary: 'ok' };
  w.owner.state.consent = true;
  w.owner.state.component = 'com.test/.Other';
  await nextTick();
  expect(w.owner.state.ownerCheck).toBeUndefined();
  expect(w.owner.state.consent).toBe(false);
});

it('销毁工作台后移除领域监听，重复销毁不会再触发设备或目录读取', async () => {
  const w = await ready();
  w.dispose();
  w.dispose();
  vi.mocked(api.details).mockClear();
  w.workspace.state.selected = targetKey(second);
  w.workspace.state.tab = 'files';
  await nextTick();
  expect(api.details).not.toHaveBeenCalled();
  expect(api.listFiles).not.toHaveBeenCalled();
});
it('所有者检查期间断线，迟到结果不能恢复已撤销的授权', async () => {
  const w = await ready();
  let finish!: (value: { canSet: boolean; alreadySet: boolean; summary: string }) => void;
  api.checkOwner = vi.fn(
    () =>
      new Promise<Awaited<ReturnType<Api['checkOwner']>>>((resolve) => {
        finish = resolve;
      }),
  );
  const checking = w.owner.checkOwner();
  snapshot.devices = [{ ...first, state: 'offline' }];
  await w.devices.refresh();
  finish({ canSet: true, alreadySet: false, summary: 'old' });
  await checking;
  expect(w.owner.state.ownerCheck).toBeUndefined();
  expect(w.owner.state.consent).toBe(false);
});

it('工作台实例各自拥有业务状态，销毁一份不会停止另一份的设备切换', async () => {
  const a = await ready();
  const b = await ready();
  a.apps.state.appQuery = '只属于第一个工作台';
  a.files.state.path = '/sdcard/Download';
  a.owner.state.ownerExpanded = true;
  expect(b.apps.state.appQuery).toBe('');
  expect(b.files.state.path).toBe('/sdcard');
  expect(b.owner.state.ownerExpanded).toBe(false);
  a.dispose();
  b.devices.select(second);
  await vi.waitFor(() => expect(b.devices.state.details?.serial).toBe('two'));
  expect(a.devices.state.details?.serial).toBe('one');
  b.dispose();
});
it('功能状态独立后，安装任务仍会阻止文件写入，完成后才允许创建目录', async () => {
  const w = await ready();
  await w.install.chooseApk();
  let complete!: () => void;
  vi.mocked(api.install).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  api.mkdir = vi.fn(async () => {});
  api.listApps = vi.fn(async () => []);
  const installing = w.install.install();
  expect(api.install).toHaveBeenCalledTimes(1);
  w.workspace.state.name = 'new-folder';
  await w.files.createFolder();
  expect(api.mkdir).not.toHaveBeenCalled();
  complete();
  await installing;
  await w.files.createFolder();
  expect(api.mkdir).toHaveBeenCalledExactlyOnceWith(first, '/sdcard', 'new-folder');
  w.dispose();
});
