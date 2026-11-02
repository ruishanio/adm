import { type Api, type LogApp, type Target } from '@/shared/api/types';
import { targetKey } from '@/shared/utils/device';

interface Entry {
  key: string;
  expires: number;
  request: Promise<LogApp[]>;
}
const catalogs = new WeakMap<Api, Entry>();
const freshnessMs = 5000;

/** 同一工作台/设备短期复用选项读取；手动刷新强制重读，迟到响应不能覆盖新请求。 */
export function readAppOptions(api: Api, target: Target, refresh = false): Promise<LogApp[]> {
  const key = targetKey(target),
    previous = catalogs.get(api);
  if (!refresh && previous?.key === key && previous.expires > Date.now()) return previous.request;
  const entry: Entry = {
    key,
    expires: Infinity,
    request: Promise.resolve().then(() =>
      api.logcatApps({ serial: target.serial, transportId: target.transportId }),
    ),
  };
  catalogs.set(api, entry);
  // 缓存仅用于重复进入页面，不轮询设备；失败立即可重试，外部安装和语言变化最多保留一个短窗口。
  entry.request = entry.request.then(
    (apps) => {
      entry.expires = Date.now() + freshnessMs;
      return apps;
    },
    (error: unknown) => {
      if (catalogs.get(api) === entry) catalogs.delete(api);
      throw error;
    },
  );
  return entry.request;
}
export function invalidateAppOptions(api: Api) {
  catalogs.delete(api);
}
export function toAppOptions(apps: readonly LogApp[]) {
  return [...apps]
    .sort((a, b) => (a.label || a.packageName).localeCompare(b.label || b.packageName))
    .map((app) => ({
      value: app.packageName,
      label: app.label || app.packageName,
      description: app.label ? app.packageName : undefined,
    }));
}
