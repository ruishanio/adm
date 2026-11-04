import { createContext } from '@/shared/composables/context';
import { watch, reactive, computed } from 'vue';
import { t, setLanguage, resolveLocale } from '@/shared/i18n/index';
import { type Device, type Details, type Snapshot } from '@/shared/api/types';
import { deviceName, targetKey } from '@/shared/utils/device';
import { groupDevices, rowKey } from './groups';
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
  const rows = computed(() => groupDevices(state.snapshot?.devices ?? []));
  const device = computed(() =>
    state.snapshot?.devices.find((item) => targetKey(item) === workspace.selected),
  );
  const online = computed(() => device.value?.state === 'device');
  function remark(d: Device) {
    const names = state.snapshot?.settings.deviceNames;
    if (!names) return '';
    const row = rows.value.find(({ primary }) => rowKey(primary) === rowKey(d));
    return (
      [row?.primary ?? d, ...(row?.members ?? [])]
        .map(({ serial }) => (Object.hasOwn(names, serial) ? names[serial] : ''))
        .find(Boolean) || ''
    );
  }
  const displayName = (d: Device) => remark(d) || deviceName(d);
  const title = computed(() => (device.value ? displayName(device.value) : t('选择一台设备')));
  let initial = true,
    refreshing = false,
    detailRequest = '';
  async function refresh(reloadDetails = false) {
    if (refreshing) return;
    refreshing = true;
    try {
      const next = await api.refresh();
      const previous = device.value;
      // 当前传输消失时，只接回上一轮已经核实、且传输编号未变的同机连接。
      const siblings = previous?.networkBootId
        ? state.snapshot?.devices.filter(
            (d) => rowKey(d) === rowKey(previous) && targetKey(d) !== workspace.selected,
          )
        : undefined;
      state.snapshot = next;
      if (siblings?.length && !online.value) {
        const remaining = next.devices.find(
          (d) =>
            d.state === 'device' &&
            d.networkBootId === previous?.networkBootId &&
            siblings.some((sibling) => targetKey(sibling) === targetKey(d)),
        );
        if (remaining) workspace.selected = targetKey(remaining);
      }
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
        const first = rows.value.find((row) => row.primary.state === 'device')?.primary;
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
    workspace.name = remark(d);
    workspace.modal = 'rename';
  }
  const hide = (d: Device) =>
    run(t('移除设备'), async () => {
      await api.hide(d.serial);
      await refresh();
    });

  function disconnect(members: Device[]) {
    if (!members.length || !members.every((d) => d.network && d.state === 'device')) return;
    return run(t('断开连接'), async () => {
      try {
        // 只断开菜单所属行的具体会话，其他设备的网络连接继续工作。
        for (const member of members) await api.disconnect(member);
        if (members.some((d) => workspace.selected === targetKey(d))) workspace.selected = '';
      } finally {
        await refresh();
      }
    });
  }

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
    rows,
    displayName,
    device,
    online,
    title,
    refresh,
    select,
    editName,
    hide,
    disconnect,
    saveName,
    detailsReady: () => detailRequest === workspace.selected,
  };
}

export const { key: devicesKey, use: useDevices } =
  createContext<ReturnType<typeof createDevices>>('devices');
