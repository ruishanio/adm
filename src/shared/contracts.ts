export interface Target {
  serial: string;
  transportId: string;
}
export interface Device extends Target {
  state: string;
  model: string;
}
export interface Details {
  android: string;
  api: string;
  owner: string | null;
  manufacturer: string;
  model: string;
  architecture: string;
  patch: string;
  serial: string;
}
export interface Apk {
  id: string;
  fileName: string;
  packageName: string;
  versionName: string;
  versionCode: string;
  minimumSdk: string;
  size: number;
  admins: string[];
}
export interface OwnerCheck {
  canSet: boolean;
  alreadySet: boolean;
  summary: string;
}
export interface DeviceFile {
  name: string;
  path: string;
  type: 'directory' | 'file' | 'link' | 'other';
  size: number;
  modified: number;
}
export interface Settings {
  adbPath: string;
  endpoint: string;
  deviceNames: Record<string, string>;
  hiddenDevices: string[];
  sidebarWidth: number;
}
export interface Snapshot {
  devices: Device[];
  settings: Settings;
  adbPath: string;
  platform: string;
  version: string;
  error?: string;
}
export interface Api {
  refresh(): Promise<Snapshot>;
  details(target: Target): Promise<Details>;
  connect(endpoint: string): Promise<void>;
  pair(endpoint: string, code: string): Promise<void>;
  chooseApk(): Promise<Apk | null>;
  dropApk(path: string): Promise<Apk>;
  install(target: Target, apkId: string, allowTest: boolean): Promise<void>;
  checkOwner(target: Target, component: string): Promise<OwnerCheck>;
  setOwner(target: Target, component: string, consent: boolean): Promise<void>;
  listFiles(target: Target, path: string): Promise<DeviceFile[]>;
  upload(target: Target, path: string): Promise<boolean>;
  download(target: Target, path: string): Promise<boolean>;
  mkdir(target: Target, path: string, name: string): Promise<void>;
  copySerial(serial: string): Promise<void>;
  rename(serial: string, name: string): Promise<void>;
  hide(serial: string): Promise<void>;
  restore(): Promise<void>;
  chooseAdb(): Promise<boolean>;
  resetAdb(): Promise<void>;
  sidebarWidth(width: number): Promise<void>;
  cancel(): Promise<void>;
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export const deviceName = (d: Device, settings?: Settings) =>
  (settings && Object.hasOwn(settings.deviceNames, d.serial) ? settings.deviceNames[d.serial] : '') ||
  d.model.replaceAll('_', ' ') ||
  d.serial;
export const connection = (d: Device) =>
  d.serial.startsWith('emulator-') ? '模拟器' : d.serial.includes(':') ? '网络' : 'USB';
export const deviceStatus = (d: Device) =>
  ({ device: '已连接', unauthorized: '等待授权', offline: '离线', no: '无访问权限' })[d.state] || d.state;
export const targetKey = (d: Target) => `${d.serial}@${d.transportId}`;
