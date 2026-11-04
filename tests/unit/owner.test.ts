// @vitest-environment jsdom
import { effectScope, nextTick } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { createWorkbench } from '@/app/workbench';
import OwnerSection from '@/features/devices/owner/OwnerSection.vue';
import AppSelect from '@/shared/ui/AppSelect.vue';
import AppSearchSelect from '@/shared/ui/AppSearchSelect.vue';
import type { Api, OwnerRemovalCheck } from '@/shared/api/types';
import { setLanguage } from '@/shared/i18n';

const ADMIN = 'com.example.manager/com.example.manager.Admin';
const target = { serial: 'one', transportId: '1', network: false, state: 'device', model: '测试设备' };
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((fn) => fn());
  document.body.innerHTML = '';
});
async function setup(initialOwner: string | null = ADMIN, expanded = true) {
  setLanguage('zh-CN');
  let currentOwner = initialOwner;
  const api = {
    refresh: vi.fn(async () => ({
      devices: [target],
      settings: { language: 'zh-CN', deviceNames: {}, hiddenDevices: [], sidebarWidth: 248 },
      platform: 'darwin',
    })),
    details: vi.fn(async () => ({ owner: currentOwner, serial: 'one' })),
    checkOwner: vi.fn(async () => ({ canSet: true, alreadySet: false, summary: '检查通过' })),
    scanDeviceAdmins: vi.fn(async () => [
      { component: ADMIN, label: '管理助手' },
      { component: 'com.example.manager/com.example.manager.OtherAdmin', label: '管理助手' },
    ]),
    setOwner: vi.fn(async (_t, component) => {
      currentOwner = component;
    }),
    checkOwnerRemoval: vi.fn(async () => ({ canRemove: true, summary: '可以移除' })),
    removeOwner: vi.fn(async () => {
      currentOwner = null;
    }),
    cancel: vi.fn(async () => {}),
  } as unknown as Api;
  const scope = effectScope();
  cleanups.push(() => scope.stop());
  const w = scope.run(() => createWorkbench(api))!;
  cleanups.push(() => w.dispose());
  await w.devices.refresh();
  await flushPromises();
  w.owner.state.ownerExpanded = expanded;
  const view = mount(OwnerSection, { attachTo: document.body, global: { provide: w.providers } });
  cleanups.push(() => view.unmount());
  await flushPromises();
  return { api, w, view };
}
async function click(text: string) {
  await nextTick();
  const button = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === text || b.getAttribute('aria-label') === text,
  );
  expect(button).toBeDefined();
  button!.click();
  await flushPromises();
}

async function consent() {
  const checkbox = document.querySelector<HTMLElement>('[role="dialog"] [role="checkbox"]');
  expect(checkbox).not.toBeNull();
  checkbox!.click();
  await flushPromises();
}

it('展开时扫描，折叠后再展开会刷新，完成任务不会反复扫描', async () => {
  const { api, w } = await setup(null, false);
  expect(api.scanDeviceAdmins).not.toHaveBeenCalled();
  await click('设备所有者尚未设置');
  expect(api.scanDeviceAdmins).toHaveBeenCalledExactlyOnceWith(target);
  await click('设备所有者尚未设置');
  await click('设备所有者尚未设置');
  expect(api.scanDeviceAdmins).toHaveBeenCalledTimes(2);
  w.workspace.state.busy = '其他任务';
  await nextTick();
  w.workspace.state.busy = '';
  await flushPromises();
  expect(api.scanDeviceAdmins).toHaveBeenCalledTimes(2);
});

it('展开时其他任务未完成会等待，扫描失败后不自动循环重试', async () => {
  const { api, w } = await setup(null, false);
  w.workspace.state.busy = '正在读取';
  w.owner.state.ownerExpanded = true;
  await nextTick();
  expect(api.scanDeviceAdmins).not.toHaveBeenCalled();
  vi.mocked(api.scanDeviceAdmins).mockRejectedValueOnce(new Error('设备读取受限'));
  w.workspace.state.busy = '';
  await flushPromises();
  expect(api.scanDeviceAdmins).toHaveBeenCalledTimes(1);
  expect(w.owner.state.scan?.error).toBe('设备读取受限');
  await flushPromises();
  expect(api.scanDeviceAdmins).toHaveBeenCalledTimes(1);
});

