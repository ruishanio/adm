import { watch } from 'vue';
import { t } from '../../../shared/i18n';
import { targetKey, type DeviceFile } from '../../../shared/contracts';
import type { FeatureContext } from '../../lib/workspace';
export function filesState() {
  return {
    path: '/sdcard',
    pathInput: '/sdcard',
    files: [] as DeviceFile[],
    file: undefined as DeviceFile | undefined,
  };
}
/** 目录列表仅在当前会话发布，首次进入与手动刷新使用同一读取流程。 */
export function createFiles({
  state,
  api,
  device,
  online,
  run,
  detailsReady,
}: FeatureContext<ReturnType<typeof filesState>>) {
  let filesLoaded = '';
  watch(
    () => [state.selected, online.value],
    () => {
      filesLoaded = '';
      state.files = [];
      state.file = undefined;
      state.path = state.pathInput = '/sdcard';
    },
    { flush: 'sync' },
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
        detailsReady() &&
        filesLoaded !== state.selected
      ) {
        filesLoaded = state.selected;
        void loadFiles('/sdcard');
      }
    },
  );

  async function createFolder() {
    if (!device.value || !online.value) return;
    const target = { ...device.value },
      directory = state.path,
      name = state.name;
    await run(t('创建文件夹'), async () => {
      await api.mkdir(target, directory, name);
      const list = await api.listFiles(target, directory);
      if (state.selected === targetKey(target) && online.value) {
        state.files = list;
        state.modal = null;
      }
    });
  }
  return { loadFiles, createFolder };
}
