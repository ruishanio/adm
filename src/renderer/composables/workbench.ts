import { t, language } from '../../shared/i18n';
import { reactive, computed, effectScope, watch, inject, type InjectionKey } from 'vue';
import { deviceName, targetKey, type Api } from '../../shared/contracts';
import { invalidateAppOptions } from '../lib/app-options';
import { workspaceState } from '../lib/workspace';
import { createDevices, devicesState } from '../features/devices/state';
import { createApps, appsState } from '../features/apps/state';
import { createFiles, filesState } from '../features/files/state';
import { createOwner, ownerState } from '../features/owner/state';
import { createInstall, installState } from '../features/install/state';
/** 组合各功能状态与公共任务调度；页面 API 保持稳定，领域之间通过明确回调协作。 */
export function createWorkbench(api: Api) {
  const state = reactive({
    ...workspaceState(),
    ...devicesState(),
    ...appsState(),
    ...filesState(),
    ...ownerState(),
    ...installState(),
  });
  const device = computed(() => state.snapshot?.devices.find((d) => targetKey(d) === state.selected));
  const online = computed(() => device.value?.state === 'device');
  const title = computed(() =>
    device.value ? deviceName(device.value, state.snapshot?.settings) : t('选择一台设备'),
  );
  const sidebar = computed(() => Math.min(state.width, Math.max(220, state.viewport - 641)));
  const scope = effectScope();
  let timer: ReturnType<typeof setInterval> | undefined;
  let started = false,
    disposed = false;
  async function run<T>(label: string, work: () => Promise<T>, success?: string): Promise<T | undefined> {
    // 同步置忙避免连点；选择与任务始终绑定同一个 transport_id。
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

  const { devices, apps, files, owner, install } = scope.run(() => {
    watch(
      () => [state.selected, online.value, state.apps, state.appStateEpoch, language.value],
      () => invalidateAppOptions(api),
      { flush: 'sync' },
    );
    const context = { state, api, device, online, title, run, detailsReady: () => devices.detailsReady() };
    const devices = createDevices(context);
    const apps = createApps(context);
    const files = createFiles(context);
    const owner = createOwner(context, (details) => {
      state.details = details;
    });
    const install = createInstall(context, {
      acceptApk: (apk) => {
        state.component = apk.admins[0] || '';
      },
      ownerAfter: () => state.ownerAfter,
      installed: async (target, apk, ownerAfter) => {
        apps.invalidate();
        if (ownerAfter) {
          owner.prepare(apk.admins[0] || state.component);
          state.tab = 'info';
          state.notice = { text: t('安装成功并已核对版本。请检查设备所有者条件，并单独确认授权。') };
        } else {
          state.notice = { text: t('安装成功，已核对设备上的安装版本。') };
          await apps.refreshInstalled(target);
        }
      },
    });
    return { devices, apps, files, owner, install };
  })!;
  const saveModal = () => (state.modal === 'rename' ? devices.saveName() : files.createFolder());
  function shortcut(e: KeyboardEvent) {
    if (!(e.metaKey || e.ctrlKey) || state.modal || state.busy) return;
    const key = e.key.toLowerCase();
    if (['o', 'r', 'l', ','].includes(key)) e.preventDefault();
    if (key === 'o') void install.chooseApk();
    if (key === 'r')
      void (state.tab === 'files'
        ? files.loadFiles(state.path)
        : state.tab === 'apps'
          ? apps.loadApps()
          : devices.refresh(true));
    if (key === 'l') state.modal = 'connect';
    if (key === ',') state.modal = 'settings';
  }
  const resize = () => {
    state.viewport = window.innerWidth;
  };
  function start() {
    if (started || disposed) return;
    started = true;
    void devices.refresh();
    timer = setInterval(() => {
      if (!state.busy && !state.modal) void devices.refresh();
    }, 5000);
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', shortcut);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    scope.stop();
    invalidateAppOptions(api);
    clearInterval(timer);
    window.removeEventListener('resize', resize);
    window.removeEventListener('keydown', shortcut);
  }

  return {
    state,
    api,
    device,
    online,
    title,
    sidebar,
    run,
    refresh: devices.refresh,
    loadFiles: files.loadFiles,
    loadApps: apps.loadApps,
    openApp: apps.openApp,
    uninstallApp: apps.uninstallApp,
    launchApp: apps.launchApp,
    confirmAppAction: apps.confirmAppAction,
    copyPackage: apps.copyPackage,
    ...install,
    select: devices.select,
    editName: devices.editName,
    hide: devices.hide,
    checkOwner: owner.checkOwner,
    setOwner: owner.setOwner,
    saveModal,
    start,
    dispose,
  };
}
export type Workbench = ReturnType<typeof createWorkbench>;
export const workbenchKey: InjectionKey<Workbench> = Symbol('workbench');
export function useWorkbench() {
  const value = inject(workbenchKey);
  if (!value) throw new Error(t('工作台尚未初始化'));
  return value;
}
