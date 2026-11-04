import { createContext } from '@/shared/composables/context';
import { watch, reactive, computed } from 'vue';
import { t } from '@/shared/i18n/index';
import { type Apk, type Target } from '@/shared/api/types';
import { targetKey } from '@/shared/utils/device';
import type { FeatureContext } from '@/shared/composables/workspace';
type InstallStep = 'file' | 'review';

export function installState() {
  return {
    step: 'file' as InstallStep,
    apk: undefined as Apk | undefined,
    ownerConsent: undefined as { deviceKey: string; apkId: string; component: string } | undefined,
    ownerWarningOpen: false,
    adminComponent: '',
    dragging: false,
  };
}
interface Hooks {
  installed(target: Target, adminComponent?: string): Promise<void>;
}
/** 一次安装会话持有 APK 和可选的所有者授权，工作区负责更新安装后的列表和设备详情。 */
export function createInstall(
  { state: workspace, api, device, online, title, run }: FeatureContext,
  hooks: Hooks,
) {
  const state = reactive(installState());
  let session = 0;
  function reset() {
    // 每次打开都是独立安装会话，关闭后不沿用文件或所有者授权。
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
      state.step === 'review' &&
      !state.ownerWarningOpen &&
      !!state.apk &&
      online.value &&
      !workspace.busy &&
      (!state.ownerConsent ||
        (state.ownerConsent.apkId === state.apk.id &&
          state.ownerConsent.deviceKey === workspace.selected &&
          state.apk.admins.includes(state.ownerConsent.component))),
  );
  function changeStep(step: InstallStep) {
    if (
      workspace.modal !== 'install' ||
      workspace.busy ||
      state.ownerWarningOpen ||
      (step === 'review' && !state.apk)
    )
      return;
    workspace.notice = null;
    state.step = step;
  }
  function requestOwnerAfter(enabled: boolean) {
    if (state.step !== 'review' || workspace.busy || !online.value || !state.apk?.admins.length) return;
    // 请求勾选只打开风险提示；主动取消勾选立即生效。
    if (enabled) state.ownerWarningOpen = true;
    else state.ownerConsent = undefined;
  }
  function finishOwnerWarning(confirmed: boolean) {
    if (!state.ownerWarningOpen) return;
    if (confirmed) {
      if (!online.value || !device.value || !state.apk?.admins.includes(state.adminComponent)) return;
      state.ownerConsent = {
        deviceKey: targetKey(device.value),
        apkId: state.apk.id,
        component: state.adminComponent,
      };
    }
    state.ownerWarningOpen = false;
  }
  function removeApk() {
    if (workspace.busy) return;
    Object.assign(state, installState());
    workspace.notice = null;
  }
  function acceptApk(apk: Apk, step: InstallStep) {
    // 返回上一步保留本包选项；选入新包后重新选择所有者接收器并授权。
    state.apk = apk;
    state.adminComponent = apk.admins.length === 1 ? apk.admins[0] : '';
    state.ownerConsent = undefined;
    state.step = step;
  }
  function openInstall() {
    if (workspace.busy || state.ownerWarningOpen || (workspace.modal && workspace.modal !== 'install'))
      return false;
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
    // 快捷键已完成选文件这一步，解析成功后直接核对；表单内选包则等待点“下一步”。
    const step = workspace.modal === 'install' ? state.step : 'review';
    if (!openInstall()) return;
    const pending = session;
    await run(t('读取安装包'), async () => {
      const next = await api.chooseApk();
      // 设备断线或切换会关闭弹窗，迟到的文件解析结果不能填回新会话。
      if (next && pending === session && workspace.modal === 'install') acceptApk(next, step);
    });
  }
  function dragEnter() {
    // 悬停只给出落点提示；真正松开后再打开弹窗，避免切页触发列表读取抢占拖放任务。
    if (!workspace.busy && !state.ownerWarningOpen && (!workspace.modal || workspace.modal === 'install'))
      state.dragging = true;
  }
  async function drop(paths: string[]) {
    state.dragging = false;
    if (workspace.busy || state.ownerWarningOpen || (workspace.modal && workspace.modal !== 'install'))
      return;
    if (paths.length !== 1) {
      workspace.notice = { text: t('请一次拖入一个完整 APK。'), error: true };
      return;
    }
    if (!openInstall()) return;
    const pending = session;
    await run(t('读取安装包'), async () => {
      const next = await api.dropApk(paths[0]);
      if (pending === session && workspace.modal === 'install') acceptApk(next, 'review');
    });
  }

  function stopWaiting() {
    // 安装可能刚好完成；取消后不可接着使用这次授权发起新的设置命令。
    state.ownerConsent = undefined;
    return api.cancel();
  }

  async function install() {
    if (!device.value || !state.apk || !canInstall.value || workspace.modal !== 'install') return;
    const target = { ...device.value },
      apk = state.apk,
      consent = state.ownerConsent,
      pending = session;
    const isCurrent = () => pending === session && workspace.selected === targetKey(target) && online.value;
    await run(t('正在安装到 {name}', { name: title.value }), async () => {
      await api.install(target, apk.id);
      if (!isCurrent()) return;
      let verifiedOwner: string | undefined;
      if (consent && state.ownerConsent === consent) {
        workspace.busy = t('正在设置设备所有者…');
        try {
          // 同一原生设置命令会先检查设备条件，满足时才写入，并回读所有者组件。
          await api.setOwner(target, consent.component, true);
          if (!isCurrent()) return;
          verifiedOwner = consent.component;
          workspace.notice = { text: t('应用已安装，设备所有者已设置。') };
        } catch (error) {
          if (!isCurrent()) return;
          const reason = error instanceof Error ? error.message : String(error);
          workspace.notice = {
            text: t('应用已安装。设备所有者配置未完成：{reason}', { reason }),
            error: true,
          };
        }
      } else {
        workspace.notice = { text: t('安装成功，已核对设备上的安装版本。') };
      }
      workspace.modal = null;
      await hooks.installed(target, verifiedOwner);
    });
  }
  return {
    state,
    canInstall,
    requestOwnerAfter,
    finishOwnerWarning,
    stopWaiting,
    changeStep,
    removeApk,
    openInstall,
    closeInstall,
    chooseApk,
    dragEnter,
    drop,
    install,
  };
}

export const { key: installKey, use: useInstall } =
  createContext<ReturnType<typeof createInstall>>('install');
