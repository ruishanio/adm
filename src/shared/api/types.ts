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
  system: SystemInfo;
}
export interface SystemInfo {
  brand: string;
  device: string;
  product: string;
  hardware: string;
  soc: string;
  buildId: string;
  buildNumber: string;
  buildType: string;
  fingerprint: string;
  bootloader: string;
  baseband: string;
  verifiedBoot: string;
  encryption: string;
  runtime: RuntimeInfo;
}
export interface RuntimeInfo {
  kernel: string;
  cpuCores: number | null;
  memoryTotal: number | null;
  memoryAvailable: number | null;
  storageTotal: number | null;
  storageAvailable: number | null;
  physicalSize: string;
  overrideSize: string;
  physicalDensity: number | null;
  overrideDensity: number | null;
  battery: {
    present: boolean | null;
    percent: number | null;
    status: number | null;
    health: number | null;
    temperature: number | null;
    voltage: number | null;
    power: string[];
  };
  uptimeSeconds: number | null;
  addresses: string[];
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
export type AppAction = 'launch' | 'force-stop' | 'clear-data';
export interface InstalledApp {
  version?: { name: string; code: string } | null;
  apkSize?: number | null;
  launchComponent?: string | null;
  packageName: string;
  label: string | null;
  apkPath: string;
  system: boolean;
  enabled: boolean;
}
export interface AppDetails extends InstalledApp {
  versionName: string;
  versionCode: string;
  minimumSdk: string;
  targetSdk: string;
  uid: string;
  firstInstallTime: string;
  lastUpdateTime: string;
  installer: string;
}
export interface DeviceFile {
  name: string;
  path: string;
  type: 'directory' | 'file' | 'link' | 'other';
  size: number;
  modified: number;
}
export interface LogEntry {
  id: number;
  time: string;
  uid: string;
  pid: string;
  tid: string;
  level: string;
  tag: string;
  message: string;
  raw: string;
  crash: boolean;
}
export interface LogBatch {
  entries: LogEntry[];
  firstId: number;
  nextId: number;
  dropped: number;
  truncated: number;
  running: boolean;
  error: string | null;
}
export interface LogFilter {
  uid: string;
  level: string;
  keyword: string;
  crashesOnly: boolean;
}
export interface LogApp {
  packageName: string;
  label: string | null;
  uid: string;
}
export interface Settings {
  language?: 'zh-CN' | 'en' | '';
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
  startPerformance(target: Target): Promise<string>;
  samplePerformance(id: string, packageName: string): Promise<PerformanceSample>;
  stopPerformance(id: string): Promise<void>;
  startLogcat(target: Target): Promise<string>;
  readLogcat(id: string, after: number): Promise<LogBatch>;
  stopLogcat(id: string): Promise<void>;
  logcatApps(target: Target): Promise<LogApp[]>;
  exportLogcat(id: string, filter: LogFilter, through: number): Promise<boolean>;
  refresh(): Promise<Snapshot>;
  details(target: Target): Promise<Details>;
  connect(endpoint: string): Promise<void>;
  pair(endpoint: string, code: string): Promise<void>;
  chooseApk(): Promise<Apk | null>;
  dropApk(path: string): Promise<Apk>;
  install(target: Target, apkId: string, allowTest: boolean): Promise<void>;
  listApps(target: Target): Promise<InstalledApp[]>;
  appDetails(target: Target, packageName: string): Promise<AppDetails>;
  appIcons(target: Target, packages: string[]): Promise<Record<string, string>>;
  appRunning(target: Target): Promise<string[]>;
  appAction(
    target: Target,
    packageName: string,
    versionCode: string,
    action: AppAction,
    consent: boolean,
  ): Promise<void>;
  copyPackage(packageName: string): Promise<void>;
  uninstallApp(target: Target, packageName: string, versionCode: string, consent: boolean): Promise<void>;
  checkOwner(target: Target, component: string): Promise<OwnerCheck>;
  setOwner(target: Target, component: string, consent: boolean): Promise<void>;
  listFiles(target: Target, path: string): Promise<DeviceFile[]>;
  upload(target: Target, path: string, kind: 'files' | 'folders'): Promise<boolean>;
  renameFile(target: Target, directory: string, name: string, next: string): Promise<void>;
  deleteFile(target: Target, directory: string, name: string, consent: boolean): Promise<void>;
  download(target: Target, path: string): Promise<boolean>;
  mkdir(target: Target, path: string, name: string): Promise<void>;
  copySerial(serial: string): Promise<void>;
  rename(serial: string, name: string): Promise<void>;
  hide(serial: string): Promise<void>;
  restore(): Promise<void>;
  chooseAdb(): Promise<boolean>;
  resetAdb(): Promise<void>;
  sidebarWidth(width: number): Promise<void>;
  language(value: 'zh-CN' | 'en'): Promise<void>;
  cancel(): Promise<void>;
}

export interface CpuCounter {
  name: string;
  total: number | null;
  idle: number | null;
  frequencyMhz: number | null;
  online: boolean | null;
}
export interface NetworkCounter {
  name: string;
  received: number;
  sent: number;
}
export interface FrameCounter {
  key: string;
  frames: number;
  janky: number;
}
export interface PerformanceSample {
  uptimeSeconds: number | null;
  cpus: CpuCounter[];
  memoryTotal: number | null;
  memoryAvailable: number | null;
  swapTotal: number | null;
  swapFree: number | null;
  networks: NetworkCounter[];
  batteryPercent: number | null;
  batteryTemperature: number | null;
  thermalStatus: number | null;
  app: {
    packageName: string;
    pssBytes: number | null;
    uptimeSeconds: number | null;
    frames: FrameCounter[];
  } | null;
}
