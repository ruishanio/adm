// @vitest-environment jsdom
import { computed } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cpuUsage, performancePoint, createPerformance } from '@/features/performance/session';
import PerformancePage from '@/features/performance/PerformancePage.vue';
import PerformanceChart from '@/features/performance/PerformanceChart.vue';
import { workspaceKey } from '@/shared/composables/workspace';
import type { Api, PerformanceSample, CpuCounter } from '@/shared/api/types';
import { setLanguage } from '@/shared/i18n/index';
const target = { serial: 'emulator-5570', transportId: '42' };
const cpu = (total: number | null, idle: number | null): CpuCounter => ({
  name: 'cpu',
  total,
  idle,
  frequencyMhz: null,
  online: true,
});
const sample = (seconds: number): PerformanceSample => ({
  uptimeSeconds: seconds,
  cpus: [cpu(seconds * 100, seconds * 60)],
  memoryTotal: 4096,
  memoryAvailable: 1024,
  swapTotal: 0,
  swapFree: 0,
  networks: [{ name: 'wlan0', received: seconds * 1024, sent: seconds * 512 }],
  batteryPercent: 0,
  batteryTemperature: 0,
  thermalStatus: 0,
  app: {
    packageName: 'com.test.app',
    pssBytes: 1024,
    uptimeSeconds: seconds,
    frames: [{ key: 'pid|window|epoch', frames: seconds * 30, janky: seconds * 3 }],
  },
});
const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  setLanguage('zh-CN');
});
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((f) => f());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});
function setup() {
  const api = {
    startPerformance: vi.fn(async () => 'session'),
    samplePerformance: vi.fn(async () => sample(10)),
    stopPerformance: vi.fn(async () => {}),
    logcatApps: vi.fn(async () => []),
  } as unknown as Api;
  const perf = createPerformance(api);
  cleanups.push(perf.dispose);
  return { api, perf };
}
it('按累计差值计算 CPU、网卡、FPS 和新帧卡顿比例，首帧及计数重置不伪造数值', () => {
  expect(cpuUsage(cpu(200, 120), cpu(100, 60))).toBe(40);
  expect(cpuUsage(cpu(99, 60), cpu(100, 60))).toBeNull();
  expect(cpuUsage(cpu(200, 50), cpu(100, 60))).toBeNull();
  expect(cpuUsage(cpu(null, null), cpu(100, 60))).toBeNull();
  const p = performancePoint(sample(12), sample(10));
  expect(p.cpu.cpu).toBe(40);
  expect(p.memory).toBe(75);
  expect(p.networks.wlan0).toEqual({ received: 1024, sent: 512 });
  expect(p.fps).toBe(30);
  expect(p.jank).toBe(10);
  expect(performancePoint(sample(10)).fps).toBeNull();
  expect(performancePoint(sample(5), sample(10)).networks.wlan0).toBeNull();
});
it('应用重启、窗口切换和无新帧分别显示缺值或零，不沿用旧进程数据', () => {
  const first = sample(10),
    next = sample(12);
  next.app!.frames = first.app!.frames;
  expect(performancePoint(next, first).fps).toBe(0);
  expect(performancePoint(next, first).jank).toBeNull();
  next.app!.frames = [{ key: 'new-pid', frames: 999, janky: 0 }];
  expect(performancePoint(next, first).fps).toBeNull();
  next.app = null;
  expect(performancePoint(next, first).pss).toBeNull();
});
it('串行采样不重叠，暂停取消会话，继续采样重建差值基线', async () => {
  const { api, perf } = setup();
  let finish!: (value: PerformanceSample) => void;
  vi.mocked(api.samplePerformance).mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  perf.start(target);
  await flushPromises();
  await vi.advanceTimersByTimeAsync(10000);
  expect(api.samplePerformance).toHaveBeenCalledTimes(1);
  finish(sample(10));
  await flushPromises();
  perf.pause();
  expect(api.stopPerformance).toHaveBeenCalledWith('session');
  await vi.advanceTimersByTimeAsync(10000);
  expect(api.samplePerformance).toHaveBeenCalledTimes(1);
  perf.resume();
  await flushPromises();
  expect(perf.points.value.at(-1)?.cpu.cpu).toBeNull();
  expect(perf.points.value.at(-1)?.breakBefore).toBe(true);
});
it('离开时尚未创建完成的会话也会关闭，长时间采样只保留最近两分钟', async () => {
  const { api, perf } = setup();
  let finish!: (id: string) => void;
  vi.mocked(api.startPerformance).mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  perf.start(target);
  perf.start(undefined);
  finish('late-session');
  await flushPromises();
  expect(api.stopPerformance).toHaveBeenCalledWith('late-session');
  expect(api.samplePerformance).not.toHaveBeenCalled();
  perf.start(target);
  await flushPromises();
  await vi.advanceTimersByTimeAsync(300_000);
  expect(perf.points.value.length).toBeLessThanOrEqual(61);
  expect(perf.points.value[0].time).toBeGreaterThanOrEqual(Date.now() - 120_000);
});
it('切换设备或应用后丢弃迟到响应，卸载后停止轮询', async () => {
  const { api, perf } = setup();
  let finish!: (value: PerformanceSample) => void;
  vi.mocked(api.samplePerformance).mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  perf.start(target);
  await flushPromises();
  perf.chooseApp('com.test.other');
  await flushPromises();
  finish(sample(500));
  await flushPromises();
  expect(perf.sample.value?.uptimeSeconds).toBe(10);
  expect(api.samplePerformance).toHaveBeenLastCalledWith('session', 'com.test.other');
  perf.start(undefined);
  expect(perf.points.value).toEqual([]);
  perf.dispose();
  const count = vi.mocked(api.samplePerformance).mock.calls.length;
  await vi.advanceTimersByTimeAsync(10000);
  expect(api.samplePerformance).toHaveBeenCalledTimes(count);
});
it('读取失败保留已采集曲线并停止自动请求，重新开始可恢复', async () => {
  const { api, perf } = setup();
  perf.start(target);
  await flushPromises();
  vi.mocked(api.samplePerformance).mockRejectedValueOnce(new Error('device offline'));
  await vi.advanceTimersByTimeAsync(2000);
  expect(perf.state.error).toBe('device offline');
  expect(perf.points.value).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(5000);
  expect(api.samplePerformance).toHaveBeenCalledTimes(2);
  perf.resume();
  await flushPromises();
  expect(perf.state.error).toBe('');
});
it('曲线保留缺值断点，设备页显示合法零温度及电量，离开时回收会话', async () => {
  const { api } = setup();
  const chart = mount(PerformanceChart, {
    props: {
      label: 'CPU',
      colors: ['green'],
      maximum: 100,
      maximumLabel: '100%',
      points: [
        { time: 0, values: [10] },
        { time: 1000, values: [null] },
        { time: 2000, values: [20] },
      ],
    },
  });
  cleanups.push(() => chart.unmount());
  expect(chart.findAll('path[stroke="currentColor"]')).toHaveLength(2);
  await chart.setProps({
    points: [
      { time: 0, values: [10] },
      { time: 1000, values: [20], breakBefore: true },
    ],
  });
  expect(chart.findAll('path[stroke="currentColor"]')).toHaveLength(2);
  const page = mount(PerformancePage, {
    global: {
      provide: {
        [workspaceKey as symbol]: {
          api,
          online: computed(() => true),
          device: computed(() => target),
          state: { selected: 'device' },
        },
      },
    },
  });
  cleanups.push(() => page.unmount());
  await flushPromises();
  expect(page.text()).toContain('0.0 °C');
  expect(page.text()).toContain('0.0%');
  expect(page.text()).not.toContain('NaN');
  expect(page.findAll('svg[role=img]').length).toBe(3);
  page.unmount();
  expect(api.stopPerformance).toHaveBeenCalledWith('session');
});
