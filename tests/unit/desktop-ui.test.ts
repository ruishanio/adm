// @vitest-environment jsdom
import { effectScope, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { language, locale, setLanguage } from '@/shared/i18n/index';
import DeviceInfoPage from '@/features/devices/DeviceInfoPage.vue';
import ConnectionDialog from '@/features/devices/ConnectionDialog.vue';
import SidebarDivider from '@/app/layout/SidebarDivider.vue';
import Sidebar from '@/features/devices/Sidebar.vue';
import SettingsDialog from '@/features/settings/SettingsDialog.vue';
import FilesPage from '@/features/files/FilesPage.vue';
import { createWorkbench } from '@/app/workbench';
import { useFocusMode } from '@/shared/composables/focus-mode';
import type { Api } from '@/shared/api/types';
const cleanups: (() => void)[] = [];
beforeEach(() => {
  setLanguage('zh-CN');
  localStorage.removeItem('adm.files-column-widths');
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((fn) => fn());
  document.body.innerHTML = '';
  localStorage.removeItem('adm.files-column-widths');
  vi.unstubAllGlobals();
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
    sidebarWidth: vi.fn(async () => {}),
    language: vi.fn(async () => {}),
    listFiles: vi.fn(async () => []),
  } as unknown as Api;
  const w = scope.run(() => {
    useFocusMode();
    return createWorkbench(api);
  })!;
  w.devices.state.snapshot = {
    devices: [{ serial: 'test', transportId: '1', state: 'device', model: 'Test' }],
    settings: { adbPath: '', endpoint: 'host:5555', deviceNames: {}, hiddenDevices: [], sidebarWidth: 248 },
    adbPath: '/adb',
    platform: 'darwin',
    version: '0.1.0',
  };
  w.workspace.state.selected = 'test@1';
  return w;
}
it('组件到达后展开配置，检查通过并勾选后才可设置', async () => {
  const w = setup();
  const view = mount(DeviceInfoPage, {
    global: { provide: w.providers },
    attachTo: document.body,
  });
  cleanups.push(() => view.unmount());
  await flushPromises();
  expect(view.get('#owner-configuration').attributes('hidden')).toBeDefined();
  w.owner.state.component = 'com.test/.Admin';
  await nextTick();
  expect(view.get('#owner-configuration').attributes('hidden')).toBeUndefined();
  const action = () => view.findAll('button').find((b) => b.text() === '设置设备所有者')!;
  expect(action().attributes('disabled')).toBeDefined();
  w.owner.state.ownerCheck = { canSet: true, alreadySet: false, summary: '检查通过' };
  await nextTick();
  expect(action().attributes('disabled')).toBeDefined();
  await view.get('[role="checkbox"]').trigger('click');
  expect(w.owner.state.consent).toBe(true);
  expect(action().attributes('disabled')).toBeUndefined();
});

it('鼠标选择设备保留焦点但隐藏焦点框，键盘操作恢复提示，F2 不打开备注编辑', async () => {
  const w = setup();
  const view = mount(Sidebar, {
    global: { provide: w.providers },
    attachTo: document.body,
  });
  cleanups.push(() => view.unmount());
  await flushPromises();
  const row = view.get('.device-row');
  await row.trigger('pointerdown');
  await row.trigger('click');
  expect(document.activeElement).toBe(row.element);
  expect(document.documentElement.dataset.focusMode).toBe('pointer');
  await row.trigger('keydown', { key: 'ArrowDown' });
  expect(document.documentElement.dataset.focusMode).toBe('keyboard');
  await row.trigger('keydown', { key: 'F2' });
  expect(w.workspace.state.modal).toBeNull();
  expect(view.text()).not.toContain('F2');
});

it('分栏按拖动位移调整，保持两侧最小宽度，释放后保存并停止追踪', async () => {
  const w = setup();
  w.workspace.state.viewport = 1100;
  const view = mount(SidebarDivider, {
    global: { provide: w.providers },
    attachTo: document.body,
  });
  cleanups.push(() => view.unmount());
  const divider = view.get('[role="separator"]');
  // 从边界附近的扩展命中区开始，不应因初始坐标偏差导致跳动。
  await divider.trigger('pointerdown');
  await divider.trigger('mousedown', { button: 0, clientX: 252 });
  expect(document.activeElement).toBe(divider.element);
  expect(document.documentElement.dataset.focusMode).toBe('pointer');
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: 252 }));
  expect(w.workspace.sidebar.value).toBe(248);
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: 304 }));
  expect(w.workspace.sidebar.value).toBe(300);
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: 0 }));
  expect(w.workspace.sidebar.value).toBe(220);
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: 900 }));
  expect(w.workspace.sidebar.value).toBe(459);
  window.dispatchEvent(new MouseEvent('mouseup'));
  expect(w.workspace.api.sidebarWidth).toHaveBeenLastCalledWith(459);
  expect(document.body.style.cursor).toBe('');
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }));
  expect(w.workspace.sidebar.value).toBe(459);
  await divider.trigger('keydown', { key: 'ArrowLeft' });
  expect(document.documentElement.dataset.focusMode).toBe('keyboard');
  expect(w.workspace.api.sidebarWidth).toHaveBeenLastCalledWith(449);
  await divider.trigger('keydown', { key: 'Home' });
  expect(w.workspace.api.sidebarWidth).toHaveBeenLastCalledWith(248);
});
it('连接方式方向键切换，配对与连接地址分开保存', async () => {
  const w = setup();
  const view = mount(ConnectionDialog, {
    global: { provide: w.providers },
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
  expect(w.workspace.api.pair).toHaveBeenCalledWith('host:37000', '123456');
  expect(document.querySelector<HTMLInputElement>('input')?.value).toBe('host:5555');
  expect(document.body.textContent).toContain('配对成功');
});
it('忙碌时 Escape 不能关闭连接对话框', async () => {
  const w = setup();
  w.workspace.state.modal = 'connect';
  const view = mount(ConnectionDialog, {
    global: { provide: w.providers },
    attachTo: document.body,
  });
  cleanups.push(() => view.unmount());
  await flushPromises();
  w.workspace.state.busy = '正在连接设备';
  await nextTick();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flushPromises();
  expect(w.workspace.state.modal).toBe('connect');
});

it('关闭弹窗后焦点返回触发按钮', async () => {
  const trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  const w = setup();
  const view = mount(ConnectionDialog, {
    global: { provide: w.providers },
    attachTo: document.body,
  });
  await flushPromises();
  expect(document.activeElement).not.toBe(trigger);
  view.unmount();
  await flushPromises();
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
});

it('设置语言先保存再即时切换，保存失败保持原偏好', async () => {
  const w = setup();
  const view = mount(SettingsDialog, {
    global: { provide: w.providers },
    attachTo: document.body,
  });
  cleanups.push(() => view.unmount());
  await flushPromises();
  const select = document.querySelector<HTMLElement>('#language-preference')!;
  async function chooseLanguage(label: string) {
    select.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await flushPromises();
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options.map((option) => option.textContent)).toEqual(['简体中文', 'English']);
    options
      .find((option) => option.textContent === label)!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flushPromises();
  }
  await chooseLanguage('English');
  await flushPromises();
  expect(w.workspace.api.language).toHaveBeenCalledWith('en');
  expect(language.value).toBe('en');
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('General');
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('通用');
  vi.mocked(w.workspace.api.language).mockRejectedValueOnce(new Error('disk full'));
  await chooseLanguage('简体中文');
  expect(locale.value).toBe('en');
  expect(select.textContent).toBe('English');
  expect(w.workspace.state.notice?.text).toBe('disk full');
});

it('路径导航可点击返回父级，直接编辑失败保留输入以便修正', async () => {
  const w = setup();
  await flushPromises();
  w.files.state.path = '/sdcard/Download';
  const view = mount(FilesPage, {
    global: { provide: w.providers },
    attachTo: document.body,
  });
  cleanups.push(() => view.unmount());
  await flushPromises();
  const shared = view.findAll('.file-breadcrumbs button').find((b) => b.text() === '共享存储')!;
  await shared.trigger('click');
  await flushPromises();
  expect(w.files.state.path).toBe('/sdcard');
  await view.get('[aria-label="编辑路径"]').trigger('click');
  await view.get('input').setValue('/missing');
  vi.mocked(w.workspace.api.listFiles).mockRejectedValueOnce(new Error('not found'));
  await view.get('form').trigger('submit');
  await flushPromises();
  expect(w.files.state.path).toBe('/sdcard');
  expect(view.get('input').element.value).toBe('/missing');
  await view.get('input').trigger('keydown', { key: 'Escape' });
  expect(view.find('input').exists()).toBe(false);
  expect(view.text()).toContain('共享存储');
});

async function fileSetup() {
  const w = setup();
  await flushPromises();
  w.workspace.api.renameFile = vi.fn(async () => {});
  w.workspace.api.deleteFile = vi.fn(async () => {});
  w.workspace.api.upload = vi.fn(async () => true);
  w.files.state.files = [{ name: 'folder', path: '/sdcard/folder', type: 'directory', size: 0, modified: 1 }];
  const view = mount(FilesPage, {
    global: { provide: w.providers },
    attachTo: document.body,
  });
  cleanups.push(() => view.unmount());
  await flushPromises();
  return { w, view };
}
async function selectFileMenu(view: ReturnType<typeof mount>, text: string) {
  await view.get('tbody tr').trigger('contextmenu', { button: 2, clientX: 100, clientY: 100 });
  await flushPromises();
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((e) =>
    e.textContent?.includes(text),
  )!;
  item.click();
  await flushPromises();
}
it('文件右键重命名保留原会话，冲突在弹窗中显示并允许修正', async () => {
  const { w, view } = await fileSetup();
  await selectFileMenu(view, '重命名');
  expect(w.workspace.state.modal).toBe('file-rename');
  vi.mocked(w.workspace.api.renameFile).mockRejectedValueOnce(new Error('同名文件已存在'));
  const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
  input.value = 'renamed';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await flushPromises();
  const form = document.querySelector('[role="dialog"] form')!;
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flushPromises();
  expect(w.workspace.api.renameFile).toHaveBeenCalledWith(
    expect.objectContaining({ serial: 'test', transportId: '1' }),
    '/sdcard',
    'folder',
    'renamed',
  );
  expect(w.workspace.state.modal).toBe('file-rename');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('同名');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flushPromises();
  expect(w.workspace.state.modal).toBeNull();
});
it('文件删除必须确认，取消不调用后端，确认后刷新目录', async () => {
  const { w, view } = await fileSetup();
  await selectFileMenu(view, '删除');
  expect(w.workspace.api.deleteFile).not.toHaveBeenCalled();
  const cancel = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (e) => e.textContent === '取消',
  )!;
  cancel.click();
  await flushPromises();
  expect(w.workspace.state.modal).toBeNull();
  expect(w.workspace.api.deleteFile).not.toHaveBeenCalled();
  await selectFileMenu(view, '删除');
  document
    .querySelector('[role="dialog"] form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flushPromises();
  expect(w.workspace.api.deleteFile).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ serial: 'test', transportId: '1' }),
    '/sdcard',
    'folder',
    true,
  );
  expect(w.workspace.api.listFiles).toHaveBeenCalled();
  expect(w.workspace.state.modal).toBeNull();
});
it('上传菜单区分文件和文件夹，部分失败仍刷新列表并保留错误', async () => {
  const { w, view } = await fileSetup();
  vi.mocked(w.workspace.api.upload).mockRejectedValueOnce(new Error('已上传 1 项；同名冲突'));
  const trigger = view.findAll('button').find((b) => b.text() === '上传')!;
  await trigger.trigger('keydown', { key: 'Enter' });
  await flushPromises();
  const folder = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((e) =>
    e.textContent?.includes('上传文件夹'),
  )!;
  folder.click();
  await flushPromises();
  expect(w.workspace.api.upload).toHaveBeenCalledWith(
    expect.objectContaining({ serial: 'test', transportId: '1' }),
    '/sdcard',
    'folders',
  );
  expect(w.workspace.api.listFiles).toHaveBeenCalled();
  expect(w.workspace.state.notice?.text).toContain('已上传 1 项');
});

