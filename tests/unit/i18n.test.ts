import { afterEach, expect, it } from 'vitest';
import { english, resolveLocale, setLanguage, t } from '../../src/shared/i18n';
afterEach(() => setLanguage('zh-CN'));
it('首次按系统首选语言初始化，不支持时回退英语，已保存偏好优先', () => {
  expect(resolveLocale(undefined, ['zh-Hans-CN', 'en-US'])).toBe('zh-CN');
  expect(resolveLocale('system', ['zh-CN'])).toBe('zh-CN');
  expect(resolveLocale('', ['en-US', 'zh-CN'])).toBe('en');
  expect(resolveLocale('', ['fr-FR', 'zh-CN'])).toBe('en');
  expect(resolveLocale('', ['zh-TW'])).toBe('en');
  expect(resolveLocale('zh-CN', ['en-US'])).toBe('zh-CN');
});
it('语言切换替换完整文案且不再次解释参数内容', () => {
  setLanguage('en');
  expect(t('目标：{name}', { name: '工位 {name}' })).toBe('Target: 工位 {name}');
  setLanguage('zh-CN');
  expect(t('目标：{name}', { name: 'Phone' })).toBe('目标：Phone');
});
it('两种语言的具名参数完全一致，避免翻译丢失设备或数量', () => {
  const slots = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [source, translated] of Object.entries(english))
    expect(slots(translated), source).toEqual(slots(source));
});
