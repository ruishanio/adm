// @vitest-environment jsdom
import { effectScope, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import DeviceInfoPage from '../../src/renderer/components/DeviceInfoPage.vue';
import ConnectionDialog from '../../src/renderer/components/ConnectionDialog.vue';
import { createWorkbench, workbenchKey } from '../../src/renderer/composables/workbench';
import type { Api } from '../../src/shared/contracts';
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((fn) => fn());
  document.body.innerHTML = '';
});
function setup() {
  const scope = effectScope();
  cleanups.push(() => scope.stop());
  const api = {
    details: vi.fn(async () => ({
      manufacturer: 'Test',
      model: 'Test',
      android: '10',
      api: '29',
      patch: '',
      architecture: 'arm64',
      serial: 'test',
      owner: null,
    })),
    pair: vi.fn(async () => {}),
    connect: vi.fn(async () => {}),
  } as unknown as Api;
  const w = scope.run(() => createWorkbench(api))!;
  w.state.snapshot = {
    devices: [{ serial: 'test', transportId: '1', state: 'device', model: 'Test' }],
    settings: { adbPath: '', endpoint: 'host:5555', deviceNames: {}, hiddenDevices: [], sidebarWidth: 248 },
    adbPath: '/adb',
    platform: 'darwin',
    version: '1.0.0',
  };
  w.state.selected = 'test@1';
  return w;
}
it('组件到达后展开配置，检查通过并勾选后才可设置', async () => {
  const w = setup();
  const view = mount(DeviceInfoPage, {
    global: { provide: { [workbenchKey as symbol]: w } },
    attachTo: document.body,
  });
  cleanups.push(() => view.unmount());
  await flushPromises();
  expect(view.get('#owner-configuration').attributes('hidden')).toBeDefined();
  w.state.component = 'com.test/.Admin';
  await nextTick();
  expect(view.get('#owner-configuration').attributes('hidden')).toBeUndefined();
  const action = () => view.findAll('button').find((b) => b.text() === '设置设备所有者')!;
  expect(action().attributes('disabled')).toBeDefined();
  w.state.ownerCheck = { canSet: true, alreadySet: false, summary: '检查通过' };
  await nextTick();
  expect(action().attributes('disabled')).toBeDefined();
  await view.get('[role="checkbox"]').trigger('click');
  expect(w.state.consent).toBe(true);
  expect(action().attributes('disabled')).toBeUndefined();
});
it('连接方式方向键切换，配对与连接地址分开保存', async () => {
  const w = setup();
  const view = mount(ConnectionDialog, {
    global: { provide: { [workbenchKey as symbol]: w } },
    attachTo: document.body,
  });
  cleanups.push(() => view.unmount());
  await flushPromises();
  const network =
    document.querySelector<HTMLButtonElement>('[role="tab"][value="network"]') ??
    [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((e) =>
      e.textContent?.includes('网络连接'),
    )!;
  network.focus();
  network.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await flushPromises();
  await vi.waitFor(() =>
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('无线配对'),
  );
  const inputs = document.querySelectorAll<HTMLInputElement>('input');
  inputs[0].value = 'host:37000';
  inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
  inputs[1].value = '123456';
  inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flushPromises();
  expect(w.api.pair).toHaveBeenCalledWith('host:37000', '123456');
  expect(document.querySelector<HTMLInputElement>('input')?.value).toBe('host:5555');
  expect(document.body.textContent).toContain('配对成功');
});
it('忙碌时 Escape 不能关闭连接对话框', async () => {
  const w = setup();
  w.state.modal = 'connect';
  const view = mount(ConnectionDialog, {
    global: { provide: { [workbenchKey as symbol]: w } },
    attachTo: document.body,
  });
  cleanups.push(() => view.unmount());
  await flushPromises();
  w.state.busy = '正在连接设备';
  await nextTick();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flushPromises();
  expect(w.state.modal).toBe('connect');
});

it('关闭弹窗后焦点返回触发按钮', async () => {
  const trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  const w = setup();
  const view = mount(ConnectionDialog, {
    global: { provide: { [workbenchKey as symbol]: w } },
    attachTo: document.body,
  });
  await flushPromises();
  expect(document.activeElement).not.toBe(trigger);
  view.unmount();
  await flushPromises();
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
});
