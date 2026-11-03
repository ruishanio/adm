import { readonly, ref, watch } from 'vue';
import english from './locales/en.json';
import traditionalChinese from './locales/zh-TW.json';
import japanese from './locales/ja.json';
import french from './locales/fr.json';
import german from './locales/de.json';
import spanish from './locales/es.json';
import russian from './locales/ru.json';

export { english };
export type MessageKey = keyof typeof english;
type Messages = Record<MessageKey, string>;
// 中文键即源文案；完整词典同时供前端与 Rust 原生菜单使用，新增键必须补齐所有语言。
export const catalogs = {
  en: english,
  'zh-CN': Object.fromEntries(Object.keys(english).map((key) => [key, key])) as Messages,
  'zh-TW': traditionalChinese,
  ja: japanese,
  fr: french,
  de: german,
  es: spanish,
  ru: russian,
} satisfies Record<string, Messages>;
export type Locale = keyof typeof catalogs;
export type LanguagePreference = Locale;
// 语言自称始终固定，用户误选语言后仍能识别并切回。
export const languageOptions: { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'ja', label: '日本語' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
  { value: 'ru', label: 'Русский' },
];
export function isLocale(value: string): value is Locale {
  return Object.hasOwn(catalogs, value);
}
/**
 * 优先使用保存的语言；首次启动只匹配系统首选语言，不被次选语言覆盖。
 * 中文先识别 Hans/Hant，再匹配地区；其他语言去掉地区后匹配，无对应翻译时回退英语。
 */
export function resolveLocale(
  value?: string,
  languages: readonly string[] = typeof navigator === 'undefined' ? ['en'] : [navigator.language],
): Locale {
  if (value && isLocale(value)) return value;
  const primary = (languages[0] || '').replaceAll('_', '-').toLowerCase();
  const [base, ...parts] = primary.split('-');
  if (base === 'zh') {
    if (parts.includes('hant')) return 'zh-TW';
    if (parts.includes('hans')) return 'zh-CN';
    return parts.some((part) => ['tw', 'hk', 'mo'].includes(part)) ? 'zh-TW' : 'zh-CN';
  }
  return isLocale(base) ? base : 'en';
}
const preference = ref<LanguagePreference>(resolveLocale());
export const language = readonly(preference);
export const locale = language;
export function setLanguage(value: LanguagePreference) {
  preference.value = value;
}
/** 路径、包名和设备名称只能作为参数传入；单次替换，不能再次解释参数内的花括号。 */
export function t(key: MessageKey, values: Record<string, string | number> = {}): string {
  const text = catalogs[locale.value][key];
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}
export function initializeLanguage() {
  watch(
    locale,
    (value) => {
      document.documentElement.lang = value;
    },
    { immediate: true },
  );
}