it('已设置所有者时展开不扫描', async () => {
  const { api } = await setup();
  expect(api.scanDeviceAdmins).not.toHaveBeenCalled();
});

it('设置入口只打开确认弹窗，必须重新勾选，取消不会设置', async () => {
  const { api, w, view } = await setup(null);
  const action = () => view.get<HTMLButtonElement>('.owner-actions button');
  expect(action().element.disabled).toBe(true);
  w.owner.prepare(ADMIN);
  await click('设置设备所有者');
  expect(action().element.disabled).toBe(true);
  expect(w.workspace.state.modal).toBeNull();
  await click('检查条件');
  expect(action().element.disabled).toBe(false);
  w.owner.state.consent = true;
  await w.owner.setOwner();
  expect(api.setOwner).not.toHaveBeenCalled();
  await click('设置设备所有者');
  expect(view.find('[role="checkbox"]').exists()).toBe(false);
  expect(w.owner.state.consent).toBe(false);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('com.example.manager.Admin');
  await click('确认设置');
  expect(api.setOwner).not.toHaveBeenCalled();
  await consent();
  await click('取消');
  expect(w.owner.state.setting).toBeUndefined();
  expect(w.owner.state.consent).toBe(false);
  await click('设置设备所有者');
  expect(w.owner.state.consent).toBe(false);
  expect(api.setOwner).not.toHaveBeenCalled();
});

it.each(['disconnect', 'transport', 'component', 'owner'])(
  '确认期间 %s 变化会撤销授权并关闭弹窗',
  async (change) => {
    const { api, w } = await setup(null);
    w.owner.prepare(ADMIN);
    await click('检查条件');
    await click('设置设备所有者');
    await consent();
    if (change === 'disconnect') w.devices.state.snapshot!.devices = [];
    if (change === 'transport') w.workspace.state.selected = 'one@2';
    if (change === 'component') w.owner.state.component = 'com.other/.Admin';
    if (change === 'owner') w.devices.state.details!.owner = 'com.other/.Admin';
    await w.owner.setOwner();
    expect(w.workspace.state.modal).toBeNull();
    expect(w.owner.state.consent).toBe(false);
    expect(api.setOwner).not.toHaveBeenCalled();
  },
);

it('设置失败在确认弹窗显示错误，撤销旧检查和授权，不能重复执行', async () => {
  const { api, w } = await setup(null);
  w.owner.prepare(ADMIN);
  await click('检查条件');
  await click('设置设备所有者');
  await consent();
  vi.mocked(api.setOwner).mockRejectedValueOnce(new Error('设备条件已变化'));
  await click('确认设置');
  expect(w.workspace.state.modal).toBe('owner-set');
  expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe('设备条件已变化');
  expect(w.owner.state.consent).toBe(false);
  expect(w.owner.state.ownerCheck).toBeUndefined();
  await w.owner.setOwner();
  expect(api.setOwner).toHaveBeenCalledTimes(1);
  expect(w.workspace.state.notice).toBeNull();
});

it('扫描当前设备不覆盖手动内容，选择应用后填入两个字段且需要重新检查', async () => {
  const { api, w, view } = await setup(null);
  w.owner.prepare('com.previous/com.previous.Admin');
  expect(api.scanDeviceAdmins).toHaveBeenCalledExactlyOnceWith(target);
  expect(w.owner.state.component).toBe('com.previous/com.previous.Admin');
  const selector = view.getComponent(AppSearchSelect);
  expect(selector.props('options').map((entry) => entry.label)).toEqual(['管理助手', '管理助手']);
  expect(selector.props('options').map((entry) => entry.description)).toEqual([
    'Admin · com.example.manager',
    'OtherAdmin · com.example.manager',
  ]);
  selector.vm.$emit('update:modelValue', ADMIN);
  await nextTick();
  expect(view.get<HTMLInputElement>('#owner-package').element.value).toBe('com.example.manager');
  expect(view.get<HTMLInputElement>('#owner-receiver').element.value).toBe('com.example.manager.Admin');
  expect(api.checkOwner).not.toHaveBeenCalled();
  expect(api.setOwner).not.toHaveBeenCalled();
  await click('检查条件');
  w.owner.state.consent = true;
  await click('刷新管理应用');
  expect(w.owner.state.consent).toBe(false);
  expect(w.owner.state.ownerCheck).toBeUndefined();
  await view.get('#owner-receiver').setValue('.Custom');
  expect(view.getComponent(AppSearchSelect).props('modelValue')).toBe('');
  expect(view.get<HTMLButtonElement>('.owner-actions button').element.disabled).toBe(true);
});

