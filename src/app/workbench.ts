import { effectScope, watch, provide } from 'vue';
import { t, language } from '@/shared/i18n';
import type { Api } from '@/shared/api/types';
import { invalidateAppOptions } from '@/shared/api/app-options';
import { createWorkspace, workspaceKey } from '@/shared/composables/workspace';
import { createDevices, devicesKey } from '@/features/devices/state';
import { createApps, appsKey } from '@/features/apps/state';
import { createFiles, filesKey } from '@/features/files/state';
import { createOwner, ownerKey } from '@/features/devices/owner/state';
import { createInstall, installKey } from '@/features/apps/install/state';

/** 组装功能及跨功能回调；api 为可替换的传输入口，返回独立上下文和可重复释放的生命周期。 */
export function createWorkbench(api: Api) {
  const core = createWorkspace(api);
  const scope = effectScope();
  const modules = scope.run(() => {
    const devices = createDevices(core);
    const workspace = {
      ...core,
      device: devices.device,
      online: devices.online,
      title: devices.title,
      detailsReady: devices.detailsReady,
    };
    const apps = createApps(workspace);
    const files = createFiles(workspace);
    const owner = createOwner(workspace, (details) => {
      devices.state.details = details;
    });
    const install = createInstall(workspace, {
      installed: async (target, adminComponent) => {
        apps.invalidate();
        if (adminComponent) {
          owner.prepare(adminComponent);
          core.state.tab = 'info';
          core.state.notice = { text: t('安装成功并已核对版本。请检查设备所有者条件，并单独确认授权。') };
        } else {
          core.state.notice = { text: t('安装成功，已核对设备上的安装版本。') };
          await apps.refreshInstalled(target);
        }
      },
    });
    watch(
      () => [
        core.state.selected,
        devices.online.value,
        apps.state.apps,
        apps.state.appStateEpoch,
        language.value,
      ],
      () => invalidateAppOptions(api),
      { flush: 'sync' },
    );
    return { workspace, devices, apps, files, owner, install };
  })!;
  const { workspace, devices, apps, files, owner, install } = modules;
  const providers = {
    [workspaceKey as symbol]: workspace,
    [devicesKey as symbol]: devices,
    [appsKey as symbol]: apps,
    [filesKey as symbol]: files,
    [ownerKey as symbol]: owner,
    [installKey as symbol]: install,
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  let started = false,
    disposed = false;
  function shortcut(e: KeyboardEvent) {
    const state = core.state;
    if (!(e.metaKey || e.ctrlKey) || state.modal || state.busy) return;
    const key = e.key.toLowerCase();
    if (['o', 'r', 'l', ','].includes(key)) e.preventDefault();
    if (key === 'o') void install.chooseApk();
    if (key === 'r')
      void (state.tab === 'files'
        ? files.loadFiles(files.state.path)
        : state.tab === 'apps'
          ? apps.loadApps()
          : devices.refresh(true));
    if (key === 'l') state.modal = 'connect';
    if (key === ',') state.modal = 'settings';
  }
  const resize = () => {
    core.state.viewport = window.innerWidth;
  };
  function start() {
    if (started || disposed) return;
    started = true;
    void devices.refresh();
    timer = setInterval(() => {
      if (!core.state.busy && !core.state.modal) void devices.refresh();
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
  const saveModal = () => (core.state.modal === 'rename' ? devices.saveName() : files.createFolder());
  return { ...modules, providers, saveModal, start, dispose };
}
export type Workbench = ReturnType<typeof createWorkbench>;
/** 根组件统一提供上下文；单元测试可直接使用同一份 providers，避免复制全局状态。 */
export function provideWorkbench(workbench: Workbench) {
  for (const key of Object.getOwnPropertySymbols(workbench.providers)) provide(key, workbench.providers[key]);
}
