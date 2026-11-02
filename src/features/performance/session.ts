import { reactive, shallowRef } from 'vue';
import type { Api, CpuCounter, PerformanceSample, Target } from '@/shared/api/types';

export interface PerformancePoint {
  time: number;
  breakBefore?: boolean;
  cpu: Record<string, number | null>;
  memory: number | null;
  networks: Record<string, { received: number; sent: number } | null>;
  fps: number | null;
  jank: number | null;
  pss: number | null;
}
// 缺值、累计计数回退或核心下线时中断曲线，不补零、不把重启后的累计值当作瞬时峰值。
export function cpuUsage(current: CpuCounter, previous?: CpuCounter): number | null {
  if (
    current.online === false ||
    previous?.online === false ||
    current.total == null ||
    current.idle == null ||
    previous?.total == null ||
    previous.idle == null
  )
    return null;
  const total = current.total - previous.total,
    idle = current.idle - previous.idle;
  return total > 0 && idle >= 0 && idle <= total ? ((total - idle) * 100) / total : null;
}
/** 将前后两次快照转换为同一时间段的曲线点；首次采样与变更进程/网卡时不推测速率。 */
export function performancePoint(
  sample: PerformanceSample,
  previous?: PerformanceSample,
  time = Date.now(),
): PerformancePoint {
  const elapsed =
    sample.uptimeSeconds != null && previous?.uptimeSeconds != null
      ? sample.uptimeSeconds - previous.uptimeSeconds
      : 0;
  const cpu = Object.fromEntries(
    sample.cpus.map((c) => [
      c.name,
      elapsed > 0
        ? cpuUsage(
            c,
            previous?.cpus.find((p) => p.name === c.name),
          )
        : null,
    ]),
  );
  const networks = Object.fromEntries(
    sample.networks.map((n) => {
      const old = previous?.networks.find((p) => p.name === n.name);
      return [
        n.name,
        elapsed > 0 && old && n.received >= old.received && n.sent >= old.sent
          ? { received: (n.received - old.received) / elapsed, sent: (n.sent - old.sent) / elapsed }
          : null,
      ];
    }),
  );
  const memory =
    sample.memoryTotal != null && sample.memoryTotal > 0 && sample.memoryAvailable != null
      ? ((sample.memoryTotal - sample.memoryAvailable) * 100) / sample.memoryTotal
      : null;
  let fps: number | null = null,
    jank: number | null = null;
  const app = sample.app,
    old = previous?.app;
  if (
    app &&
    old &&
    app.packageName === old.packageName &&
    app.uptimeSeconds != null &&
    old.uptimeSeconds != null &&
    app.uptimeSeconds > old.uptimeSeconds &&
    app.frames.length &&
    app.frames.length === old.frames.length
  ) {
    let frames = 0,
      janky = 0,
      valid = true;
    for (const row of app.frames) {
      const prev = old.frames.find((p) => p.key === row.key);
      if (
        !prev ||
        row.frames < prev.frames ||
        row.janky < prev.janky ||
        row.janky - prev.janky > row.frames - prev.frames
      ) {
        valid = false;
        break;
      }
      frames += row.frames - prev.frames;
      janky += row.janky - prev.janky;
    }
    if (valid) {
      fps = frames / (app.uptimeSeconds - old.uptimeSeconds);
      jank = frames > 0 ? (janky * 100) / frames : null;
    }
  }
  return { time, cpu, memory, networks, fps, jank, pss: app?.pssBytes ?? null };
}

/** 管理只读采样会话，串行轮询并保留最近两分钟；设备切换、暂停和卸载均取消当前客户端。 */
export function createPerformance(api: Api) {
  const state = reactive({ loading: false, paused: false, interval: 2000, packageName: '', error: '' });
  const sample = shallowRef<PerformanceSample>();
  const points = shallowRef<PerformancePoint[]>([]);
  let target: Target | undefined,
    session = '',
    generation = 0,
    disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previous: PerformanceSample | undefined;
  const stop = (id: string) => {
    if (id) void api.stopPerformance(id).catch(() => {});
  };
  function invalidate() {
    generation++;
    clearTimeout(timer);
    stop(session);
    session = '';
    previous = undefined;
  }
  async function poll(id: string, version: number) {
    const started = Date.now();
    try {
      const next = await api.samplePerformance(id, state.packageName);
      if (disposed || version !== generation) return;
      sample.value = next;
      const point = performancePoint(next, previous);
      // 暂停或重新连接后不跨空档连接内存等绝对值曲线，避免把未采集的时间画成连续测量。
      point.breakBefore = !previous && points.value.length > 0;
      points.value = [...points.value.filter((p) => p.time >= point.time - 120_000), point].slice(-121);
      previous = next;
      state.error = '';
      timer = setTimeout(
        () => void poll(id, version),
        Math.max(100, state.interval - (Date.now() - started)),
      );
    } catch (error) {
      if (version === generation && !disposed) {
        state.error = error instanceof Error ? error.message : String(error);
        stop(session);
        session = '';
      }
    } finally {
      if (version === generation) state.loading = false;
    }
  }
  async function begin() {
    if (!target || disposed || state.paused) return;
    const version = generation;
    state.loading = true;
    state.error = '';
    try {
      const id = await api.startPerformance(target);
      if (disposed || version !== generation) {
        stop(id);
        return;
      }
      session = id;
      await poll(id, version);
    } catch (error) {
      if (version === generation) {
        state.error = error instanceof Error ? error.message : String(error);
        state.loading = false;
      }
    }
  }
  function start(next?: Target) {
    invalidate();
    target = next ? { ...next } : undefined;
    points.value = [];
    sample.value = undefined;
    state.paused = false;
    state.loading = false;
    state.error = '';
    state.packageName = '';
    void begin();
  }
  function pause() {
    state.paused = true;
    state.loading = false;
    invalidate();
  }
  function resume() {
    state.paused = false;
    invalidate();
    void begin();
  }
  function chooseApp(value: string) {
    state.packageName = value;
    // 系统曲线保留，应用曲线清空，迟到响应不能把上一个应用的数据混入当前目标。
    points.value = points.value.map((p) => ({ ...p, fps: null, jank: null, pss: null }));
    if (sample.value) sample.value = { ...sample.value, app: null };
    invalidate();
    void begin();
  }
  function dispose() {
    disposed = true;
    invalidate();
  }
  return { state, sample, points, start, pause, resume, chooseApp, dispose };
}