it.each(['disconnect', 'switch-back'])('扫描途中 %s 不接受迟到结果，也不允许选旧候选', async (change) => {
  const { api, w } = await setup(null);
  let finish!: (value: { component: string; label: string }[]) => void;
  vi.mocked(api.scanDeviceAdmins).mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  const scan = w.owner.scanDeviceAdmins();
  if (change === 'disconnect') w.devices.state.snapshot!.devices = [];
  else {
    const selected = w.workspace.state.selected;
    w.workspace.state.selected = 'other|2';
    w.workspace.state.selected = selected;
  }
  w.owner.state.ownerExpanded = false;
  finish([{ component: ADMIN, label: '旧设备管理应用' }]);
  await scan;
  expect(w.owner.state.scan).toBeUndefined();
  w.owner.selectDeviceAdmin(ADMIN);
  expect(w.owner.state.component).toBe('');
});

it('扫描失败与无候选分别提示，保留手动输入并支持重试', async () => {
  const { api, view } = await setup(null);
  await view.get('#owner-package').setValue('com.manual');
  vi.mocked(api.scanDeviceAdmins).mockResolvedValueOnce([]);
  await click('刷新管理应用');
  expect(view.text()).toContain('未找到可用的管理应用');
  vi.mocked(api.scanDeviceAdmins).mockRejectedValueOnce(new Error('设备读取受限'));
  await click('刷新管理应用');
  expect(view.get('[role="alert"]').text()).toBe('设备读取受限');
  expect(view.text()).not.toContain('未找到可用的管理应用');
  expect(view.get<HTMLInputElement>('#owner-package').element.value).toBe('com.manual');
  await click('刷新管理应用');
  expect(view.find('#owner-device-app').exists()).toBe(true);
});

it('重新扫描保留选择器占位并禁用候选，停止等待后显示错误且不沿用旧候选', async () => {
  const { api, w, view } = await setup(null);
  await click('刷新管理应用');
  let fail!: (error: Error) => void;
  vi.mocked(api.scanDeviceAdmins).mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)));
  const scan = w.owner.scanDeviceAdmins();
  await nextTick();
  expect(view.getComponent(AppSearchSelect).props('disabled')).toBe(true);
  expect(view.getComponent(AppSearchSelect).props('options')).toHaveLength(2);
  await click('停止等待');
  expect(api.cancel).toHaveBeenCalledExactlyOnceWith();
  fail(new Error('已停止等待'));
  await scan;
  await nextTick();
  expect(view.getComponent(AppSearchSelect).props('disabled')).toBe(true);
  expect(view.getComponent(AppSearchSelect).props('options')).toHaveLength(0);
  expect(view.get('[role="alert"]').text()).toBe('已停止等待');
});

