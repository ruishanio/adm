import { afterEach, expect, it } from 'vitest';
import { deviceInfoGroups, buildProperties, overviewMetrics } from '@/features/devices/format';
import { setLanguage } from '@/shared/i18n/index';
import type { Details } from '@/shared/api/types';

const details: Details = {
  manufacturer: 'Google',
  model: 'Pixel',
  android: '14',
  api: '34',
  patch: '2024-10-05',
  architecture: 'arm64-v8a',
  serial: 'demo',
  owner: null,
  system: {
    brand: 'google',
    device: 'device',
    product: 'product',
    hardware: 'board',
    soc: 'Vendor Chip',
    buildId: 'BUILD',
    buildNumber: '1234',
    buildType: 'user',
    fingerprint: 'vendor/product/build:user/release-keys',
    bootloader: '',
    baseband: '',
    verifiedBoot: 'green',
    encryption: 'encrypted',
    runtime: {
      kernel: '5.15.41',
      cpuCores: 8,
      memoryTotal: 4 * 1024 ** 3,
      memoryAvailable: 0,
      storageTotal: 128 * 1024 ** 3,
      storageAvailable: null,
      physicalSize: '1080 × 2400',
      overrideSize: '720 × 1600',
      physicalDensity: 420,
      overrideDensity: 320,
      battery: { present: true, percent: 0, status: 3, health: 2, temperature: 0, voltage: 4.1, power: [] },
      uptimeSeconds: 90061,
      addresses: ['wlan0: 192.0.2.4'],
    },
  },
};
afterEach(() => setLanguage('zh-CN'));
function values(d?: Details) {
  return Object.fromEntries(
    deviceInfoGroups(d).flatMap((group) => group.rows.map((row) => [row.label, row.value])),
  );
}
it('保留零读数并区分可用容量、总量与屏幕覆盖值', () => {
  setLanguage('zh-CN');
  const rows = values(details);
  expect(rows['电池电量']).toBe('0%');
  expect(overviewMetrics(details).find((metric) => metric.id === 'battery')?.value).toBe('0%');
  expect(overviewMetrics(details).find((metric) => metric.id === 'memory')?.detail).toBe('可用 0 MiB');
  expect(rows['电池温度']).toBe('0.0 °C');
  expect(rows['运行内存']).toBe('0 MiB 可用 / 4.0 GiB');
  expect(rows['数据分区']).toBe('128.0 GiB');
  expect(rows['屏幕分辨率']).toBe('720 × 1600（原始 1080 × 2400）');
  expect(rows['显示密度']).toBe('320 dpi（原始 420 dpi）');
  expect(rows['运行时长']).toBe('1 天 1 小时 1 分钟');
  expect(buildProperties(details).find((row) => row.label === '构建指纹')?.wide).toBe(true);
});
it('未载入的信息保持空占位，不输出 undefined 或 NaN', () => {
  expect(Object.values(values()).every((value) => value === '—')).toBe(true);
  expect(overviewMetrics().every((metric) => metric.value === '—')).toBe(true);
});
it('无电池设备不显示虚假的电量', () => {
  setLanguage('zh-CN');
  const noBattery = structuredClone(details);
  noBattery.system.runtime.battery = {
    present: false,
    percent: null,
    status: null,
    health: null,
    temperature: null,
    voltage: null,
    power: [],
  };
  expect(values(noBattery)['电池电量']).toBe('无电池');
  expect(values(noBattery)['充电状态']).toBe('—');
});
it('切换语言同时翻译标签、单位说明与状态，保留设备原始信息', () => {
  setLanguage('en');
  const rows = values(details);
  expect(rows['Charging status']).toBe('Discharging');
  expect(rows['Battery health']).toBe('Good');
  expect(rows['Memory']).toBe('0 MiB free / 4.0 GiB');
  expect(rows['Uptime']).toBe('1d 1h 1m');
  expect(rows['Model']).toBe('Pixel');
});
