import { t } from '@/shared/i18n/index';
import { invoke, Channel } from '@tauri-apps/api/core';
import type { Api, Target } from '@/shared/api/types';
// 只传递后端允许的会话字段，不把 Vue 代理或设备展示属性发送到 IPC。
const target = (t: Target): Target => ({ serial: t.serial, transportId: t.transportId });
// 命令名、参数顺序和返回值统一由业务协议约束，拒绝字符串拼写错误或错传参数。
type Commands = Omit<Api, 'dropApk' | 'startControl'> & { inspectApk: Api['dropApk'] };
async function call<K extends keyof Commands>(
  method: K,
  ...args: Parameters<Commands[K]>
): Promise<Awaited<ReturnType<Commands[K]>>> {
  try {
    return await invoke<Awaited<ReturnType<Commands[K]>>>('adm_call', { method, args });
  } catch (error) {
    throw new Error(
      typeof error === 'string' ? error : error instanceof Error ? error.message : t('操作失败，请重试。'),
    );
  }
}
// 前端仅暴露业务调用；本地路径、ADB 进程与文件读写均由 Rust 校验并执行。
export const api: Api = {
  startControl: (t, maxSize, onPacket) => {
    const video = new Channel<ArrayBuffer>();
    video.onmessage = onPacket;
    return invoke<string>('adm_control_start', { target: target(t), maxSize, video });
  },
  stopControl: (id) => call('stopControl', id),
  controlStatus: (id) => call('controlStatus', id),
  controlAck: (id, seq) => call('controlAck', id, seq),
  controlInput: (id, input) => call('controlInput', id, input),
  controlScreenshot: (id) => call('controlScreenshot', id),
  controlRecord: (id) => call('controlRecord', id),
  controlStopRecording: (id) => call('controlStopRecording', id),
  controlPower: (id, action, consent) => call('controlPower', id, action, consent),
  startPerformance: (t) => call('startPerformance', target(t)),
  samplePerformance: (id, packageName) => call('samplePerformance', id, packageName),
  stopPerformance: (id) => call('stopPerformance', id),
  startLogcat: (t) => call('startLogcat', target(t)),
  readLogcat: (id, after) => call('readLogcat', id, after),
  stopLogcat: (id) => call('stopLogcat', id),
  logcatApps: (t) => call('logcatApps', target(t)),
  exportLogcat: (id, filter, through) => call('exportLogcat', id, { ...filter }, through),
  refresh: () => call('refresh'),
  details: (t) => call('details', target(t)),
  connect: (address) => call('connect', address),
  pair: (address, code) => call('pair', address, code),
  chooseApk: () => call('chooseApk'),
  dropApk: (path) => call('inspectApk', path),
  install: (t, id) => call('install', target(t), id),
  listApps: (t) => call('listApps', target(t)),
  appDetails: (t, packageName) => call('appDetails', target(t), packageName),
  appIcons: (t, packages) => call('appIcons', target(t), packages),
  appRunning: (t) => call('appRunning', target(t)),
  appAction: (t, packageName, versionCode, action, consent) =>
    call('appAction', target(t), packageName, versionCode, action, consent),
  copyPackage: (packageName) => call('copyPackage', packageName),
  uninstallApp: (t, packageName, versionCode, consent) =>
    call('uninstallApp', target(t), packageName, versionCode, consent),
  checkOwner: (t, c) => call('checkOwner', target(t), c),
  scanDeviceAdmins: (t) => call('scanDeviceAdmins', target(t)),
  setOwner: (t, c, consent) => call('setOwner', target(t), c, consent),
  checkOwnerRemoval: (t, c) => call('checkOwnerRemoval', target(t), c),
  removeOwner: (t, c, consent) => call('removeOwner', target(t), c, consent),
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
