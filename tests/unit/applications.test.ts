// @vitest-environment jsdom
import { defineComponent, effectScope, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWorkbench } from '@/app/workbench';
import ApplicationsPage from '@/features/apps/ApplicationsPage.vue';
import InstallDialog from '@/features/apps/install/InstallDialog.vue';
import type { Api, AppDetails, InstalledApp, Snapshot } from '@/shared/api/types';
import { setLanguage } from '@/shared/i18n/index';

const first = { serial: 'one', transportId: '1', state: 'device', model: '第一台' };
const second = { serial: 'two', transportId: '2', state: 'device', model: '第二台' };
const app: InstalledApp = {
  packageName: 'com.example.notes',
  label: '随手笔记 Notes',
  apkPath: '/data/app/base.apk',
  system: false,
  enabled: true,
  version: { name: '2.0', code: '42' },
  apkSize: 2048,
  launchComponent: 'com.example.notes/.Main',
};
const system: InstalledApp = {
  ...app,
  packageName: 'com.android.settings',
  label: '设置',
  system: true,
  enabled: false,
};
const details: AppDetails = {
  ...app,
  versionName: '2.0',
  versionCode: '42',
  minimumSdk: '23',
  targetSdk: '35',
  uid: '10123',
  firstInstallTime: '2026-10-01 00:00:00',
  lastUpdateTime: '',
  installer: '',
};
const cleanup: (() => void)[] = [];
beforeEach(() => {
  setLanguage('zh-CN');
  localStorage.removeItem('adm.apps-column-widths.v2');
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((f) => f());
  document.body.innerHTML = '';
  localStorage.removeItem('adm.apps-column-widths.v2');
  vi.unstubAllGlobals();
});
async function setup() {
  const snapshot: Snapshot = {
    devices: [first, second],
    settings: {
      language: 'zh-CN',
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
  const api = {
    refresh: vi.fn(async () => structuredClone(snapshot)),
    details: vi.fn(async (d) => ({ serial: d.serial })),
    listApps: vi.fn(async () => [app, system]),
    appDetails: vi.fn(async () => ({ ...details })),
    uninstallApp: vi.fn(async () => {}),
    appRunning: vi.fn(async () => [app.packageName]),
    appIcons: vi.fn(async () => ({})),
    appAction: vi.fn(async () => {}),
    copyPackage: vi.fn(async () => {}),
    chooseApk: vi.fn(async () => ({
      id: 'apk',
      fileName: 'test.apk',
      packageName: app.packageName,
      size: 1234,
      versionName: '2.0',
      versionCode: '42',
      minimumSdk: '23',
      admins: [],
    })),
    dropApk: vi.fn(async () => ({
      id: 'apk',
      fileName: 'drop.apk',
      packageName: app.packageName,
      size: 1234,
      versionName: '2.0',
      versionCode: '42',
      minimumSdk: '23',
      admins: [],
    })),
    install: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
  } as unknown as Api;
  const scope = effectScope();
  cleanup.push(() => scope.stop());
  const w = scope.run(() => createWorkbench(api))!;
  await w.devices.refresh();
  await flushPromises();
  w.workspace.state.tab = 'apps';
  await flushPromises();
  const view = mount(
    defineComponent({
      components: { ApplicationsPage, InstallDialog },
      setup: () => ({ s: w.workspace.state }),
      template: '<ApplicationsPage /><InstallDialog v-if="s.modal === \'install\'" />',
    }),
    {
      attachTo: document.body,
      global: { provide: w.providers },
    },
  );
  cleanup.push(() => view.unmount());
  await flushPromises();
  return { w, view, api, snapshot };
}
it('名称优先显示，支持中文名称及包名搜索，系统应用可选显示', async () => {
  const { view, w } = await setup();
  expect(view.findAll('tbody tr')).toHaveLength(1);
  expect(view.get('.app-name').text()).toBe('随手笔记 Notes');
  expect(view.find('.app-identifier').exists()).toBe(false);
  expect(view.get('.app-identity').attributes('title')).toContain(app.packageName);
  expect(view.get('tbody tr').text()).toContain('运行中');
  expect(view.get('tbody tr').text()).toContain('2.0');
  expect(view.get('tbody tr').text()).toContain('2.0 KiB');
  await view.get('input[type="search"]').setValue('笔记');
  expect(view.findAll('tbody tr')).toHaveLength(1);
  await view.get('input[type="search"]').setValue('NOTES');
  expect(view.findAll('tbody tr')).toHaveLength(1);
  await view.get('input[type="search"]').setValue('EXAMPLE.NOTES');
  expect(view.findAll('tbody tr')).toHaveLength(1);
  await view.get('input[type="search"]').setValue('settings');
  expect(view.text()).toContain('没有匹配的应用');
  await view.get('#show-system-apps').trigger('click');
  expect(view.findAll('tbody tr')).toHaveLength(1);
  expect(view.get('tbody').text()).toContain('已禁用');
  w.apps.state.appQuery = '';
  await nextTick();
  expect(view.findAll('tbody tr')).toHaveLength(2);
});
it('信息页和卸载确认分开，取消不执行卸载，确认携带原设备和版本', async () => {
  const { view, api, w } = await setup();
  await view.get('tbody tr').trigger('dblclick');
  await flushPromises();
  expect(document.body.textContent).toContain('2.0');
  const click = async (text: string) => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
    button.click();
    await flushPromises();
  };
  await click('卸载应用');
  expect(document.body.textContent).toContain('无法撤销');
  expect(document.querySelector('.app-uninstall-package')?.textContent).toBe(app.label);
  expect(document.querySelector('.app-details-body')?.textContent).toContain(app.packageName);
  expect(api.uninstallApp).not.toHaveBeenCalled();
  await click('取消');
  expect(w.workspace.state.modal).toBe('app-details');
  await click('卸载应用');
  vi.mocked(api.listApps).mockResolvedValue([system]);
  await click('确认卸载');
  expect(api.uninstallApp).toHaveBeenCalledExactlyOnceWith(first, app.packageName, '42', true);
  expect(w.workspace.state.modal).toBeNull();
  expect(w.apps.state.apps).toEqual([system]);
  expect(w.workspace.state.notice?.error).toBeUndefined();
});
it('同名应用仍按包名区分，名称缺失时保留可搜索的包名', async () => {
  const { view, w, api } = await setup();
  const other = { ...app, packageName: 'com.example.other' };
  w.apps.state.apps = [app, other, { ...app, packageName: 'com.example.unnamed', label: null }];
  await nextTick();
  expect(view.findAll('.app-name').map((n) => n.text())).toEqual([
    '随手笔记 Notes',
    '随手笔记 Notes',
    'com.example.unnamed',
  ]);
  await view.findAll('tbody tr')[1].trigger('dblclick');
  await flushPromises();
  expect(api.appDetails).toHaveBeenCalledWith(first, other.packageName);
  w.workspace.state.modal = null;
  await view.get('input[type="search"]').setValue('unnamed');
  expect(view.findAll('tbody tr')).toHaveLength(1);
  expect(view.get('.app-name').text()).toBe('com.example.unnamed');
});
it('卸载失败保留详情、错误和列表，不误报成功', async () => {
  const { api, w } = await setup();
  await w.apps.openApp(app);
  w.workspace.state.modal = 'app-uninstall';
  vi.mocked(api.uninstallApp).mockRejectedValue(new Error('设备策略拒绝卸载'));
  await w.apps.uninstallApp();
  expect(w.apps.state.application?.error).toBe('设备策略拒绝卸载');
  expect(w.apps.state.apps).toHaveLength(2);
  expect(w.workspace.state.modal).toBe('app-uninstall');
  expect(w.workspace.state.busy).toBe('');
});
it('断连关闭旧确认，重新连接不能复用原设备的数据或卸载目标', async () => {
  const { api, w, snapshot } = await setup();
  await w.apps.openApp(app);
  w.workspace.state.modal = 'app-uninstall';
  snapshot.devices = [{ ...first, transportId: '99' }, second];
  await w.devices.refresh();
  await flushPromises();
  expect(w.apps.state.apps).toEqual([]);
  expect(w.apps.state.application).toBeUndefined();
  await w.apps.uninstallApp();
  expect(api.uninstallApp).not.toHaveBeenCalled();
  w.devices.select(second);
  await flushPromises();
  expect(api.listApps).toHaveBeenLastCalledWith(second);
});
it('迟到的应用列表不会污染其他设备，读取失败可手动重试且不自动循环', async () => {
  const { api, w, snapshot } = await setup();
  let finish!: (apps: InstalledApp[]) => void;
  vi.mocked(api.listApps).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = w.apps.loadApps();
  snapshot.devices = [second];
  await w.devices.refresh();
  finish([app]);
  await pending;
  expect(w.apps.state.apps).toEqual([]);
  vi.mocked(api.listApps).mockRejectedValue(new Error('offline'));
  w.devices.select(second);
  await flushPromises();
  const count = vi.mocked(api.listApps).mock.calls.length;
  await flushPromises();
  expect(api.listApps).toHaveBeenCalledTimes(count);
  expect(w.apps.state.appsLoaded).toBe(false);
  vi.mocked(api.listApps).mockResolvedValue([system]);
  await w.apps.loadApps();
  expect(w.apps.state.appsLoaded).toBe(true);
});
it('安装入口打开弹窗，取消不安装且保留列表搜索，关闭后恢复按钮焦点', async () => {
  const { w, view, api } = await setup();
  w.apps.state.appQuery = '笔记';
  const button = view.findAll('button').find((b) => b.text() === '安装应用')!;
  (button.element as HTMLButtonElement).focus();
  await button.trigger('click');
  await flushPromises();
  expect(w.workspace.state.modal).toBe('install');
  expect(document.querySelector('.install-dialog')).not.toBeNull();
  expect(view.find('[role="tablist"]').exists()).toBe(false);
  expect(document.querySelector('.install-dialog')?.textContent).toContain('目标：第一台');
  expect(
    [...document.querySelectorAll<HTMLButtonElement>('.install-dialog button')].find(
      (b) => b.textContent?.trim() === '安装到此设备',
    )?.disabled,
  ).toBe(true);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flushPromises();
  expect(w.workspace.state.modal).toBeNull();
  expect(api.install).not.toHaveBeenCalled();
  expect(w.apps.state.appQuery).toBe('笔记');
  await vi.waitFor(() => expect(document.activeElement).toBe(button.element));
});
it('选择或拖入 APK 打开安装弹窗，弹窗内可更换，其他弹窗阻止拖入', async () => {
  const { w, api } = await setup();
  await w.install.chooseApk();
  expect(w.workspace.state.modal).toBe('install');
  w.install.dragEnter();
  expect(w.install.state.dragging).toBe(true);
  await w.install.drop(['/tmp/drop.apk']);
  expect(w.install.state.apk?.fileName).toBe('drop.apk');
  expect(w.install.state.dragging).toBe(false);
  w.install.closeInstall();
  w.workspace.state.tab = 'info';
  w.install.dragEnter();
  expect(w.workspace.state.tab).toBe('info');
  expect(w.workspace.state.modal).toBeNull();
  await w.install.drop(['/tmp/drop.apk']);
  expect(w.workspace.state.tab).toBe('apps');
  expect(w.workspace.state.modal).toBe('install');
  w.install.closeInstall();
  w.workspace.state.modal = 'settings';
  await w.install.drop(['/tmp/blocked.apk']);
  expect(api.dropApk).toHaveBeenCalledTimes(2);
  expect(w.workspace.state.modal).toBe('settings');
});
it('安装时不能关闭弹窗，可停止等待；失败保留安装包，重试成功关闭并刷新列表', async () => {
  const { w, api } = await setup();
  await w.install.chooseApk();
  let fail!: (error: Error) => void;
  vi.mocked(api.install).mockImplementationOnce(
    () =>
      new Promise<void>((_, reject) => {
        fail = reject;
      }),
  );
  vi.mocked(api.cancel).mockImplementation(async () => {
    fail(new Error('已停止等待，请刷新核对结果。'));
  });
  const pending = w.install.install();
  await flushPromises();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  w.install.closeInstall();
  expect(w.workspace.state.modal).toBe('install');
  expect(document.querySelector<HTMLButtonElement>('[aria-label="关闭对话框"]')?.disabled).toBe(true);
  [...document.querySelectorAll<HTMLButtonElement>('.install-dialog button')]
    .find((b) => b.textContent?.trim() === '停止等待')!
    .click();
  await pending;
  await flushPromises();
  expect(document.querySelector('.install-feedback[role="alert"]')?.textContent).toContain('已停止等待');
  expect(w.workspace.state.modal).toBe('install');
  expect(w.install.state.apk?.fileName).toBe('test.apk');
  const before = vi.mocked(api.listApps).mock.calls.length;
  await w.install.install();
  await flushPromises();
  expect(w.workspace.state.modal).toBeNull();
  expect(api.install).toHaveBeenLastCalledWith(first, 'apk', false);
  expect(api.listApps).toHaveBeenCalledTimes(before + 1);
  expect(w.apps.state.appsLoaded).toBe(true);
  expect(w.workspace.state.notice?.text).toContain('安装成功');
});
it('安装已成功但列表读取失败时不误报安装失败或重复安装', async () => {
  const { w, api } = await setup();
  await w.install.chooseApk();
  vi.mocked(api.listApps).mockRejectedValue(new Error('offline'));
  await w.install.install();
  await flushPromises();
  expect(w.workspace.state.modal).toBeNull();
  expect(w.apps.state.appsLoaded).toBe(false);
  expect(w.workspace.state.notice?.text).toContain('应用已安装，但列表刷新失败');
  expect(api.install).toHaveBeenCalledTimes(1);
});
it('安装过程中断线关闭旧弹窗，迟到结果不进入另一会话的所有者配置', async () => {
  const { w, api, snapshot } = await setup();
  await w.install.chooseApk();
  w.owner.state.ownerAfter = true;
  let finish!: () => void;
  vi.mocked(api.install).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const pending = w.install.install();
  snapshot.devices = [{ ...first, transportId: '99' }, second];
  await w.devices.refresh();
  expect(w.workspace.state.modal).toBeNull();
  finish();
  await pending;
  expect(w.workspace.state.tab).toBe('apps');
  expect(w.owner.state.ownerExpanded).toBe(false);
  expect(w.owner.state.consent).toBe(false);
  expect(w.apps.state.apps).toEqual([]);
});

it('应用列宽可拖动、复位并持久保存，表头独立滚动且详情入口可用', async () => {
  const { view, api } = await setup();
  const handles = view.findAll('.table-column-resizer');
  expect(handles).toHaveLength(4);
  const name = handles[0];
  await name.trigger('mousedown', { button: 0, clientX: 300 });
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: 540 }));
  window.dispatchEvent(new MouseEvent('mouseup'));
  await nextTick();
  expect(name.attributes('aria-valuenow')).toBe('480');
  expect(view.get('.resizable-table-head col').attributes('style')).toBe(
    view.get('#installed-apps-table col').attributes('style'),
  );
  const body = view.get<HTMLElement>('.apps-scroll');
  const header = view.get<HTMLElement>('.table-header-viewport');
  expect(body.element.contains(header.element)).toBe(false);
  body.element.scrollLeft = 120;
  body.element.scrollTop = 300;
  await body.trigger('scroll');
  expect(header.element.scrollLeft).toBe(120);
  expect(header.element.scrollTop).toBe(0);
  header.element.scrollLeft = 60;
  await header.trigger('scroll');
  expect(body.element.scrollLeft).toBe(60);
  expect(body.element.scrollTop).toBe(300);
  const restored = (await setup()).view;
  expect(restored.findAll('.table-column-resizer')[0].attributes('aria-valuenow')).toBe('480');
  await handles[1].trigger('mousedown', { button: 0, clientX: 600 });
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: -100 }));
  window.dispatchEvent(new MouseEvent('mouseup'));
  await nextTick();
  expect(handles[1].attributes('aria-valuenow')).toBe('70');
  await handles[1].trigger('dblclick');
  expect(handles[1].attributes('aria-valuenow')).toBe('90');
  await handles[2].trigger('keydown', { key: 'ArrowRight' });
  expect(handles[2].attributes('aria-valuenow')).toBe('110');
  await handles[2].trigger('keydown', { key: 'Home' });
  expect(handles[2].attributes('aria-valuenow')).toBe('100');
  await view.get('tbody tr').trigger('dblclick');
  await flushPromises();
  expect(api.appDetails).toHaveBeenCalledWith(first, app.packageName);
});

