import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { Api, Result } from '../shared/contracts';
async function invoke<T>(name: string, ...args: unknown[]): Promise<T> {
  const result: Result<T> = await ipcRenderer.invoke('tool:' + name, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
// 暴露固定的业务方法，不暴露 ipcRenderer、文件系统或通用命令执行接口。
const api: Api = {
  refresh: () => invoke('refresh'),
  details: (d) => invoke('details', d),
  connect: (a) => invoke('connect', a),
  pair: (a, c) => invoke('pair', a, c),
  chooseApk: () => invoke('chooseApk'),
  dropApk: (file) => invoke('inspectApk', webUtils.getPathForFile(file)),
  install: (d, id, allow) => invoke('install', d, id, allow),
  checkOwner: (d, c) => invoke('checkOwner', d, c),
  setOwner: (d, c, consent) => invoke('setOwner', d, c, consent),
  listFiles: (d, p) => invoke('listFiles', d, p),
  upload: (d, p) => invoke('upload', d, p),
  download: (d, p) => invoke('download', d, p),
  mkdir: (d, p, n) => invoke('mkdir', d, p, n),
  deviceMenu: (d) => invoke('deviceMenu', d),
  rename: (s, n) => invoke('rename', s, n),
  hide: (s) => invoke('hide', s),
  restore: () => invoke('restore'),
  chooseAdb: () => invoke('chooseAdb'),
  resetAdb: () => invoke('resetAdb'),
  sidebarWidth: (w) => invoke('sidebarWidth', w),
  cancel: () => invoke('cancel'),
};
contextBridge.exposeInMainWorld('androidTool', api);
