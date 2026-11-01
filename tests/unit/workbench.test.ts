// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWorkbenchState } from '../../src/renderer/hooks/useWorkbench';
import { targetKey, type Api, type Snapshot } from '../../src/shared/contracts';
const first = { serial: 'one', transportId: '1', model: '第一台', state: 'device' };
const second = { serial: 'two', transportId: '2', model: '第二台', state: 'device' };
let snapshot: Snapshot;
beforeEach(() => {
  snapshot = {
    devices: [first, second],
    settings: { adbPath: '', endpoint: '', deviceNames: {}, hiddenDevices: [], sidebarWidth: 248 },
    adbPath: '/adb',
    platform: 'darwin',
    version: '1.0.0',
  };
  const api = {
    refresh: vi.fn(async () => structuredClone(snapshot)),
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
  } as unknown as Api;
  window.androidTool = api;
});
afterEach(cleanup);
async function ready() {
  const hook = renderHook(() => useWorkbenchState());
  await waitFor(() => {
    expect(hook.result.current.details?.serial).toBe('one');
    expect(hook.result.current.busy).toBe('');
  });
  return hook;
}
it('文件页切换设备等待信息读取后再读取新目录', async () => {
  const hook = await ready();
  act(() => hook.result.current.setTab('files'));
  await waitFor(() => expect(hook.result.current.files[0]?.name).toBe('one.txt'));
  act(() => hook.result.current.select(second));
  await waitFor(() => expect(hook.result.current.files[0]?.name).toBe('two.txt'));
  act(() => hook.result.current.select(first));
  await waitFor(() => expect(hook.result.current.files[0]?.name).toBe('one.txt'));
});
it('切回曾访问的设备不会把空缓存误当作已加载', async () => {
  const hook = await ready();
  act(() => hook.result.current.setTab('files'));
  await waitFor(() => expect(hook.result.current.files).toHaveLength(1));
  act(() => {
    hook.result.current.setTab('info');
    hook.result.current.select(second);
  });
  await waitFor(() => expect(hook.result.current.details?.serial).toBe('two'));
  act(() => hook.result.current.select(first));
  await waitFor(() => expect(hook.result.current.details?.serial).toBe('one'));
  act(() => hook.result.current.setTab('files'));
  await waitFor(() => expect(hook.result.current.files[0]?.name).toBe('one.txt'));
});
it('断连撤销所有者授权，重连要求重新选择传输会话', async () => {
  const hook = await ready();
  act(() => {
    hook.result.current.setOwnerCheck({ canSet: true, alreadySet: false, summary: 'ok' });
    hook.result.current.setConsent(true);
  });
  snapshot.devices = [{ ...first, transportId: '99' }];
  await act(async () => {
    await hook.result.current.refresh();
  });
  expect(hook.result.current.device).toBeUndefined();
  expect(hook.result.current.consent).toBe(false);
  expect(hook.result.current.ownerCheck).toBeUndefined();
  expect(hook.result.current.selected).toBe(targetKey(first));
});
it('跨页和换设备保留已选安装包', async () => {
  const hook = await ready();
  await act(async () => {
    await hook.result.current.chooseApk();
  });
  act(() => {
    hook.result.current.setTab('info');
    hook.result.current.select(second);
  });
  await waitFor(() => expect(hook.result.current.details?.serial).toBe('two'));
  expect(hook.result.current.apk?.fileName).toBe('test.apk');
});
