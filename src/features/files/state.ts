import { createContext } from '@/shared/composables/context';
import { watch, reactive } from 'vue';
import { t } from '@/shared/i18n/index';
import { type DeviceFile } from '@/shared/api/types';
import { targetKey } from '@/shared/utils/device';
import type { FeatureContext } from '@/shared/composables/workspace';
export function filesState() {
  return {
    path: '/sdcard',
    pathInput: '/sdcard',
    files: [] as DeviceFile[],
    file: undefined as DeviceFile | undefined,
  };
}
/** 目录列表仅在当前会话发布，首次进入与手动刷新使用同一读取流程。 */
export function createFiles({ state: workspace, api, device, online, run, detailsReady }: FeatureContext) {
  const state = reactive(filesState());
  let filesLoaded = '';
  watch(
    () => [workspace.selected, online.value],
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
      key = workspace.selected;
    await run(t('读取目录'), async () => {
      const list = await api.listFiles(chosen, directory);
      if (workspace.selected === key && online.value) {
        state.files = list;
        state.file = undefined;
        state.path = state.pathInput = directory;
      }
    });
  }
  watch(
    () => [workspace.tab, online.value, workspace.busy, workspace.selected],
    () => {
      if (
        workspace.tab === 'files' &&
        online.value &&
        !workspace.busy &&
        detailsReady() &&
        filesLoaded !== workspace.selected
      ) {
        filesLoaded = workspace.selected;
        void loadFiles('/sdcard');
      }
    },
  );

  async function createFolder() {
    if (!device.value || !online.value) return;
    const target = { ...device.value },
      directory = state.path,
      name = workspace.name;
    await run(t('创建文件夹'), async () => {
      await api.mkdir(target, directory, name);
      const list = await api.listFiles(target, directory);
      if (workspace.selected === targetKey(target) && online.value) {
        state.files = list;
        workspace.modal = null;
      }
    });
  }
  return { state, loadFiles, createFolder };
}

export const { key: filesKey, use: useFiles } = createContext<ReturnType<typeof createFiles>>('files');
