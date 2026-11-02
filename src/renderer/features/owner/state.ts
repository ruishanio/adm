import { watch } from 'vue';
import { t } from '../../../shared/i18n';
import { targetKey, type OwnerCheck, type Details } from '../../../shared/contracts';
import type { FeatureContext } from '../../lib/workspace';
export function ownerState() {
  return {
    component: '',
    ownerCheck: undefined as OwnerCheck | undefined,
    consent: false,
    ownerAfter: false,
    ownerExpanded: false,
  };
}
/** 所有者授权只属于当前设备和组件；断线、修改组件或迟到请求均不能沿用旧授权。 */
export function createOwner(
  { state, api, device, online, run }: FeatureContext<ReturnType<typeof ownerState>>,
  onDetails: (details: Details) => void,
) {
  watch(
    () => [state.selected, online.value],
    () => {
      state.ownerCheck = undefined;
      state.consent = false;
    },
    { flush: 'sync' },
  );
  watch(
    () => state.component,
    () => {
      state.ownerCheck = undefined;
      state.consent = false;
      if (state.component) state.ownerExpanded = true;
    },
  );
  async function checkOwner() {
    if (device.value)
      await run(t('检查设备所有者条件'), async () => {
        const chosen = { ...device.value! },
          component = state.component;
        const check = await api.checkOwner(chosen, component);
        if (state.selected === targetKey(chosen) && online.value && state.component === component)
          state.ownerCheck = check;
      });
  }
  async function setOwner() {
    if (!device.value || !state.consent || !state.ownerCheck?.canSet) return;
    const chosen = device.value;
    await run(
      t('设置设备所有者'),
      async () => {
        await api.setOwner(chosen, state.component, state.consent);
        const details = await api.details(chosen);
        if (state.selected !== targetKey(chosen) || !online.value) return;
        onDetails(details);
        state.ownerCheck = undefined;
        state.consent = false;
      },
      t('设备所有者已设置并回读确认。'),
    );
  }

  function prepare(component: string) {
    state.component = component;
    state.ownerExpanded = true;
    state.consent = false;
    state.ownerCheck = undefined;
  }
  return { checkOwner, setOwner, prepare };
}
