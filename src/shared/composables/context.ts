import { inject, type InjectionKey } from 'vue';
import { t } from '@/shared/i18n';

/** 每个功能独立提供上下文，页面不能通过全局工作台访问其他功能的内部状态。 */
export function createContext<T>(name: string) {
  const key: InjectionKey<T> = Symbol(name);
  function use(): T {
    const value = inject(key);
    if (!value) throw new Error(t('工作台尚未初始化'));
    return value;
  }
  return { key, use };
}