it('已配置状态不再展示设置表单，移除需要独立确认且取消不执行', async () => {
  const { view, api, w } = await setup();
  expect(view.findAll('.owner-current-identity dd').map((field) => field.text())).toEqual([
    'com.example.manager',
    'com.example.manager.Admin',
  ]);
  expect(view.find('#owner-package').exists()).toBe(false);
  expect(view.find('[role="checkbox"]').exists()).toBe(false);
  await click('移除所有者…');
  expect(api.checkOwnerRemoval).toHaveBeenCalledWith(target, ADMIN);
  expect(api.removeOwner).not.toHaveBeenCalled();
  await click('取消');
  expect(w.workspace.state.modal).toBeNull();
  expect(api.removeOwner).not.toHaveBeenCalled();
  await click('移除所有者…');
  await click('确认移除');
  expect(api.removeOwner).toHaveBeenCalledExactlyOnceWith(target, ADMIN, true);
  expect(w.devices.state.details?.owner).toBeNull();
  expect(w.workspace.state.modal).toBeNull();
  expect(view.find('#owner-package').exists()).toBe(true);
  expect(view.find('#owner-receiver').exists()).toBe(true);
});

it('普通管理应用显示系统限制，不提供可执行的移除确认', async () => {
  const { api, w } = await setup();
  vi.mocked(api.checkOwnerRemoval).mockResolvedValue({
    canRemove: false,
    summary: '系统不支持通过 ADB 移除',
  });
  await click('移除所有者…');
  expect(document.body.textContent).toContain('系统不支持通过 ADB 移除');
  expect([...document.querySelectorAll('button')].some((b) => b.textContent === '确认移除')).toBe(false);
  await w.owner.removeOwner();
  expect(api.removeOwner).not.toHaveBeenCalled();
});

it('移除失败保留当前所有者和弹窗错误，不显示成功', async () => {
  const { api, w } = await setup();
  vi.mocked(api.removeOwner).mockRejectedValue(new Error('设备拒绝移除'));
  await click('移除所有者…');
  await click('确认移除');
  expect(w.devices.state.details?.owner).toBe(ADMIN);
  expect(w.workspace.state.modal).toBe('owner-remove');
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('设备拒绝移除');
  expect(w.workspace.state.notice).toBeNull();
});

it('检查期间断线丢弃迟到结果，重新连接不能沿用旧确认', async () => {
  const { api, w } = await setup();
  let finish!: (value: OwnerRemovalCheck) => void;
  vi.mocked(api.checkOwnerRemoval).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const checking = w.owner.openRemoval();
  w.devices.state.snapshot!.devices = [{ ...target, state: 'offline' }];
  await nextTick();
  expect(w.workspace.state.modal).toBeNull();
  finish({ canRemove: true, summary: '旧检查结果' });
  await checking;
  expect(w.owner.state.removal).toBeUndefined();
  await w.owner.removeOwner();
  expect(api.removeOwner).not.toHaveBeenCalled();
});

it('移除条件检查期间在弹窗内提供进度与停止等待，完成后恢复关闭入口', async () => {
  const { api, w } = await setup();
  let finish!: (value: OwnerRemovalCheck) => void;
  vi.mocked(api.checkOwnerRemoval).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const checking = w.owner.openRemoval();
  await flushPromises();
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.querySelector('[role="status"]')?.textContent).toContain('正在检查移除条件');
  await click('停止等待');
  expect(api.cancel).toHaveBeenCalledExactlyOnceWith();
  expect(api.removeOwner).not.toHaveBeenCalled();
  finish({ canRemove: false, summary: '系统不支持通过 ADB 移除' });
  await checking;
  await flushPromises();
  expect(dialog.textContent).not.toContain('停止等待');
  expect(dialog.textContent).toContain('系统不支持通过 ADB 移除');
  await click('关闭');
  expect(w.workspace.state.modal).toBeNull();
});

it('当前所有者发生变化时关闭旧确认，不能移除新所有者', async () => {
  const { api, w } = await setup();
  await w.owner.openRemoval();
  w.devices.state.details!.owner = 'com.other/com.other.Admin';
  await w.owner.removeOwner();
  expect(w.workspace.state.modal).toBeNull();
  expect(api.removeOwner).not.toHaveBeenCalled();
});

