// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LicensePanel from '../../src/renderer/components/LicensePanel.vue';
import { setLanguage } from '../../src/shared/i18n';

const openNotices = vi.fn<() => Promise<void>>();
let view: ReturnType<typeof mount>;
beforeEach(() => {
  setLanguage('zh-CN');
  openNotices.mockResolvedValue();
});
afterEach(() => {
  view?.unmount();
  document.body.innerHTML = '';
  vi.resetAllMocks();
});

it('仅显示署名和当前平台通知，完整声明按需打开', async () => {
  view = mount(LicensePanel, {
    props: { platform: 'darwin', openNotices },
    attachTo: document.body,
  });
  expect(view.text()).toContain('work created and shared by Google');
  expect(view.text()).toContain('https://creativecommons.org/licenses/by/3.0/');
  expect(view.text()).not.toContain('SmartScreen');
  expect(view.find('input, select, details').exists()).toBe(false);
  expect(openNotices).not.toHaveBeenCalled();
  await view.get('[data-open-notices]').trigger('click');
  await flushPromises();
  expect(openNotices).toHaveBeenCalledExactlyOnceWith();
});

it('Windows 显示独立条款与隐私通知，打开失败可重试，打开期间禁止重复点击', async () => {
  setLanguage('en');
  openNotices.mockRejectedValueOnce(new Error('file missing'));
  view = mount(LicensePanel, {
    props: { platform: 'win32', openNotices },
    attachTo: document.body,
  });
  await flushPromises();
  expect(view.text()).toContain('separate Microsoft license terms');
  expect(view.text()).toContain('collects and sends user information to Microsoft');
  await view.get('[data-open-notices]').trigger('click');
  await flushPromises();
  expect(view.get('[role="alert"]').text()).toContain('Could not open');
  let finish!: () => void;
  openNotices.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));
  await view.get('[data-open-notices]').trigger('click');
  expect(view.get('[data-open-notices]').attributes('disabled')).toBeDefined();
  expect(view.find('[role="alert"]').exists()).toBe(false);
  finish();
  await flushPromises();
  expect(view.get('[data-open-notices]').attributes('disabled')).toBeUndefined();
  expect(openNotices).toHaveBeenCalledTimes(2);
});