it('概览显示常用状态，明细默认收起，刷新仍重新读取详情', async () => {
  const w = setup();
  const refresh = vi.spyOn(w.devices, 'refresh').mockResolvedValue();
  const view = mount(DeviceInfoPage, {
    global: { provide: w.providers },
  });
  cleanups.push(() => view.unmount());
  await flushPromises();
  expect(view.findAll('.device-metrics dt').map((h) => h.text())).toEqual([
    '运行内存',
    '数据分区',
    '电池电量',
    '运行时长',
  ]);
  expect(view.findAll('.disclosure-title').map((h) => h.text())).toEqual([
    '硬件与存储',
    '运行状态',
    '系统构建详情',
    '设备所有者',
  ]);
  expect(view.findAll('.info-disclosure').every((group) => group.attributes('open') === undefined)).toBe(
    true,
  );
  await view.get('.info-refresh').trigger('click');
  expect(refresh).toHaveBeenCalledWith(true);
});

it('文件列宽与应用独立保存，表头避开滚动条，切换目录仍回到顶部', async () => {
  localStorage.setItem('adm.apps-column-widths', '[800,88,76,44]');
  const { w, view } = await fileSetup();
  const handles = view.findAll('.table-column-resizer');
  expect(handles).toHaveLength(3);
  expect(handles[0].attributes('aria-valuenow')).toBe('300');
  await handles[0].trigger('mousedown', { button: 0, clientX: 300 });
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: 720 }));
  window.dispatchEvent(new MouseEvent('mouseup'));
  await nextTick();
  expect(handles[0].attributes('aria-valuenow')).toBe('720');
  expect(localStorage.getItem('adm.apps-column-widths')).toBe('[800,88,76,44]');
  expect(localStorage.getItem('adm.files-column-widths')).toBe('[720,85,160]');
  expect(view.get('.resizable-table-head col').attributes('style')).toBe(
    view.get('#device-files-table col').attributes('style'),
  );
  const body = view.get<HTMLElement>('.file-scroll');
  const header = view.get<HTMLElement>('.table-header-viewport');
  expect(body.element.contains(header.element)).toBe(false);
  body.element.scrollTop = 400;
  body.element.scrollLeft = 180;
  await body.trigger('scroll');
  expect(header.element.scrollLeft).toBe(180);
  expect(header.element.scrollTop).toBe(0);
  await view.get('tbody tr').trigger('click');
  expect(w.files.state.file?.name).toBe('folder');
  await view.get('tbody tr').trigger('dblclick');
  await flushPromises();
  expect(w.files.state.path).toBe('/sdcard/folder');
  expect(body.element.scrollTop).toBe(0);
  expect(handles[0].attributes('aria-valuenow')).toBe('720');
  const restored = (await fileSetup()).view;
  expect(restored.findAll('.table-column-resizer')[0].attributes('aria-valuenow')).toBe('720');
  localStorage.removeItem('adm.apps-column-widths');
});