it('单击整行选择不打开弹窗，方向键切换选中，回车查看详情', async () => {
  const { view, w, api } = await setup();
  w.apps.state.apps = [app, { ...app, packageName: 'com.example.second', label: null }];
  await nextTick();
  const rows = view.findAll('tbody tr');
  await rows[0].get('td:nth-child(3)').trigger('click');
  expect(rows[0].attributes('aria-selected')).toBe('true');
  expect(rows[0].classes()).toContain('selected');
  expect(w.workspace.state.modal).toBeNull();
  expect(api.appDetails).not.toHaveBeenCalled();
  await rows[0].trigger('keydown', { key: 'ArrowDown' });
  expect(rows[1].attributes('aria-selected')).toBe('true');
  expect(view.text()).not.toContain('名称不可用');
  await rows[1].trigger('keydown', { key: 'Enter' });
  await flushPromises();
  expect(api.appDetails).toHaveBeenCalledWith(first, 'com.example.second');
});
it('更多菜单与右键提供相同操作，清除数据需确认且取消不会调用后端', async () => {
  const { view, api, w } = await setup();
  await view.get('tbody tr').trigger('contextmenu', { button: 2, clientX: 100, clientY: 100 });
  await flushPromises();
  const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  expect(items.map((n) => n.textContent?.trim())).toEqual([
    '应用信息',
    '打开应用',
    '复制包名',
    '强制停止应用',
    '清除应用数据',
    '卸载应用',
  ]);
  items.find((n) => n.textContent?.includes('清除应用数据'))!.click();
  await flushPromises();
  expect(w.workspace.state.modal).toBe('app-confirm');
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('无法撤销');
  expect(api.appAction).not.toHaveBeenCalled();
  [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
    .find((n) => n.textContent === '取消')!
    .click();
  await flushPromises();
  expect(w.workspace.state.modal).toBeNull();
  expect(api.appAction).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(document.activeElement).toBe(view.get('tbody tr').element));
  await w.apps.openApp(app, 'clear-data');
  await w.apps.confirmAppAction();
  expect(api.appAction).toHaveBeenCalledExactlyOnceWith(first, app.packageName, '42', 'clear-data', true);
  expect(w.workspace.state.notice?.text).toBe('应用数据已清除。');
});
it('操作失败保留确认和错误，断连撤销确认，打开应用后触发运行状态刷新', async () => {
  const { w, api, snapshot } = await setup();
  await w.apps.launchApp(app);
  expect(api.appAction).toHaveBeenCalledWith(first, app.packageName, '42', 'launch', false);
  expect(w.apps.state.appStateEpoch).toBe(1);
  await w.apps.openApp(app, 'force-stop');
  vi.mocked(api.appAction).mockRejectedValueOnce(new Error('设备策略拒绝操作'));
  await w.apps.confirmAppAction();
  expect(w.workspace.state.modal).toBe('app-confirm');
  expect(w.apps.state.application?.error).toContain('设备策略');
  snapshot.devices = [{ ...first, transportId: '99' }, second];
  await w.devices.refresh();
  expect(w.workspace.state.modal).toBeNull();
  const calls = vi.mocked(api.appAction).mock.calls.length;
  await w.apps.confirmAppAction();
  expect(api.appAction).toHaveBeenCalledTimes(calls);
});
