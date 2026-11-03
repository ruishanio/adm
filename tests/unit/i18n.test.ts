import { afterEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { catalogs, english, languageOptions, resolveLocale, setLanguage, t } from '@/shared/i18n/index';
afterEach(() => setLanguage('zh-CN'));
it('macOS 应用包声明全部界面语言，系统追加菜单能够找到对应翻译', () => {
  const plist = readFileSync(new URL('../../src-tauri/Info.plist', import.meta.url), 'utf8');
  const array = plist.match(/<key>CFBundleLocalizations<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1];
  expect(array).toBeDefined();
  const nativeLocales = [...array!.matchAll(/<string>([^<]+)<\/string>/g)].map((entry) =>
    resolveLocale(undefined, [entry[1]]),
  );
  expect(nativeLocales.sort()).toEqual(languageOptions.map(({ value }) => value).sort());
});
it('首次按系统首选语言初始化，不支持时回退英语，已保存偏好优先', () => {
  expect(resolveLocale(undefined, ['zh-Hans-CN', 'en-US'])).toBe('zh-CN');
  expect(resolveLocale('system', ['zh-CN'])).toBe('zh-CN');
  expect(resolveLocale('', ['en-US', 'zh-CN'])).toBe('en');
  expect(resolveLocale('', ['fr-FR', 'zh-CN'])).toBe('fr');
  expect(resolveLocale('', ['zh-TW'])).toBe('zh-TW');
  expect(resolveLocale('', ['ko-KR', 'zh-CN'])).toBe('en');
  expect(resolveLocale('zh-CN', ['en-US'])).toBe('zh-CN');
});
it('语言切换替换完整文案且不再次解释参数内容', () => {
  setLanguage('en');
  expect(t('目标：{name}', { name: '工位 {name}' })).toBe('Target: 工位 {name}');
  setLanguage('zh-CN');
  expect(t('目标：{name}', { name: 'Phone' })).toBe('目标：Phone');
});
it.each([
  ['zh-Hant-CN', 'zh-TW'],
  ['zh-Hans-HK', 'zh-CN'],
  ['zh_HK', 'zh-TW'],
  ['zh-MO', 'zh-TW'],
  ['zh-SG', 'zh-CN'],
  ['ja-JP', 'ja'],
  ['fr-CA', 'fr'],
  ['de-AT', 'de'],
  ['es-MX', 'es'],
  ['ru-RU', 'ru'],
  ['en-GB', 'en'],
])('系统语言 %s 正确归一为 %s', (system, expected) => {
  expect(resolveLocale(undefined, [system])).toBe(expected);
});
it('八种语言完整覆盖相同文案与具名参数，避免翻译丢失设备或数量', () => {
  const slots = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  expect(languageOptions.map(({ value }) => value)).toEqual([
    'en',
    'zh-CN',
    'zh-TW',
    'ja',
    'fr',
    'de',
    'es',
    'ru',
  ]);
  for (const { value } of languageOptions) {
    const messages = catalogs[value];
    expect(Object.keys(messages).sort(), value).toEqual(Object.keys(english).sort());
    expect(resolveLocale(value, ['en-US']), value).toBe(value);
    for (const [source, translated] of Object.entries(messages)) {
      expect(translated.trim().length, `${value}: ${source}`).toBeGreaterThan(0);
      expect(slots(translated), `${value}: ${source}`).toEqual(slots(source));
    }
    setLanguage(value);
    expect(t('目标：{name}', { name: '工位 {name} / 日本語 / Gerät' })).toContain(
      '工位 {name} / 日本語 / Gerät',
    );
  }
});
