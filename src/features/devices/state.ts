import { createContext } from '@/shared/composables/context';
import { watch, reactive, computed } from 'vue';
import { t, setLanguage, resolveLocale } from '@/shared/i18n/index';
import { type Device, type Details, type Snapshot } from '@/shared/api/types';
import { deviceName } from '@/shared/utils/device';
import { targetKey } from '@/shared/utils/device';
import type { WorkspaceCore } from '@/shared/composables/workspace';
export function devicesState() {
  return {
    snapshot: undefined as Snapshot | undefined,
    details: undefined as Details | undefined,
    detailEpoch: 0,
    renameDevice: undefined as Device | undefined,
  };
}
/** 设备发现、详情与偏好迁移共用传输身份；刷新失败不发布上一次设备的详情。 */
export function createDevices({ state: workspace, api, run }: WorkspaceCore) {
  const state = reactive(devicesState());
  const device = computed(() =>
    state.snapshot?.devices.find((item) => targetKey(item) === workspace.selected),
  );
  const online = computed(() => device.value?.state === 'device');
  const title = computed(() =>
    device.value ? deviceName(device.value, state.snapshot?.settings) : t('选择一台设备'),
  );
  let initial = true,
    refreshing = false,
    detailRequest = '';
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
        workspace.width = state.snapshot.settings.sidebarWidth;
        if (savedLanguage !== resolvedLanguage) {
          // 原生任务互斥：先完成偏好迁移，再选中设备触发详情读取，避免启动时两个 IPC 抢占任务。
          await api.language(resolvedLanguage);
          state.snapshot.settings.language = resolvedLanguage;
        }
        const first = state.snapshot.devices.find((d) => d.state === 'device');
        if (first) workspace.selected = targetKey(first);
      }
      if (reloadDetails) {
        detailRequest = '';
        state.detailEpoch++;
      }
      if (state.snapshot.error) workspace.notice = { text: state.snapshot.error, error: true };
    } catch (error) {
      workspace.notice = { text: String(error), error: true };
    } finally {
      refreshing = false;
    }
  }

  watch(
    () => [workspace.selected, online.value],
    () => {
      detailRequest = '';
      state.details = undefined;
    },
    { flush: 'sync' },
  );
  watch(
    () => [workspace.selected, online.value, workspace.busy, state.detailEpoch],
    () => {
      if (!device.value || !online.value || workspace.busy || detailRequest === workspace.selected) return;
      const chosen = device.value,
        key = workspace.selected;
      detailRequest = key;
      void run(t('读取设备信息'), async () => {
        const result = await api.details(chosen);
        if (workspace.selected === key && online.value) state.details = result;
      });
    },
  );
  function select(d: Device) {
    if (!workspace.busy) {
      workspace.selected = targetKey(d);
      workspace.notice = null;
    }
  }
  function editName(d: Device) {
    state.renameDevice = d;
    workspace.name = state.snapshot?.settings.deviceNames[d.serial] || '';
    workspace.modal = 'rename';
  }
  const hide = (d: Device) =>
    run(t('移除设备'), async () => {
      await api.hide(d.serial);
      await refresh();
    });

  async function saveName() {
    if (!state.renameDevice) return;
    await run(t('保存备注'), async () => {
      await api.rename(state.renameDevice!.serial, workspace.name);
      await refresh();
      workspace.modal = null;
    });
  }
  return {
    state,
    device,
    online,
    title,
    refresh,
    select,
    editName,
    hide,
    saveName,
    detailsReady: () => detailRequest === workspace.selected,
  };
}

export const { key: devicesKey, use: useDevices } =
  createContext<ReturnType<typeof createDevices>>('devices');
