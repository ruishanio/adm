import { t, setLanguage, resolveLocale } from '../../shared/i18n';
import { reactive, computed, watch, inject, type InjectionKey } from 'vue';
import {
  deviceName,
  targetKey,
  type Api,
  type Snapshot,
  type Device,
  type Details,
  type Apk,
  type OwnerCheck,
  type DeviceFile,
  type InstalledApp,
  type AppDetails,
  type Target,
} from '../../shared/contracts';
type Tab = 'info' | 'apps' | 'files';
/**
 * 创建跨页面共享的工作台，处理会话切换、任务互斥和异步数据回读。
 * @param api 受控的原生业务接口，测试时可注入模拟实现。
 * @returns 响应式状态、派生设备信息及启动/清理、连接与设备操作方法。
 */
export function createWorkbench(api: Api) {
  const state = reactive({
    snapshot: undefined as Snapshot | undefined,
    selected: '',
    tab: 'info' as Tab,
    apps: [] as InstalledApp[],
    appsLoaded: false,
    appQuery: '',
    showSystemApps: false,
    application: undefined as
      | { target: Target; deviceName: string; packageName: string; details?: AppDetails; error: string }
      | undefined,
    details: undefined as Details | undefined,
    apk: undefined as Apk | undefined,
    component: '',
    ownerCheck: undefined as OwnerCheck | undefined,
    consent: false,
    allowTest: false,
    ownerAfter: false,
    ownerExpanded: false,
    dragging: false,
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
      | 'install'
      | null,
    renameDevice: undefined as Device | undefined,
    name: '',
    query: '',
    width: 248,
    viewport: typeof window === 'undefined' ? 1100 : window.innerWidth,
    path: '/sdcard',
    pathInput: '/sdcard',
    files: [] as DeviceFile[],
    file: undefined as DeviceFile | undefined,
    detailEpoch: 0,
  });
  const device = computed(() => state.snapshot?.devices.find((d) => targetKey(d) === state.selected));
  const online = computed(() => device.value?.state === 'device');
  const title = computed(() =>
    device.value ? deviceName(device.value, state.snapshot?.settings) : t('选择一台设备'),
  );
  const sidebar = computed(() => Math.min(state.width, Math.max(220, state.viewport - 641)));
  let initial = true,
    refreshing = false,
    detailRequest = '',
    filesLoaded = '',
    appsRequested = '';
  let timer: ReturnType<typeof setInterval> | undefined;
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
  async function refresh(reloadDetails = false) {
    if (refreshing) return;
    refreshing = true;
    try {
      state.snapshot = await api.refresh();
      if (initial) {
        // 首次识别后保存确定的语言；系统语言后续变化和设备轮询都不覆盖用户选择。
        const savedLanguage = state.snapshot.settings.language;
        const resolvedLanguage = resolveLocale(savedLanguage);
        setLanguage(resolvedLanguage);
        initial = false;
        state.width = state.snapshot.settings.sidebarWidth;
        if (savedLanguage !== resolvedLanguage) {
          // 原生任务互斥：先完成偏好迁移，再选中设备触发详情读取，避免启动时两个 IPC 抢占任务。
          await api.language(resolvedLanguage);
          state.snapshot.settings.language = resolvedLanguage;
        }
        const first = state.snapshot.devices.find((d) => d.state === 'device');
        if (first) state.selected = targetKey(first);
      }
      if (reloadDetails) {
        detailRequest = '';
        state.detailEpoch++;
      }
      if (state.snapshot.error) state.notice = { text: state.snapshot.error, error: true };
    } catch (error) {
      state.notice = { text: String(error), error: true };
    } finally {
      refreshing = false;
    }
  }
  watch(
    () => [state.selected, online.value],
    () => {
      // 断连或换设备即撤销授权并丢弃目录，不能复用旧传输会话的数据。
      detailRequest = '';
      filesLoaded = '';
      state.details = undefined;
      state.ownerCheck = undefined;
      state.consent = false;
      state.files = [];
      state.file = undefined;
      state.path = state.pathInput = '/sdcard';
      appsRequested = '';
      state.apps = [];
      state.appsLoaded = false;
      state.application = undefined;
      if (['app-details', 'app-uninstall', 'install'].includes(state.modal || '')) {
        state.modal = null;
        state.dragging = false;
      }
    },
    { flush: 'sync' },
  );
  watch(
    () => [state.selected, online.value, state.busy, state.detailEpoch],
    () => {
      if (!device.value || !online.value || state.busy || detailRequest === state.selected) return;
      const chosen = device.value,
        key = state.selected;
      detailRequest = key;
      void run(t('读取设备信息'), async () => {
        const result = await api.details(chosen);
        if (state.selected === key && online.value) state.details = result;
      });
    },
  );
  watch(
    () => state.component,
    () => {
      state.ownerCheck = undefined;
      state.consent = false;
      if (state.component) state.ownerExpanded = true;
    },
  );
  async function loadFiles(directory: string) {
    if (!device.value || !online.value) return;
    const chosen = device.value,
      key = state.selected;
    await run(t('读取目录'), async () => {
      const list = await api.listFiles(chosen, directory);
      if (state.selected === key && online.value) {
        state.files = list;
        state.file = undefined;
        state.path = state.pathInput = directory;
      }
    });
  }
  watch(
    () => [state.tab, online.value, state.busy, state.selected],
    () => {
      if (
        state.tab === 'files' &&
        online.value &&
        !state.busy &&
        detailRequest === state.selected &&
        filesLoaded !== state.selected
      ) {
        filesLoaded = state.selected;
        void loadFiles('/sdcard');
      }
    },
  );
  function acceptApk(apk: Apk) {
    state.apk = apk;
    state.component = apk.admins[0] || '';
  }
  function openInstall() {
    if (state.busy || (state.modal && state.modal !== 'install')) return false;
    state.notice = null;
    state.tab = 'apps';
    state.modal = 'install';
    return true;
  }
  function closeInstall() {
    if (state.busy) return;
    state.modal = null;
    state.dragging = false;
  }
  async function chooseApk() {
    if (!openInstall()) return;
    await run(t('读取安装包'), async () => {
      const next = await api.chooseApk();
      if (next) acceptApk(next);
    });
  }
  function dragEnter() {
    // 悬停只给出落点提示；真正松开后再打开弹窗，避免切页触发列表读取抢占拖放任务。
    if (!state.busy && (!state.modal || state.modal === 'install')) state.dragging = true;
  }
  async function drop(paths: string[]) {
    state.dragging = false;
    if (state.busy || (state.modal && state.modal !== 'install')) return;
    if (paths.length !== 1) {
      state.notice = { text: t('请一次拖入一个完整 APK。'), error: true };
      return;
    }
    if (!openInstall()) return;
    await run(t('读取安装包'), async () => acceptApk(await api.dropApk(paths[0])));
  }
  function select(d: Device) {
    if (!state.busy) {
      state.selected = targetKey(d);
      state.notice = null;
    }
  }
  function editName(d: Device) {
    state.renameDevice = d;
    state.name = state.snapshot?.settings.deviceNames[d.serial] || '';
    state.modal = 'rename';
  }
  const hide = (d: Device) =>
    run(t('移除设备'), async () => {
      await api.hide(d.serial);
      await refresh();
    });
  async function install() {
    if (!device.value || !state.apk || !online.value || state.modal !== 'install' || state.busy) return;
    const chosen = { ...device.value },
      apk = state.apk,
      ownerAfter = state.ownerAfter;
    await run(t('正在安装到 {name}', { name: title.value }), async () => {
      await api.install(chosen, apk.id, state.allowTest);
      // 安装期间断线或切换会话后，迟到结果不能关闭新弹窗或跳转到另一台设备的所有者设置。
      if (state.selected !== targetKey(chosen) || !online.value) return;
      state.modal = null;
      state.appsLoaded = false;
      appsRequested = '';
      if (ownerAfter) {
        state.component = apk.admins[0] || state.component;
        state.tab = 'info';
        state.ownerExpanded = true;
        state.consent = false;
        state.ownerCheck = undefined;
        state.notice = { text: t('安装成功并已核对版本。请检查设备所有者条件，并单独确认授权。') };
        return;
      }
      appsRequested = state.selected;
      state.notice = { text: t('安装成功，已核对设备上的安装版本。') };
      // 安装成功与列表刷新分开反馈，列表读取失败不能误报安装失败或自动重复安装。
      try {
        const list = await api.listApps(chosen);
        if (state.selected === targetKey(chosen) && online.value) {
          state.apps = list;
          state.appsLoaded = true;
        }
      } catch {
        if (state.selected === targetKey(chosen) && online.value)
          state.notice = { text: t('应用已安装，但列表刷新失败，请手动刷新。'), error: true };
      }
    });
  }
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
        detailRequest === state.selected &&
        appsRequested !== state.selected
      )
        void loadApps();
    },
  );
  async function openApp(app: InstalledApp) {
    if (!device.value || !online.value || state.busy) return;
    // 弹窗绑定打开时的设备和包名；确认动作不能从之后变化的选中行重新推导目标。
    const pending = {
      target: { ...device.value },
      deviceName: title.value,
      packageName: app.packageName,
      error: '',
      details: undefined as AppDetails | undefined,
    };
    state.application = pending;
    state.modal = 'app-details';
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
  async function checkOwner() {
    if (device.value)
      await run(t('检查设备所有者条件'), async () => {
        state.ownerCheck = await api.checkOwner(device.value!, state.component);
      });
  }
  async function setOwner() {
    if (!device.value || !state.consent || !state.ownerCheck?.canSet) return;
    const chosen = device.value;
    await run(
      t('设置设备所有者'),
      async () => {
        await api.setOwner(chosen, state.component, state.consent);
        state.details = await api.details(chosen);
        state.ownerCheck = undefined;
        state.consent = false;
      },
      t('设备所有者已设置并回读确认。'),
    );
  }
  async function saveModal() {
    await run(state.modal === 'rename' ? t('保存备注') : t('创建文件夹'), async () => {
      if (state.modal === 'rename' && state.renameDevice) {
        await api.rename(state.renameDevice.serial, state.name);
        await refresh();
      } else if (state.modal === 'folder' && device.value) {
        await api.mkdir(device.value, state.path, state.name);
        state.files = await api.listFiles(device.value, state.path);
      }
      state.modal = null;
    });
  }
  function shortcut(e: KeyboardEvent) {
    if (!(e.metaKey || e.ctrlKey) || state.modal || state.busy) return;
    const key = e.key.toLowerCase();
    if (['o', 'r', 'l', ','].includes(key)) e.preventDefault();
    if (key === 'o') void chooseApk();
    if (key === 'r')
      void (state.tab === 'files'
        ? loadFiles(state.path)
        : state.tab === 'apps'
          ? loadApps()
          : refresh(true));
    if (key === 'l') state.modal = 'connect';
    if (key === ',') state.modal = 'settings';
  }
  const resize = () => {
    state.viewport = window.innerWidth;
  };
  function start() {
    void refresh();
    timer = setInterval(() => {
      if (!state.busy && !state.modal) void refresh();
    }, 5000);
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', shortcut);
  }
  function dispose() {
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
    refresh,
    loadFiles,
    loadApps,
    openApp,
    uninstallApp,
    openInstall,
    closeInstall,
    chooseApk,
    dragEnter,
    drop,
    select,
    editName,
    hide,
    install,
    checkOwner,
    setOwner,
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
