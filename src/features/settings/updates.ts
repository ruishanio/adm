import { computed, reactive } from 'vue';
import { APP_VERSION } from '@/shared/app-info';
import { createContext } from '@/shared/composables/context';
import type { Api, AppUpdate } from '@/shared/api/types';

type Phase = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'installing';
const day = 24 * 60 * 60 * 1000;
const lastCheck = 'adm.update.last-check';

/** 更新状态属于工作台，关闭更新对话框后仍保留已经验签的下载和版本提示。 */
export function createUpdates(api: Api) {
  const state = reactive({
    phase: 'idle' as Phase,
    update: null as AppUpdate | null,
    error: '',
    progress: null as number | null,
  });
  const busy = computed(() => ['checking', 'downloading', 'installing'].includes(state.phase));
  let checkedInSession = false;
  let checkedAt = 0;
  async function check(automatic = false) {
    if (busy.value || state.phase === 'ready') return;
    if (automatic) {
      try {
        const cached = JSON.parse(localStorage.getItem(lastCheck) || 'null');
        const elapsed = Date.now() - (cached?.at || checkedAt);
        if (cached?.installed === APP_VERSION && elapsed >= 0 && elapsed < day) {
          // 缓存仅用于显示。进程重启后必须重新取得服务端清单，再接受用户的下载操作。
          if (!checkedInSession && state.phase === 'idle') {
            state.update = cached.update || null;
            state.phase = state.update ? 'available' : cached.ok ? 'current' : 'idle';
          }
          return;
        }
      } catch {
        /* 浏览器禁用本地存储时，每次启动仍可正常检查 */
      }
      const elapsed = Date.now() - checkedAt;
      if (elapsed >= 0 && elapsed < day) return;
    }
    checkedAt = Date.now();
    state.error = '';
    state.phase = 'checking';
    try {
      state.update = await api.checkUpdate();
      checkedInSession = true;
      state.phase = state.update ? 'available' : 'current';
    } catch (error) {
      checkedInSession = false;
      state.phase = state.update ? 'available' : 'idle';
      if (!automatic) state.error = String(error instanceof Error ? error.message : error);
    }
    try {
      localStorage.setItem(
        lastCheck,
        JSON.stringify({ installed: APP_VERSION, at: checkedAt, update: state.update, ok: checkedInSession }),
      );
    } catch {
      /* 本次进程仍保留结果 */
    }
  }
  async function download() {
    if (state.phase !== 'available' || !state.update) return;
    if (!checkedInSession) {
      const selected = state.update.version;
      await check();
      if (!checkedInSession || state.update?.version !== selected) return;
    }
    state.phase = 'downloading';
    state.progress = null;
    state.error = '';
    try {
      if (state.update.portable) {
        await api.openPortableUpdate(state.update.version);
        state.phase = 'available';
      } else {
        await api.downloadUpdate(state.update.version);
        state.phase = 'ready';
      }
    } catch (error) {
      state.phase = 'available';
      state.error = String(error instanceof Error ? error.message : error);
    }
  }
  async function install() {
    if (state.phase !== 'ready' || !state.update) return;
    state.phase = 'installing';
    state.error = '';
    try {
      await api.installUpdate(state.update.version);
    } catch (error) {
      state.phase = 'ready';
      state.error = String(error instanceof Error ? error.message : error);
    }
  }
  return { state, busy, check, download, install };
}
export const { key: updatesKey, use: useUpdates } =
  createContext<ReturnType<typeof createUpdates>>('updates');
