import { afterEach, expect, it, vi } from 'vitest';
import { readAppOptions, invalidateAppOptions, toAppOptions } from '@/shared/api/app-options';
import type { Api, LogApp } from '@/shared/api/types';
const target = { serial: 'one', transportId: '1' };
const list: LogApp[] = [{ packageName: 'com.example.a', label: '应用 A', uid: '10101' }];
afterEach(() => vi.useRealTimers());
it('同一设备的并发选择列表共用一次读取，手动刷新和缓存过期重新读取', async () => {
  vi.useFakeTimers();
  const api = { logcatApps: vi.fn(async () => list) } as unknown as Api;
  const first = readAppOptions(api, target),
    second = readAppOptions(api, target);
  expect(first).toBe(second);
  await first;
  expect(api.logcatApps).toHaveBeenCalledTimes(1);
  await readAppOptions(api, target, true);
  expect(api.logcatApps).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(5001);
  await readAppOptions(api, target);
  expect(api.logcatApps).toHaveBeenCalledTimes(3);
});
it('设备重连与显式失效不会复用旧传输会话', async () => {
  const api = { logcatApps: vi.fn(async () => list) } as unknown as Api;
  await readAppOptions(api, target);
  await readAppOptions(api, { ...target, transportId: '2' });
  invalidateAppOptions(api);
  await readAppOptions(api, { ...target, transportId: '2' });
  expect(api.logcatApps).toHaveBeenCalledTimes(3);
});
it('旧请求迟到失败不能清除新缓存，当前请求失败后可立即重试', async () => {
  let fail!: (reason: Error) => void;
  const api = {
    logcatApps: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            fail = reject;
          }),
      )
      .mockResolvedValue(list),
  } as unknown as Api;
  const old = readAppOptions(api, target).catch(() => []);
  await Promise.resolve();
  await readAppOptions(api, target, true);
  fail(new Error('old'));
  await old;
  await readAppOptions(api, target);
  expect(api.logcatApps).toHaveBeenCalledTimes(2);
  vi.mocked(api.logcatApps).mockRejectedValueOnce(new Error('offline'));
  await expect(readAppOptions(api, target, true)).rejects.toThrow('offline');
  await expect(readAppOptions(api, target)).resolves.toEqual(list);
});
it('选项排序不修改原列表，缺失应用名称时保留包名身份', () => {
  const apps = [
    { packageName: 'z', label: null, uid: '2' },
    { packageName: 'a', label: 'A', uid: '1' },
  ];
  expect(toAppOptions(apps)).toEqual([
    { value: 'a', label: 'A', description: 'a' },
    { value: 'z', label: 'z', description: undefined },
  ]);
  expect(apps[0].packageName).toBe('z');
});
