import { ref, watch } from 'vue';
import { t } from '@/shared/i18n/index';
import { type Target, type DeviceFile } from '@/shared/api/types';
import { targetKey } from '@/shared/utils/device';
import type { FeatureContext } from '@/shared/composables/workspace';
import type { filesState } from '@/features/files/state';
/** 文件确认绑定打开时的设备、目录与文件，断连或切换设备时撤销待操作目标。 */
export function useFileActions(
  w: Pick<FeatureContext, 'state' | 'api' | 'device' | 'online' | 'run'>,
  fileState: ReturnType<typeof filesState>,
) {
  const s = w.state;
  async function upload(kind: 'files' | 'folders') {
    if (!w.device.value) return;
    const target = { ...w.device.value },
      directory = fileState.path;
    await w.run(t('上传'), async () => {
      try {
        if (await w.api.upload(target, directory, kind)) s.notice = { text: t('上传完成。') };
      } finally {
        // 批量上传允许部分成功；失败或取消后也重新读取，避免列表隐藏已完成的项目。
        const files = await w.api.listFiles(target, directory);
        if (s.selected === targetKey(target) && w.online.value && fileState.path === directory)
          fileState.files = files;
      }
    });
  }
  async function download() {
    if (w.device.value && fileState.file?.type === 'file')
      await w.run(t('下载文件'), async () => {
        if (await w.api.download(w.device.value!, fileState.file!.path)) s.notice = { text: t('下载完成。') };
      });
  }
  const pending = ref<{ target: Target; directory: string; file: DeviceFile }>();
  const nextName = ref(''),
    actionError = ref('');
  function canModify(file: DeviceFile) {
    return !s.busy && fileState.path !== '/' && (file.type === 'file' || file.type === 'directory');
  }
  function fileAction(file: DeviceFile, action: 'file-rename' | 'file-delete') {
    if (!w.device.value || !canModify(file)) return;
    // 记录打开菜单时的设备会话和目录，提交时不从可能变化的列表选中项推导目标。
    pending.value = { target: { ...w.device.value }, directory: fileState.path, file: { ...file } };
    fileState.file = file;
    nextName.value = file.name;
    actionError.value = '';
    s.modal = action;
  }
  async function submitAction() {
    const operation = pending.value,
      action = s.modal;
    if (
      !operation ||
      s.selected !== targetKey(operation.target) ||
      !w.online.value ||
      (action !== 'file-rename' && action !== 'file-delete') ||
      s.busy
    )
      return;
    const { target, directory, file } = operation;
    actionError.value = '';
    await w.run(action === 'file-rename' ? t('重命名') : t('删除'), async () => {
      try {
        if (action === 'file-rename') await w.api.renameFile(target, directory, file.name, nextName.value);
        else await w.api.deleteFile(target, directory, file.name, true);
        if (s.selected !== targetKey(target) || !w.online.value) return;
        s.modal = null;
        fileState.file = undefined;
        const files = await w.api.listFiles(target, directory);
        if (s.selected === targetKey(target) && w.online.value && fileState.path === directory)
          fileState.files = files;
        s.notice = { text: action === 'file-rename' ? t('重命名完成。') : t('删除完成。') };
      } catch (error) {
        actionError.value = error instanceof Error ? error.message : String(error);
        throw error;
      }
    });
  }

  watch(
    () => [s.selected, w.online.value],
    () => {
      pending.value = undefined;
      actionError.value = '';
      if (s.modal === 'file-rename' || s.modal === 'file-delete') s.modal = null;
    },
    { flush: 'sync' },
  );
  return { upload, download, pending, nextName, actionError, canModify, fileAction, submitAction };
}
