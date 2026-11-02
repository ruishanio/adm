import type { ComputedRef } from 'vue';
import type { Api, Device } from '../../shared/contracts';
export type Tab = 'performance' | 'info' | 'apps' | 'files' | 'logs';
export function workspaceState() {
  return {
    selected: '',
    tab: 'info' as Tab,
    busy: '',
    notice: null as { text: string; error?: boolean } | null,
    modal: null as
      | 'connect'
      | 'settings'
      | 'rename'
      | 'folder'
      | 'file-rename'
      | 'file-delete'
      | 'app-details'
      | 'app-uninstall'
      | 'app-confirm'
      | 'install'
      | null,
    name: '',
    query: '',
    width: 248,
    viewport: typeof window === 'undefined' ? 1100 : window.innerWidth,
  };
}
export type WorkspaceState = ReturnType<typeof workspaceState>;
/** 领域模块仅依赖明确传入的会话与任务能力，不反向获取整个工作台。 */
export interface FeatureContext<S> {
  state: WorkspaceState & S;
  api: Api;
  device: ComputedRef<Device | undefined>;
  online: ComputedRef<boolean>;
  title: ComputedRef<string>;
  run<T>(label: string, work: () => Promise<T>, success?: string): Promise<T | undefined>;
  detailsReady(): boolean;
}
