import { watch } from 'vue';
import { t, setLanguage, resolveLocale } from '../../../shared/i18n';
import { targetKey, type Device, type Details, type Snapshot } from '../../../shared/contracts';
import type { FeatureContext } from '../../lib/workspace';
export function devicesState() {
  return {
    snapshot: undefined as Snapshot | undefined,
    details: undefined as Details | undefined,
    detailEpoch: 0,
    renameDevice: undefined as Device | undefined,
  };
}
/** 设备发现、详情与偏好迁移共用传输身份；刷新失败不发布上一次设备的详情。 */
export function createDevices({
  state,
  api,
  device,
  online,
  run,
}: FeatureContext<ReturnType<typeof devicesState>>) {
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
      detailRequest = '';
      state.details = undefined;
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

  async function saveName() {
    if (!state.renameDevice) return;
    await run(t('保存备注'), async () => {
      await api.rename(state.renameDevice!.serial, state.name);
      await refresh();
      state.modal = null;
    });
  }
  return { refresh, select, editName, hide, saveName, detailsReady: () => detailRequest === state.selected };
}
