import { createContext } from '@/shared/composables/context';
import { watch, reactive, computed } from 'vue';
import { t } from '@/shared/i18n/index';
import { type Apk, type Target } from '@/shared/api/types';
import { targetKey } from '@/shared/utils/device';
import type { FeatureContext } from '@/shared/composables/workspace';
export function installState() {
  return {
    apk: undefined as Apk | undefined,
    ownerAfter: false,
    adminComponent: '',
    dragging: false,
  };
}
interface Hooks {
  installed(target: Target, adminComponent?: string): Promise<void>;
}
/** 安装流程只负责 APK 和确认会话，完成后的列表刷新/所有者引导由工作区编排。 */
export function createInstall(
  { state: workspace, api, device, online, title, run }: FeatureContext,
  hooks: Hooks,
) {
  const state = reactive(installState());
  let session = 0;
  function reset() {
    // 每次打开都是独立安装会话，关闭后不沿用文件或所有者配置意向。
    session++;
    Object.assign(state, installState());
  }
  watch(
    () => workspace.modal,
    (modal, previous) => {
      if (previous === 'install' && modal !== 'install') reset();
    },
    { flush: 'sync' },
  );
  watch(
    () => [workspace.selected, online.value],
    () => {
      if (workspace.modal === 'install') workspace.modal = null;
      state.dragging = false;
    },
    { flush: 'sync' },
  );
  const canInstall = computed(
    () =>
      !!state.apk &&
      online.value &&
      !workspace.busy &&
      (!state.ownerAfter || state.apk.admins.includes(state.adminComponent)),
  );
  function removeApk() {
    state.apk = undefined;
    state.adminComponent = '';
    state.ownerAfter = false;
  }
  function acceptApk(apk: Apk) {
    state.apk = apk;
    // 只有一个接收器才能自动带入；更换 APK 后撤销旧的所有者意向与选择。
    state.adminComponent = apk.admins.length === 1 ? apk.admins[0] : '';
    state.ownerAfter = false;
  }
  function openInstall() {
    if (workspace.busy || (workspace.modal && workspace.modal !== 'install')) return false;
    if (workspace.modal !== 'install') reset();
    workspace.notice = null;
    workspace.tab = 'apps';
    workspace.modal = 'install';
    return true;
  }
  function closeInstall() {
    if (workspace.busy) return;
    workspace.modal = null;
    workspace.notice = null;
  }
  async function chooseApk() {
    if (!openInstall()) return;
    const pending = session;
    await run(t('读取安装包'), async () => {
      const next = await api.chooseApk();
      // 设备断线或切换会关闭弹窗，迟到的文件解析结果不能填回新会话。
      if (next && pending === session && workspace.modal === 'install') acceptApk(next);
    });
  }
  function dragEnter() {
    // 悬停只给出落点提示；真正松开后再打开弹窗，避免切页触发列表读取抢占拖放任务。
    if (!workspace.busy && (!workspace.modal || workspace.modal === 'install')) state.dragging = true;
  }
  async function drop(paths: string[]) {
    state.dragging = false;
    if (workspace.busy || (workspace.modal && workspace.modal !== 'install')) return;
    if (paths.length !== 1) {
      workspace.notice = { text: t('请一次拖入一个完整 APK。'), error: true };
      return;
    }
    if (!openInstall()) return;
    const pending = session;
    await run(t('读取安装包'), async () => {
      const next = await api.dropApk(paths[0]);
      if (pending === session && workspace.modal === 'install') acceptApk(next);
    });
  }

  async function install() {
    if (!device.value || !state.apk || !canInstall.value || workspace.modal !== 'install') return;
    const target = { ...device.value },
      apk = state.apk,
      adminComponent = state.ownerAfter ? state.adminComponent : undefined,
      pending = session;
    await run(t('正在安装到 {name}', { name: title.value }), async () => {
      await api.install(target, apk.id);
      if (pending !== session || workspace.selected !== targetKey(target) || !online.value) return;
      workspace.modal = null;
      await hooks.installed(target, adminComponent);
    });
  }
  return { state, canInstall, removeApk, openInstall, closeInstall, chooseApk, dragEnter, drop, install };
}

export const { key: installKey, use: useInstall } =
  createContext<ReturnType<typeof createInstall>>('install');
