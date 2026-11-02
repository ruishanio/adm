import { t } from '../../shared/i18n';
import { invoke } from '@tauri-apps/api/core';
import type { Api, Target } from '../../shared/contracts';
// 只传递后端允许的会话字段，不把 Vue 代理或设备展示属性发送到 IPC。
const target = (t: Target): Target => ({ serial: t.serial, transportId: t.transportId });
async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  try {
    return await invoke<T>('adm_call', { method, args });
  } catch (error) {
    throw new Error(
      typeof error === 'string' ? error : error instanceof Error ? error.message : t('操作失败，请重试。'),
    );
  }
}
// 前端仅暴露业务调用；本地路径、ADB 进程与文件读写均由 Rust 校验并执行。
export const api: Api = {
  startLogcat: (t) => call('startLogcat', target(t)),
  readLogcat: (id, after) => call('readLogcat', id, after),
  stopLogcat: (id) => call('stopLogcat', id),
  logcatApps: (t) => call('logcatApps', target(t)),
  exportLogcat: (id, filter, through) => call('exportLogcat', id, { ...filter }, through),
  openThirdPartyNotices: () => call('openThirdPartyNotices'),
  refresh: () => call('refresh'),
  details: (t) => call('details', target(t)),
  connect: (address) => call('connect', address),
  pair: (address, code) => call('pair', address, code),
  chooseApk: () => call('chooseApk'),
  dropApk: (path) => call('inspectApk', path),
  install: (t, id, allow) => call('install', target(t), id, allow),
  listApps: (t) => call('listApps', target(t)),
  appDetails: (t, packageName) => call('appDetails', target(t), packageName),
  uninstallApp: (t, packageName, versionCode, consent) =>
    call('uninstallApp', target(t), packageName, versionCode, consent),
  checkOwner: (t, c) => call('checkOwner', target(t), c),
  setOwner: (t, c, consent) => call('setOwner', target(t), c, consent),
  listFiles: (t, path) => call('listFiles', target(t), path),
  upload: (t, path, kind) => call('upload', target(t), path, kind),
  renameFile: (t, directory, name, next) => call('renameFile', target(t), directory, name, next),
  deleteFile: (t, directory, name, consent) => call('deleteFile', target(t), directory, name, consent),
  download: (t, path) => call('download', target(t), path),
  mkdir: (t, path, name) => call('mkdir', target(t), path, name),
  copySerial: (serial) => call('copySerial', serial),
  rename: (serial, name) => call('rename', serial, name),
  hide: (serial) => call('hide', serial),
  restore: () => call('restore'),
  chooseAdb: () => call('chooseAdb'),
  resetAdb: () => call('resetAdb'),
  sidebarWidth: (width) => call('sidebarWidth', width),
  language: (value) => call('language', value),
  cancel: () => call('cancel'),
};
