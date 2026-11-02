// @vitest-environment jsdom
import { computed, defineComponent, nextTick, reactive } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAppResources } from '../../src/renderer/features/apps/resources';
import type { Workbench } from '../../src/renderer/composables/workbench';
import type { InstalledApp } from '../../src/shared/contracts';
const cleanup: (() => void)[] = [];
let hidden = false;
beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
});
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn());
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const app = (i = 0): InstalledApp => ({
  packageName: `com.example.app${i}`,
  label: null,
  apkPath: '/data/app/base.apk',
  system: false,
  enabled: true,
  version: { name: '1.0', code: '1' },
});
function setup() {
  const state = reactive({
    selected: 'one@1',
    tab: 'apps',
    busy: '',
    appsLoaded: true,
    appStateEpoch: 0,
    apps: [app()],
  });
  const api = {
    appRunning: vi.fn(async () => ['com.example.app0']),
    appIcons: vi.fn(async (_target, packages: string[]) =>
      Object.fromEntries(packages.map((p) => [p, 'data:image/png;base64,image'])),
    ),
  };
  const w = {
    state,
    api,
    online: computed(() => true),
    device: computed(() => ({
      serial: state.selected.split('@')[0],
      transportId: state.selected.split('@')[1],
    })),
  } as unknown as Workbench;
  let resources!: ReturnType<typeof useAppResources>;
  const view = mount(
    defineComponent({
      setup() {
        resources = useAppResources(w);
        return () => null;
      },
    }),
  );
  cleanup.push(() => view.unmount());
  return { state, api, resources, view };
}
it('运行状态仅在页面可见时串行刷新，操作后立即刷新，失败变为未知', async () => {
  const { state, api, resources } = setup();
  await flushPromises();
  expect(resources.running.value?.has('com.example.app0')).toBe(true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(api.appRunning).toHaveBeenCalledTimes(2);
  state.tab = 'files';
  await nextTick();
  await vi.advanceTimersByTimeAsync(10000);
  expect(api.appRunning).toHaveBeenCalledTimes(2);
  expect(resources.running.value).toBeUndefined();
  state.tab = 'apps';
  await nextTick();
  await flushPromises();
  state.busy = '操作';
  await nextTick();
  await vi.advanceTimersByTimeAsync(10000);
  expect(api.appRunning).toHaveBeenCalledTimes(3);
  state.busy = '';
  state.appStateEpoch++;
  await nextTick();
  await flushPromises();
  expect(api.appRunning).toHaveBeenCalledTimes(4);
  api.appRunning.mockRejectedValueOnce(new Error('读取失败'));
  await vi.advanceTimersByTimeAsync(5000);
  expect(resources.running.value).toBeUndefined();
  expect(resources.error.value).toBe('读取失败');
  hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  await nextTick();
  const count = api.appRunning.mock.calls.length;
  await vi.advanceTimersByTimeAsync(10000);
  expect(api.appRunning).toHaveBeenCalledTimes(count);
});
it('迟到的运行快照不进入新设备或已卸载页面', async () => {
  const { state, api, resources, view } = setup();
  await flushPromises();
  let finish!: (packages: string[]) => void;
  api.appRunning.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = resources.refreshRunning();
  state.selected = 'two@2';
  state.apps = [];
  await nextTick();
  finish(['com.example.old']);
  await pending;
  expect(resources.running.value).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expect(api.appRunning).toHaveBeenLastCalledWith({ serial: 'two', transportId: '2' });
  view.unmount();
  const count = api.appRunning.mock.calls.length;
  await vi.advanceTimersByTimeAsync(10000);
  expect(api.appRunning).toHaveBeenCalledTimes(count);
});
it('图标按可见请求分批、复用缓存，版本与设备变化后重新读取', async () => {
  const { state, api, resources } = setup();
  expect(api.appIcons).not.toHaveBeenCalled();
  for (let i = 0; i < 25; i++) resources.requestIcon(app(i));
  await vi.advanceTimersByTimeAsync(80);
  expect(api.appIcons.mock.calls.map((c) => c[1].length)).toEqual([24, 1]);
  resources.requestIcon(app());
  await vi.advanceTimersByTimeAsync(100);
  expect(api.appIcons).toHaveBeenCalledTimes(2);
  const changed = { ...app(), version: { name: '2.0', code: '2' } };
  resources.requestIcon(changed);
  await vi.advanceTimersByTimeAsync(40);
  expect(api.appIcons).toHaveBeenCalledTimes(3);
  state.selected = 'two@2';
  await nextTick();
  expect(Object.keys(resources.icons)).toHaveLength(0);
  resources.requestIcon(app());
  await vi.advanceTimersByTimeAsync(40);
  expect(api.appIcons).toHaveBeenLastCalledWith({ serial: 'two', transportId: '2' }, ['com.example.app0']);
});
it('同设备暂停期间保留在途图标，切换设备后拒绝旧图标', async () => {
  const { state, api, resources } = setup();
  let finish!: (icons: Record<string, string>) => void;
  const defer = () =>
    new Promise<Record<string, string>>((resolve) => {
      finish = resolve;
    });
  api.appIcons.mockImplementationOnce(defer);
  resources.requestIcon(app());
  await vi.advanceTimersByTimeAsync(40);
  state.busy = '读取详情';
  await nextTick();
  finish({ 'com.example.app0': 'data:image/png;base64,image' });
  await flushPromises();
  expect(resources.icons[resources.iconKey(app())]).toBe('data:image/png;base64,image');
  state.busy = '';
  await nextTick();
  api.appIcons.mockImplementationOnce(defer);
  resources.requestIcon(app(1));
  await vi.advanceTimersByTimeAsync(40);
  state.selected = 'two@2';
  await nextTick();
  finish({ 'com.example.app1': 'data:image/png;base64,old' });
  await flushPromises();
  expect(Object.keys(resources.icons)).toHaveLength(0);
});
