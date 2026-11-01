// @vitest-environment jsdom
import { effectScope, nextTick } from 'vue';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWorkbench } from '../../src/renderer/composables/workbench';
import { targetKey, type Api, type Snapshot } from '../../src/shared/contracts';
import { language, setLanguage } from '../../src/shared/i18n';
const first = { serial: 'one', transportId: '1', model: '第一台', state: 'device' };
const second = { serial: 'two', transportId: '2', model: '第二台', state: 'device' };
let snapshot: Snapshot, api: Api;
const scopes: ReturnType<typeof effectScope>[] = [];
beforeEach(() => {
  snapshot = {
    devices: [first, second],
    settings: { adbPath: '', endpoint: '', deviceNames: {}, hiddenDevices: [], sidebarWidth: 248 },
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
  await w.refresh();
  await vi.waitFor(() => {
    expect(w.state.details?.serial).toBe('one');
    expect(w.state.busy).toBe('');
  });
  return w;
}
it('文件页切换设备等待信息读取后再读取新目录', async () => {
  const w = await ready();
  w.state.tab = 'files';
  await vi.waitFor(() => expect(w.state.files[0]?.name).toBe('one.txt'));
  w.select(second);
  await vi.waitFor(() => expect(w.state.files[0]?.name).toBe('two.txt'));
  w.select(first);
  await vi.waitFor(() => expect(w.state.files[0]?.name).toBe('one.txt'));
});
it('首次保存确定的语言，后续刷新不重新识别或覆盖手动选择', async () => {
  const w = await ready();
  expect(api.language).toHaveBeenCalledExactlyOnceWith('en');
  setLanguage('zh-CN');
  await w.refresh();
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
  const refresh = w.refresh();
  await vi.waitFor(() => expect(api.language).toHaveBeenCalledTimes(1));
  expect(api.details).not.toHaveBeenCalled();
  saved();
  await refresh;
  await vi.waitFor(() => expect(w.state.details?.serial).toBe('one'));
  expect(w.state.notice).toBeNull();
});
it('切回曾访问的设备不会把空缓存误当作已加载', async () => {
  const w = await ready();
  w.state.tab = 'files';
  await vi.waitFor(() => expect(w.state.files).toHaveLength(1));
  w.state.tab = 'info';
  w.select(second);
  await vi.waitFor(() => expect(w.state.details?.serial).toBe('two'));
  w.select(first);
  await vi.waitFor(() => expect(w.state.details?.serial).toBe('one'));
  w.state.tab = 'files';
  await vi.waitFor(() => expect(w.state.files[0]?.name).toBe('one.txt'));
});
it('断连撤销所有者授权，重连要求重新选择传输会话', async () => {
  const w = await ready();
  w.state.ownerCheck = { canSet: true, alreadySet: false, summary: 'ok' };
  w.state.consent = true;
  snapshot.devices = [{ ...first, transportId: '99' }];
  await w.refresh();
  expect(w.device.value).toBeUndefined();
  expect(w.state.consent).toBe(false);
  expect(w.state.ownerCheck).toBeUndefined();
  expect(w.state.selected).toBe(targetKey(first));
});
it('跨页和换设备保留已选安装包', async () => {
  const w = await ready();
  await w.chooseApk();
  w.state.tab = 'info';
  w.select(second);
  await vi.waitFor(() => expect(w.state.details?.serial).toBe('two'));
  expect(w.state.apk?.fileName).toBe('test.apk');
});
it('安装后没有组件也展开手动填写入口且不自动授权', async () => {
  const w = await ready();
  await w.chooseApk();
  w.state.ownerAfter = true;
  await w.install();
  expect(w.state.tab).toBe('info');
  expect(w.state.ownerExpanded).toBe(true);
  expect(w.state.consent).toBe(false);
});
it('变更组件撤销旧检查和授权', async () => {
  const w = await ready();
  w.state.ownerCheck = { canSet: true, alreadySet: false, summary: 'ok' };
  w.state.consent = true;
  w.state.component = 'com.test/.Other';
  await nextTick();
  expect(w.state.ownerCheck).toBeUndefined();
  expect(w.state.consent).toBe(false);
});
