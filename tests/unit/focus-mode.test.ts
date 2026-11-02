// @vitest-environment jsdom
import { effectScope, defineComponent, h, ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { useFocusMode } from '../../src/renderer/composables/focus-mode';
import AppDialog from '../../src/renderer/components/AppDialog.vue';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => cleanup());
  document.body.innerHTML = '';
});

it('全局捕获先于程序化聚焦，文字输入和组词不误切换，卸载后移除监听器', () => {
  const scope = effectScope();
  scope.run(() => useFocusMode());
  cleanups.push(() => scope.stop());
  const button = document.createElement('button');
  document.body.append(button);
  let modeAtFocus: string | undefined;
  button.addEventListener('pointerdown', () => {
    modeAtFocus = document.documentElement.dataset.focusMode;
    button.focus();
  });
  button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(modeAtFocus).toBe('pointer');
  expect(document.activeElement).toBe(button);
  for (const event of [
    new KeyboardEvent('keydown', { key: 'a', bubbles: true }),
    new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
    new KeyboardEvent('keydown', { key: 'ArrowLeft', metaKey: true, bubbles: true }),
  ])
    button.dispatchEvent(event);
  expect(document.documentElement.dataset.focusMode).toBe('pointer');
  button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  expect(document.documentElement.dataset.focusMode).toBe('keyboard');
  scope.stop();
  button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(document.documentElement.hasAttribute('data-focus-mode')).toBe(false);
});

it('挂载到 body 的弹窗继承全局输入方式，鼠标关闭和键盘退出都恢复原焦点', async () => {
  const Harness = defineComponent({
    setup() {
      useFocusMode();
      const open = ref(false);
      return () =>
        h('div', [
          h(
            'button',
            {
              onClick: () => {
                open.value = true;
              },
            },
            '打开测试弹窗',
          ),
          open.value
            ? h(
                AppDialog,
                {
                  title: '焦点验证',
                  onClose: () => {
                    open.value = false;
                  },
                },
                () =>
                  h(
                    'button',
                    {
                      'data-close-test': '',
                      onClick: () => {
                        open.value = false;
                      },
                    },
                    '返回',
                  ),
              )
            : null,
        ]);
    },
  });
  const view = mount(Harness, { attachTo: document.body });
  cleanups.push(() => view.unmount());
  const trigger = view.get('button');
  trigger.element.focus();
  await trigger.trigger('pointerdown');
  await trigger.trigger('click');
  await flushPromises();
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(view.element.contains(dialog)).toBe(false);
  expect(document.documentElement.dataset.focusMode).toBe('pointer');
  const close = document.querySelector<HTMLButtonElement>('[data-close-test]')!;
  close.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  close.click();
  await flushPromises();
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger.element));
  expect(document.documentElement.dataset.focusMode).toBe('pointer');
  await trigger.trigger('keydown', { key: 'Enter' });
  await trigger.trigger('click');
  await flushPromises();
  expect(document.documentElement.dataset.focusMode).toBe('keyboard');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flushPromises();
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger.element));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.documentElement.dataset.focusMode).toBe('keyboard');
});
