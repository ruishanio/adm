import { createContext } from '@/shared/composables/context';
import { watch, reactive, ref } from 'vue';
import { t } from '@/shared/i18n/index';
import {
  type OwnerCheck,
  type OwnerRemovalCheck,
  type Details,
  type Target,
  type DeviceAdmin,
} from '@/shared/api/types';
import { targetKey } from '@/shared/utils/device';
import type { FeatureContext } from '@/shared/composables/workspace';
export function ownerState() {
  return {
    component: '',
    ownerCheck: undefined as OwnerCheck | undefined,
    consent: false,
    ownerExpanded: false,
    error: '',
    scan: undefined as { loading: boolean; admins: DeviceAdmin[]; error: string } | undefined,
    setting: undefined as
      { target: Target; component: string; deviceName: string; error: string } | undefined,
    removal: undefined as
      | { target: Target; component: string; deviceName: string; check?: OwnerRemovalCheck; error?: string }
      | undefined,
  };
}
/** 所有者授权只属于当前设备和组件；断线、修改组件或迟到请求均不能沿用旧授权。 */
export function createOwner(
  { state: workspace, api, device, online, title, run }: FeatureContext,
  onDetails: (details: Details) => void,
  currentOwner: () => string | null | undefined,
) {
  const state = reactive(ownerState());
  const scanRequested = ref(false);
  watch(
    () => [workspace.selected, online.value],
    () => {
      state.ownerCheck = undefined;
      state.consent = false;
      state.error = '';
      state.scan = undefined;
      closeSetting();
      closeRemoval();
    },
    { flush: 'sync' },
  );
  // 展开或切换到新的设备时只排队一次；等详情和其他任务结束，避免扫描与读取详情抢占任务锁。
  watch(
    () => [state.ownerExpanded, workspace.selected, online.value, currentOwner()],
    () => {
      scanRequested.value = state.ownerExpanded && online.value && currentOwner() === null;
    },
    { flush: 'sync' },
  );
  watch(
    () => [scanRequested.value, workspace.busy, workspace.modal, workspace.tab],
    () => {
      if (scanRequested.value && !workspace.busy && !workspace.modal && workspace.tab === 'info')
        void scanDeviceAdmins();
    },
  );
  async function scanDeviceAdmins() {
    if (!device.value || !online.value || workspace.busy || workspace.modal || currentOwner() !== null)
      return;
    scanRequested.value = false;
    const chosen = { ...device.value };
    state.ownerCheck = undefined;
    state.consent = false;
    // 刷新时保留原列表占位，控件由任务锁禁用，避免表单收缩造成滚动位置跳动。
    state.scan = { loading: true, admins: state.scan?.admins || [], error: '' };
    const pending = state.scan;
    // 每次扫描绑定当前会话；切换后再切回来，也不能接收上一轮已经失效的结果。
    await run(t('扫描设备管理应用'), async () => {
      try {
        const admins = await api.scanDeviceAdmins(chosen);
        if (state.scan === pending && workspace.selected === targetKey(chosen) && online.value)
          pending.admins = admins;
      } catch (error) {
        if (state.scan === pending) {
          pending.admins = [];
          pending.error = error instanceof Error ? error.message : String(error);
        }
      } finally {
        if (state.scan === pending) pending.loading = false;
      }
    });
  }
  function selectDeviceAdmin(component: string) {
    if (workspace.busy || !online.value || !state.scan?.admins.some((item) => item.component === component))
      return;
    // 选择只填写组件，不替代检查；即使重复选择同一项，也需要重新确认授权。
    prepare(component);
  }
  watch(
    () => state.component,
    () => {
      state.ownerCheck = undefined;
      state.consent = false;
      state.error = '';
      closeSetting();
      if (state.component) state.ownerExpanded = true;
    },
    { flush: 'sync' },
  );
  watch(
    currentOwner,
    () => {
      state.ownerCheck = undefined;
      state.consent = false;
      closeSetting();
      if (state.removal && currentOwner() !== state.removal.component) closeRemoval();
    },
    { flush: 'sync' },
  );
  async function checkOwner() {
    if (device.value && online.value && !workspace.busy) {
      state.error = '';
      state.ownerCheck = undefined;
      state.consent = false;
      await run(t('检查设备所有者条件'), async () => {
        const chosen = { ...device.value! },
          component = state.component;
        try {
          const check = await api.checkOwner(chosen, component);
          if (workspace.selected === targetKey(chosen) && online.value && state.component === component)
            state.ownerCheck = check;
        } catch (error) {
          if (workspace.selected === targetKey(chosen) && online.value && state.component === component)
            state.error = error instanceof Error ? error.message : String(error);
        }
      });
    }
  }
  function closeSetting() {
    if (workspace.modal === 'owner-set') workspace.modal = null;
    state.setting = undefined;
    state.consent = false;
  }
  function openSetting() {
    if (
      !device.value ||
      !online.value ||
      !state.ownerCheck?.canSet ||
      currentOwner() !== null ||
      workspace.busy ||
      workspace.modal
    )
      return;
    state.setting = {
      target: { ...device.value },
      component: state.component,
      deviceName: title.value,
      error: '',
    };
    state.consent = false;
    workspace.modal = 'owner-set';
  }
  async function setOwner() {
    const pending = state.setting;
    if (
      !pending ||
      workspace.modal !== 'owner-set' ||
      workspace.selected !== targetKey(pending.target) ||
      state.component !== pending.component ||
      !online.value ||
      !state.consent ||
      !state.ownerCheck?.canSet ||
      currentOwner() !== null ||
      workspace.busy
    )
      return;
    pending.error = '';
    // 最终授权绑定打开弹窗时的目标和组件，不读取后来变化的表单；后端仍执行前置重查及回读。
    await run(t('设置设备所有者'), async () => {
      try {
        await api.setOwner(pending.target, pending.component, true);
        const details = await api.details(pending.target);
        if (state.setting !== pending || !online.value) return;
        closeSetting();
        onDetails(details);
        state.ownerCheck = undefined;
        state.consent = false;
        workspace.notice = { text: t('设备所有者已设置并回读确认。') };
      } catch (error) {
        if (state.setting === pending && online.value) {
          pending.error = error instanceof Error ? error.message : String(error);
          state.ownerCheck = undefined;
          state.consent = false;
        }
      }
    });
  }

  function closeRemoval() {
    if (workspace.modal === 'owner-remove') workspace.modal = null;
    state.removal = undefined;
  }
  async function openRemoval() {
    const component = currentOwner();
    if (!device.value || !online.value || !component || workspace.busy) return;
    state.removal = { target: { ...device.value }, component, deviceName: title.value };
    workspace.modal = 'owner-remove';
    const pending = state.removal;
    await run(t('检查移除条件'), async () => {
      try {
        const check = await api.checkOwnerRemoval(pending.target, pending.component);
        if (state.removal === pending) pending.check = check;
      } catch (error) {
        if (state.removal === pending) pending.error = error instanceof Error ? error.message : String(error);
      }
    });
  }
  async function removeOwner() {
    const pending = state.removal;
    if (
      !pending?.check?.canRemove ||
      workspace.busy ||
      !online.value ||
      workspace.selected !== targetKey(pending.target) ||
      currentOwner() !== pending.component
    )
      return;
    pending.error = '';
    // 弹窗绑定打开时的传输会话和组件；确认不能转用后来选中的设备或所有者。
    await run(t('移除设备所有者'), async () => {
      try {
        await api.removeOwner(pending.target, pending.component, true);
        const details = await api.details(pending.target);
        if (state.removal !== pending || !online.value) return;
        closeRemoval();
        onDetails(details);
        state.consent = false;
        state.ownerCheck = undefined;
        workspace.notice = { text: t('设备所有者已移除并回读确认。') };
      } catch (error) {
        if (state.removal === pending) pending.error = error instanceof Error ? error.message : String(error);
      }
    });
  }

  function prepare(component: string) {
    closeSetting();
    state.component = component;
    state.ownerExpanded = true;
    state.consent = false;
    state.ownerCheck = undefined;
  }
  return {
    state,
    checkOwner,
    setOwner,
    openSetting,
    closeSetting,
    prepare,
    openRemoval,
    closeRemoval,
    removeOwner,
    scanDeviceAdmins,
    selectDeviceAdmin,
  };
}

export const { key: ownerKey, use: useOwner } = createContext<ReturnType<typeof createOwner>>('owner');
