import { reactive, computed, type ComputedRef } from 'vue';
import { createContext } from './context';
import type { Api, Device } from '@/shared/api/types';
export type Tab = 'performance' | 'control' | 'info' | 'apps' | 'files' | 'logs';
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
/** 全局只维护导航和任务；各业务状态由对应功能创建并持有。 */
export function createWorkspace(api: Api) {
  const state = reactive(workspaceState());
  const sidebar = computed(() => Math.min(state.width, Math.max(220, state.viewport - 641)));
  async function run<T>(label: string, work: () => Promise<T>, success?: string): Promise<T | undefined> {
    // 串行写任务共用一个入口，不能因拆功能而产生并发安装或文件写入。
    if (state.busy) return;
    state.busy = label;
    state.notice = null;
    try {
      const result = await work();
      if (success) state.notice = { text: success };
      return result;
    } catch (error) {
      state.notice = { text: error instanceof Error ? error.message : String(error), error: true };
    } finally {
      state.busy = '';
    }
  }
  return { state, api, sidebar, run };
}
export type WorkspaceCore = ReturnType<typeof createWorkspace>;
/** 功能只能获得导航、当前设备会话和任务能力，不能获得其他功能的内部状态。 */
export interface FeatureContext extends WorkspaceCore {
  device: ComputedRef<Device | undefined>;
  online: ComputedRef<boolean>;
  title: ComputedRef<string>;
  detailsReady(): boolean;
}
export const { key: workspaceKey, use: useWorkspace } = createContext<FeatureContext>('workspace');
