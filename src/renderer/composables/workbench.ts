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
} from '../../shared/contracts';
type Tab = 'info' | 'install' | 'files';
export function createWorkbench(api: Api) {
  const state = reactive({
    snapshot: undefined as Snapshot | undefined,
    selected: '',
    tab: 'info' as Tab,
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
    modal: null as 'connect' | 'settings' | 'rename' | 'folder' | null,
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
    device.value ? deviceName(device.value, state.snapshot?.settings) : '选择一台设备',
  );
  const sidebar = computed(() => Math.min(state.width, Math.max(220, state.viewport - 645)));
  let initial = true,
    refreshing = false,
    detailRequest = '',
    filesLoaded = '';
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
        initial = false;
        state.width = state.snapshot.settings.sidebarWidth;
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
      void run('读取设备信息', async () => {
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
    await run('读取目录', async () => {
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
    state.tab = 'install';
  }
  const chooseApk = () =>
    run('读取安装包', async () => {
      const next = await api.chooseApk();
      if (next) acceptApk(next);
    });
  async function drop(paths: string[]) {
    state.dragging = false;
    if (state.busy || state.modal) return;
    if (paths.length !== 1) {
      state.notice = { text: '请一次拖入一个完整 APK。', error: true };
      return;
    }
    await run('读取安装包', async () => acceptApk(await api.dropApk(paths[0])));
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
    run('移除设备', async () => {
      await api.hide(d.serial);
      await refresh();
    });
  async function install() {
    if (!device.value || !state.apk || !online.value) return;
    const chosen = device.value,
      apk = state.apk;
    await run(
      '正在安装到 ' + title.value,
      async () => {
        await api.install(chosen, apk.id, state.allowTest);
        if (state.ownerAfter) {
          state.component = apk.admins[0] || state.component;
          state.tab = 'info';
          state.ownerExpanded = true;
          state.consent = false;
          state.ownerCheck = undefined;
        }
      },
      state.ownerAfter
        ? '安装成功并已核对版本。请检查设备所有者条件，并单独确认授权。'
        : '安装成功，已核对设备上的安装版本。',
    );
  }
  async function checkOwner() {
    if (device.value)
      await run('检查设备所有者条件', async () => {
        state.ownerCheck = await api.checkOwner(device.value!, state.component);
      });
  }
  async function setOwner() {
    if (!device.value || !state.consent || !state.ownerCheck?.canSet) return;
    const chosen = device.value;
    await run(
      '设置设备所有者',
      async () => {
        await api.setOwner(chosen, state.component, state.consent);
        state.details = await api.details(chosen);
        state.ownerCheck = undefined;
        state.consent = false;
      },
      '设备所有者已设置并回读确认。',
    );
  }
  async function saveModal() {
    await run(state.modal === 'rename' ? '保存备注' : '创建文件夹', async () => {
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
    if (key === 'r') void (state.tab === 'files' ? loadFiles(state.path) : refresh(true));
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
    chooseApk,
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
  if (!value) throw new Error('工作台尚未初始化');
  return value;
}