it('单个安装包组件自动拆分并展开相对类名，修改字段撤销检查与授权', async () => {
  const { view, w, api } = await setup(null);
  w.install.state.apk = {
    id: 'test',
    fileName: 'manager.apk',
    packageName: 'com.example.manager',
    versionName: '1',
    versionCode: '1',
    minimumSdk: '23',
    testOnly: false,
    size: 100,
    admins: ['com.example.manager/.Admin'],
  };
  w.owner.prepare('com.example.manager/.Admin');
  await nextTick();
  expect(view.find('#owner-candidate').exists()).toBe(false);
  expect(view.get<HTMLInputElement>('#owner-package').element.value).toBe('com.example.manager');
  expect(view.get<HTMLInputElement>('#owner-receiver').element.value).toBe('com.example.manager.Admin');
  expect(view.find('[role="checkbox"]').exists()).toBe(false);
  await click('检查条件');
  expect(view.find('[role="checkbox"]').exists()).toBe(false);
  await click('设置设备所有者');
  await consent();
  expect(w.owner.state.consent).toBe(true);
  await view.get('#owner-package').setValue('com.other');
  expect(w.owner.state.component).toBe('com.other/com.example.manager.Admin');
  expect(w.owner.state.consent).toBe(false);
  expect(view.find('[role="checkbox"]').exists()).toBe(false);
  await w.owner.setOwner();
  expect(api.setOwner).not.toHaveBeenCalled();
});

it.each(['package', 'receiver'])('清空 %s 字段后不能沿用检查或通过回车提交空组件', async (field) => {
  const { view, w, api } = await setup(null);
  w.owner.prepare(ADMIN);
  await nextTick();
  await click('检查条件');
  await click('设置设备所有者');
  await consent();
  await view.get(`#owner-${field}`).setValue('');
  expect(w.owner.state.ownerCheck).toBeUndefined();
  expect(w.owner.state.consent).toBe(false);
  expect(view.get('button[type="submit"]').attributes('disabled')).toBeDefined();
  await view.get('form').trigger('submit');
  expect(api.checkOwner).toHaveBeenCalledTimes(1);
  await w.owner.setOwner();
  expect(api.setOwner).not.toHaveBeenCalled();
});

it('接收器逐字输入保留相对类名，检查与设置使用组合后的组件', async () => {
  const { view, w, api } = await setup(null);
  await view.get('#owner-package').setValue('com.example.manager');
  for (const value of ['.', '.A', '.Admin']) {
    await view.get('#owner-receiver').setValue(value);
    expect(view.get<HTMLInputElement>('#owner-receiver').element.value).toBe(value);
  }
  await click('检查条件');
  expect(api.checkOwner).toHaveBeenCalledExactlyOnceWith(target, 'com.example.manager/.Admin');
  await click('设置设备所有者');
  await consent();
  await click('确认设置');
  expect(api.setOwner).toHaveBeenCalledExactlyOnceWith(target, 'com.example.manager/.Admin', true);
  expect(view.findAll('.owner-current-identity dd').map((field) => field.text())).toEqual([
    'com.example.manager',
    'com.example.manager.Admin',
  ]);
  expect(w.workspace.state.notice?.text).toContain('已设置');
});

it('多个安装包组件可切换并填充两个字段，同时撤销上一次的授权', async () => {
  const { view, w } = await setup(null);
  w.install.state.apk = {
    id: 'multiple',
    fileName: 'manager.apk',
    packageName: 'com.example.manager',
    versionName: '1',
    versionCode: '1',
    minimumSdk: '23',
    testOnly: false,
    size: 100,
    admins: [ADMIN, 'com.example.manager/.OtherAdmin'],
  };
  w.owner.prepare(ADMIN);
  await nextTick();
  expect(view.find('#owner-candidate').exists()).toBe(true);
  await click('检查条件');
  await click('设置设备所有者');
  await consent();
  view.getComponent(AppSelect).vm.$emit('update:modelValue', 'com.example.manager/.OtherAdmin');
  await nextTick();
  expect(view.get<HTMLInputElement>('#owner-package').element.value).toBe('com.example.manager');
  expect(view.get<HTMLInputElement>('#owner-receiver').element.value).toBe('com.example.manager.OtherAdmin');
  expect(w.owner.state.ownerCheck).toBeUndefined();
  expect(w.owner.state.consent).toBe(false);
});
