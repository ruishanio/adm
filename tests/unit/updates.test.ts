// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createWorkbench } from '@/app/workbench';
import UpdateDialog from '@/features/settings/UpdateDialog.vue';
import AboutPanel from '@/features/settings/AboutPanel.vue';
import { createUpdates } from '@/features/settings/updates';
import { setLanguage } from '@/shared/i18n';
import type { Api } from '@/shared/api/types';

function fixture(portable = false) {
  const methods = {
    checkUpdate: vi.fn(async () => ({ version: '0.1.9', notes: 'Release notes', portable })),
    downloadUpdate: vi.fn(async (_version: string) => {}),
    installUpdate: vi.fn(async (_version: string) => {}),
    openPortableUpdate: vi.fn(async (_version: string) => {}),
  };
  return { api: methods as unknown as Api, methods };
}
afterEach(() => localStorage.clear());

it('同日重开仍显示可用更新，下载前重查，版本变化后要求重新选择', async () => {
  const { api, methods } = fixture();
  await createUpdates(api).check(true);
  const second = createUpdates(api);
  await second.check(true);
  expect(methods.checkUpdate).toHaveBeenCalledTimes(1);
  expect(second.state.update?.version).toBe('0.1.9');
  methods.checkUpdate.mockResolvedValueOnce({ version: '0.2.0', notes: 'new', portable: false });
  await second.download();
  expect(second.state.update?.version).toBe('0.2.0');
  expect(methods.downloadUpdate).not.toHaveBeenCalled();
  await second.download();
  expect(methods.downloadUpdate).toHaveBeenCalledExactlyOnceWith('0.2.0');
});
it('便携版只打开对应版本 ZIP，拒绝触发安装器', async () => {
  const { api, methods } = fixture(true);
  const updates = createUpdates(api);
  await updates.check();
  await updates.download();
  await updates.install();
  expect(methods.openPortableUpdate).toHaveBeenCalledExactlyOnceWith('0.1.9');
  expect(methods.downloadUpdate).not.toHaveBeenCalled();
  expect(methods.installUpdate).not.toHaveBeenCalled();
});
it('关于只提示版本并打开更新窗口，手动检查由独立窗口发起', async () => {
  setLanguage('zh-CN');
  const { api, methods } = fixture();
  const w = createWorkbench(api);
  const about = mount(AboutPanel, { global: { provide: w.providers } });
  try {
    expect(about.get('button').text()).toBe('检查更新');
    await about.get('button').trigger('click');
    expect(w.workspace.state.modal).toBe('settings-update');
    expect(methods.checkUpdate).not.toHaveBeenCalled();
    const update = mount(UpdateDialog, { global: { provide: w.providers } });
    try {
      await flushPromises();
      expect(methods.checkUpdate).toHaveBeenCalledTimes(1);
      expect(about.text()).toContain('有新版本 0.1.9');
      expect(about.get('button').text()).toBe('查看更新');
      expect(about.text()).not.toContain('下载更新');
      expect(about.text()).not.toContain('Release notes');
      expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('下载更新');
    } finally {
      update.unmount();
    }
  } finally {
    about.unmount();
    w.dispose();
  }
});

it('验签失败不进入安装；设备忙可稍后重试已验证的下载', async () => {
  setLanguage('zh-CN');
  const { api, methods } = fixture();
  const w = createWorkbench(api);
  await w.updates.check();
  const view = mount(UpdateDialog, { global: { provide: w.providers } });
  try {
    await flushPromises();
    const dialog = document.body.querySelector('[role="dialog"]')!;
    methods.downloadUpdate.mockRejectedValueOnce(new Error('签名错误'));
    await w.updates.download();
    expect(dialog.querySelector('[role=alert]')?.textContent).toBe('签名错误');
    await w.updates.install();
    expect(methods.installUpdate).not.toHaveBeenCalled();
    await w.updates.download();
    w.workspace.state.busy = '传输文件';
    await nextTick();
    expect(
      Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.trim() === '安装并重启')
        ?.disabled,
    ).toBe(true);
    w.workspace.state.busy = '';
    methods.installUpdate.mockRejectedValueOnce(new Error('请先结束设备录像，再安装更新。'));
    await w.updates.install();
    expect(w.updates.state.phase).toBe('ready');
    await w.updates.install();
    expect(methods.installUpdate).toHaveBeenCalledTimes(2);
    expect(methods.downloadUpdate).toHaveBeenCalledTimes(2);
  } finally {
    view.unmount();
    w.dispose();
  }
});
