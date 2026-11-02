import { watch } from 'vue';
import { t } from '../../../shared/i18n';
import {
  targetKey,
  type InstalledApp,
  type AppDetails,
  type Target,
  type AppAction,
} from '../../../shared/contracts';
import type { FeatureContext } from '../../lib/workspace';
export function appsState() {
  return {
    apps: [] as InstalledApp[],
    appsLoaded: false,
    appQuery: '',
    appStateEpoch: 0,
    showSystemApps: false,
    application: undefined as
      | {
          target: Target;
          deviceName: string;
          packageName: string;
          details?: AppDetails;
          error: string;
          action?: Exclude<AppAction, 'launch'> | 'uninstall';
        }
      | undefined,
  };
}
/** 管理应用列表及确认操作；迟到结果必须仍属于打开时的设备和传输会话。 */
export function createApps({
  state,
  api,
  device,
  online,
  title,
  run,
  detailsReady,
}: FeatureContext<ReturnType<typeof appsState>>) {
  let appsRequested = '';
  function invalidate() {
    appsRequested = '';
    state.appsLoaded = false;
  }
  watch(
    () => [state.selected, online.value],
    () => {
      invalidate();
      state.apps = [];
      state.application = undefined;
      if (['app-details', 'app-uninstall', 'app-confirm'].includes(state.modal || '')) state.modal = null;
    },
    { flush: 'sync' },
  );
  async function loadApps() {
    if (!device.value || !online.value || state.busy) return;
    const chosen = { ...device.value },
      key = state.selected;
    appsRequested = key;
    state.appsLoaded = false;
    await run(t('读取已安装应用'), async () => {
      const list = await api.listApps(chosen);
      if (state.selected === key && online.value) {
        state.apps = list;
        state.appsLoaded = true;
      }
    });
  }
  watch(
    () => [state.tab, online.value, state.busy, state.selected, state.modal],
    () => {
      if (
        state.tab === 'apps' &&
        online.value &&
        !state.busy &&
        !state.modal &&
        detailsReady() &&
        appsRequested !== state.selected
      )
        void loadApps();
    },
  );
  async function openApp(app: InstalledApp, action?: Exclude<AppAction, 'launch'> | 'uninstall') {
    if (!device.value || !online.value || state.busy) return;
    // 弹窗绑定打开时的设备和包名；确认动作不能从之后变化的选中行重新推导目标。
    const pending = {
      target: { ...device.value },
      deviceName: title.value,
      packageName: app.packageName,
      action,
      error: '',
      details: undefined as AppDetails | undefined,
    };
    state.application = pending;
    state.modal = action === 'uninstall' ? 'app-uninstall' : action ? 'app-confirm' : 'app-details';
    await run(t('读取应用信息'), async () => {
      try {
        const details = await api.appDetails(pending.target, pending.packageName);
        if (
          state.application?.packageName === pending.packageName &&
          state.selected === targetKey(pending.target) &&
          online.value
        )
          state.application.details = details;
      } catch (error) {
        if (state.application)
          state.application.error = error instanceof Error ? error.message : String(error);
        throw error;
      }
    });
  }
  async function launchApp(app: InstalledApp) {
    if (!device.value || !online.value || state.busy || app.system || !app.enabled || !app.launchComponent)
      return;
    const chosen = { ...device.value };
    await run(t('正在打开应用'), async () => {
      const version = app.version?.code || (await api.appDetails(chosen, app.packageName)).versionCode;
      await api.appAction(chosen, app.packageName, version, 'launch', false);
      if (state.selected === targetKey(chosen) && online.value) {
        state.appStateEpoch++;
        state.notice = { text: t('已发送打开应用请求。') };
      }
    });
  }
  async function confirmAppAction() {
    const pending = state.application,
      details = pending?.details,
      action = pending?.action;
    if (
      !pending ||
      !details ||
      !action ||
      action === 'uninstall' ||
      details.system ||
      state.modal !== 'app-confirm' ||
      state.busy ||
      !online.value ||
      state.selected !== targetKey(pending.target)
    )
      return;
    pending.error = '';
    await run(action === 'clear-data' ? t('正在清除应用数据') : t('正在强制停止应用'), async () => {
      try {
        await api.appAction(pending.target, details.packageName, details.versionCode, action, true);
        if (state.application !== pending || state.selected !== targetKey(pending.target) || !online.value)
          return;
        state.modal = null;
        state.application = undefined;
        state.appStateEpoch++;
        state.notice = {
          text: action === 'clear-data' ? t('应用数据已清除。') : t('已执行强制停止，运行状态将重新读取。'),
        };
      } catch (error) {
        pending.error = error instanceof Error ? error.message : String(error);
        throw error;
      }
    });
  }
  async function copyPackage(app: InstalledApp) {
    await run(t('复制包名'), () => api.copyPackage(app.packageName), t('包名已复制。'));
  }
  async function uninstallApp() {
    const pending = state.application,
      details = pending?.details;
    if (
      !pending ||
      !details ||
      details.system ||
      state.modal !== 'app-uninstall' ||
      state.busy ||
      !online.value ||
      state.selected !== targetKey(pending.target)
    )
      return;
    pending.error = '';
    await run(t('正在卸载应用'), async () => {
      try {
        await api.uninstallApp(pending.target, details.packageName, details.versionCode, true);
        if (state.selected !== targetKey(pending.target) || !online.value) return;
        state.modal = null;
        state.application = undefined;
        state.apps = state.apps.filter((a) => a.packageName !== details.packageName);
        state.notice = { text: t('应用已卸载，已核对设备上的结果。') };
        // 后台核对其他应用的变化；刷新失败时明确保留已确认的卸载结果。
        try {
          const list = await api.listApps(pending.target);
          if (state.selected === targetKey(pending.target) && online.value) {
            state.apps = list;
            state.appsLoaded = true;
          }
        } catch {
          state.appsLoaded = false;
          state.notice = { text: t('应用已卸载，但列表刷新失败，请手动刷新。'), error: true };
        }
      } catch (error) {
        pending.error = error instanceof Error ? error.message : String(error);
        throw error;
      }
    });
  }

  async function refreshInstalled(target: Target) {
    appsRequested = state.selected;
    try {
      const list = await api.listApps(target);
      if (state.selected === targetKey(target) && online.value) {
        state.apps = list;
        state.appsLoaded = true;
      }
    } catch {
      if (state.selected === targetKey(target) && online.value)
        state.notice = { text: t('应用已安装，但列表刷新失败，请手动刷新。'), error: true };
    }
  }
  return {
    loadApps,
    openApp,
    launchApp,
    confirmAppAction,
    copyPackage,
    uninstallApp,
    invalidate,
    refreshInstalled,
  };
}
