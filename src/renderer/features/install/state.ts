import { watch } from 'vue';
import { t } from '../../../shared/i18n';
import { targetKey, type Apk, type Target } from '../../../shared/contracts';
import type { FeatureContext } from '../../lib/workspace';
export function installState() {
  return { apk: undefined as Apk | undefined, allowTest: false, dragging: false };
}
interface Hooks {
  acceptApk(apk: Apk): void;
  ownerAfter(): boolean;
  installed(target: Target, apk: Apk, ownerAfter: boolean): Promise<void>;
}
/** 安装流程只负责 APK 和确认会话，完成后的列表刷新/所有者引导由工作区编排。 */
export function createInstall(
  { state, api, device, online, title, run }: FeatureContext<ReturnType<typeof installState>>,
  hooks: Hooks,
) {
  watch(
    () => [state.selected, online.value],
    () => {
      if (state.modal === 'install') state.modal = null;
      state.dragging = false;
    },
    { flush: 'sync' },
  );
  function acceptApk(apk: Apk) {
    state.apk = apk;
    hooks.acceptApk(apk);
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

  async function install() {
    if (!device.value || !state.apk || !online.value || state.modal !== 'install' || state.busy) return;
    const target = { ...device.value },
      apk = state.apk,
      ownerAfter = hooks.ownerAfter();
    await run(t('正在安装到 {name}', { name: title.value }), async () => {
      await api.install(target, apk.id, state.allowTest);
      if (state.selected !== targetKey(target) || !online.value) return;
      state.modal = null;
      await hooks.installed(target, apk, ownerAfter);
    });
  }
  return { openInstall, closeInstall, chooseApk, dragEnter, drop, install };
}
