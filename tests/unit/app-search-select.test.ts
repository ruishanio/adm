// @vitest-environment jsdom
import { mount, flushPromises, DOMWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AppSearchSelect from '../../src/renderer/components/AppSearchSelect.vue';

let view: ReturnType<typeof mount>;
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // jsdom 不实现滚动，键盘选项定位由原生界面另行验证。
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  view?.unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});
function setup() {
  view = mount(AppSearchSelect, {
    attachTo: document.body,
    props: {
      id: 'apps',
      modelValue: '__all__',
      options: [
        { value: '__all__', label: '全部应用' },
        { value: 'com.example.notes', label: '笔记', description: 'com.example.notes' },
        { value: 'com.example.camera', label: '相机', description: 'com.example.camera' },
        { value: 'com.example.unknown', label: 'com.example.unknown' },
      ],
      searchPlaceholder: '搜索应用名称或包名',
      emptyLabel: '没有匹配的应用',
      'onUpdate:modelValue': (modelValue: string) => view.setProps({ modelValue }),
    },
  });
  return view;
}
const search = () => new DOMWrapper(document.querySelector<HTMLInputElement>('input[role=combobox]')!);
const options = () => Array.from(document.querySelectorAll('[role=option]')).map((el) => el.textContent);

it('按名称、包名和大小写检索，无结果和取消不改变已选应用，重新展开恢复全部选项', async () => {
  setup();
  await view.get('#apps').trigger('click');
  await flushPromises();
  expect(document.activeElement).toBe(search().element);
  await search().setValue('笔记');
  expect(options()).toEqual(['笔记com.example.notes']);
  await search().setValue('  COM.EXAMPLE.CAMERA  ');
  expect(options()).toEqual(['相机com.example.camera']);
  await search().setValue('unknown');
  expect(options()).toEqual(['com.example.unknown']);
  await search().setValue('不存在');
  expect(options()).toEqual([]);
  expect(document.body.textContent).toContain('没有匹配的应用');
  expect(view.emitted('update:modelValue')).toBeUndefined();
  await search().trigger('keydown', { key: 'Escape' });
  await flushPromises();
  expect(document.querySelector('input[role=combobox]')).toBeNull();
  expect(view.get('#apps').text()).toBe('全部应用');
  await view.get('#apps').trigger('click');
  await flushPromises();
  expect(search().element.value).toBe('');
  expect(options()).toHaveLength(4);
});

it('键盘检索选择后可返回全部应用，禁用时关闭候选菜单', async () => {
  setup();
  await view.get('#apps').trigger('keydown', { key: 'Enter' });
  await flushPromises();
  await search().setValue('notes');
  await flushPromises();
  await search().trigger('keydown', { key: 'ArrowDown' });
  await search().trigger('keydown', { key: 'Enter' });
  await flushPromises();
  expect(view.emitted('update:modelValue')).toEqual([['com.example.notes']]);
  expect(view.get('#apps').text()).toBe('笔记');
  await view.get('#apps').trigger('click');
  await flushPromises();
  expect(search().element.value).toBe('');
  await new DOMWrapper(document.querySelector('[role=option]')!).trigger('click');
  await flushPromises();
  expect(view.get('#apps').text()).toBe('全部应用');
  await view.get('#apps').trigger('click');
  await flushPromises();
  await view.setProps({ disabled: true });
  await flushPromises();
  expect(document.querySelector('input[role=combobox]')).toBeNull();
  expect(view.get('#apps').attributes('disabled')).toBeDefined();
});
