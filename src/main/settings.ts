import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname, delimiter } from 'node:path';
import { homedir } from 'node:os';
import type { Settings } from '../shared/contracts';
export const defaults = (): Settings => ({
  adbPath: '',
  endpoint: '',
  deviceNames: {},
  hiddenDevices: [],
  sidebarWidth: 248,
});
export class SettingsStore {
  value: Settings;
  constructor(
    private path: string,
    legacyPaths: string[] = [],
  ) {
    this.value = defaults();
    const source = [path, ...legacyPaths].find(existsSync);
    if (source) {
      try {
        const raw = JSON.parse(readFileSync(source, 'utf8'));
        const get = (key: string) => raw[key] ?? raw[key[0].toUpperCase() + key.slice(1)];
        for (const key of ['adbPath', 'endpoint'] as const)
          if (typeof get(key) === 'string') this.value[key] = get(key);
        const names = get('deviceNames');
        if (names && typeof names === 'object')
          this.value.deviceNames = Object.fromEntries(
            Object.entries(names).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
          );
        if (Array.isArray(get('hiddenDevices')))
          this.value.hiddenDevices = get('hiddenDevices').filter((v: unknown) => typeof v === 'string');
        if (Number.isFinite(get('sidebarWidth')))
          this.value.sidebarWidth = Math.max(220, Math.min(500, get('sidebarWidth')));
      } catch {
        /* 旧配置损坏时使用默认值，不阻止启动，也不覆盖旧文件。 */
      }
    }
  }
  update(patch: Partial<Settings>) {
    const next = { ...this.value, ...patch };
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = this.path + '.tmp';
    writeFileSync(temp, JSON.stringify(next, null, 2));
    renameSync(temp, this.path);
    this.value = next;
  }
}
export function findAdb(configured: string, resources: string, platform = process.platform): string {
  if (configured) {
    if (existsSync(configured)) return configured;
    throw new Error('自定义 ADB 路径不存在，请在设置中重新选择。');
  }
  const exe = platform === 'win32' ? 'adb.exe' : 'adb';
  const roots = [
    join(resources, 'platform-tools'),
    join(process.cwd(), 'resources/platform-tools'),
    ...[
      process.env.ANDROID_SDK_ROOT,
      process.env.ANDROID_HOME,
      platform === 'win32'
        ? join(process.env.LOCALAPPDATA || homedir(), 'Android/Sdk')
        : join(homedir(), 'Library/Android/sdk'),
    ]
      .filter(Boolean)
      .map((p) => join(p!, 'platform-tools')),
    ...(process.env.PATH || '').split(delimiter),
  ];
  const found = roots.map((p) => join(p, exe)).find(existsSync);
  if (!found) throw new Error('未找到 ADB，请在设置中选择 platform-tools 中的 ADB。');
  return found;
}
