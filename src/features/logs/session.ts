import { readAppOptions } from '@/shared/api/app-options';
import { computed, reactive, shallowRef } from 'vue';
import type { Api, LogApp, LogEntry, LogFilter, Target } from '@/shared/api/types';
import { t } from '@/shared/i18n/index';

export function matchesLog(entry: LogEntry, filter: LogFilter): boolean {
  const rank = (level: string) => Math.max(0, 'VDIWEF'.indexOf(level));
  return (
    (!filter.uid || entry.uid === filter.uid) &&
    rank(entry.level) >= rank(filter.level) &&
    (!filter.crashesOnly || entry.crash) &&
    entry.raw.toLowerCase().includes(filter.keyword.trim().toLowerCase())
  );
}

/** 创建独立日志会话；按设备传输标识绑定读取，返回筛选状态与开始、暂停、导出及清理方法。 */
export function createLogcat(api: Api) {
  const entries = shallowRef<LogEntry[]>([]);
  const frozen = shallowRef<LogEntry[]>([]);
  const apps = shallowRef<LogApp[]>([]);
  const state = reactive({
    starting: false,
    running: false,
    paused: false,
    exporting: false,
    appsLoading: false,
    error: '',
    appsError: '',
    exportNotice: '',
    exportError: false,
    packageName: '',
    level: 'V',
    keyword: '',
    crashesOnly: false,
    cursor: 0,
    dropped: 0,
    truncated: 0,
  });
  const filter = computed<LogFilter>(() => ({
    // 应用选项只允许从实际 UID 映射选择；失效选项不能悄悄变成“全部应用”。
    uid: state.packageName
      ? apps.value.find((a) => a.packageName === state.packageName)?.uid || '__missing__'
      : '',
    level: state.level,
    keyword: state.keyword,
    crashesOnly: state.crashesOnly,
  }));
  const filtered = computed(() =>
    (state.paused ? frozen.value : entries.value).filter((e) => matchesLog(e, filter.value)),
  );
  const exportCount = computed(() => entries.value.filter((e) => matchesLog(e, filter.value)).length);
  let session = '',
    epoch = 0,
    appRequest = 0,
    disposed = false;
  let target: Target | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
  const stop = (id: string) => {
    if (id) void api.stopLogcat(id).catch(() => {});
  };

  async function loadApps(refresh = true) {
    if (!target || state.appsLoading) return;
    const version = epoch,
      request = ++appRequest,
      current = { ...target };
    state.appsLoading = true;
    state.appsError = '';
    try {
      const list = await readAppOptions(api, current, refresh);
      if (version !== epoch || request !== appRequest) return;
      apps.value = list;
      if (state.packageName && !list.some((a) => a.packageName === state.packageName)) {
        state.appsError = t('所选应用已不存在，请重新选择应用。');
      }
    } catch (error) {
      if (version === epoch && request === appRequest) state.appsError = errorText(error);
    } finally {
      if (version === epoch && request === appRequest) state.appsLoading = false;
    }
  }
  async function poll(id: string, version: number) {
    try {
      const batch = await api.readLogcat(id, state.cursor);
      if (version !== epoch) return;
      // 服务端淘汰的旧记录同步移除；游标去重，断线后的剩余批次仍可排空。
      entries.value = [
        ...entries.value.filter((e) => e.id >= batch.firstId),
        ...batch.entries.filter((e) => e.id > state.cursor),
      ].slice(-10_000);
      state.cursor = batch.nextId;
      state.dropped = batch.dropped;
      state.truncated = batch.truncated;
      state.running = batch.running;
      state.error = batch.error || '';
      if (batch.running)
        timer = setTimeout(() => void poll(id, version), batch.entries.length === 500 ? 20 : 250);
    } catch (error) {
      if (version === epoch) {
        state.error = errorText(error);
        state.running = false;
      }
    }
  }
  async function start(next: Target | undefined) {
    if (disposed) return;
    const version = ++epoch;
    clearTimeout(timer);
    stop(session);
    session = '';
    appRequest++;
    target = next ? { serial: next.serial, transportId: next.transportId } : undefined;
    entries.value = [];
    frozen.value = [];
    apps.value = [];
    Object.assign(state, {
      starting: !!next,
      running: false,
      paused: false,
      appsLoading: false,
      cursor: 0,
      dropped: 0,
      truncated: 0,
      error: '',
      appsError: '',
      packageName: '',
      exportNotice: '',
    });
    if (!target) return;
    void loadApps(false);
    try {
      const id = await api.startLogcat({ ...target });
      // 旧设备的启动可能晚于切换/卸载完成；必须回收它，而不是挂到新页面上。
      if (version !== epoch) {
        stop(id);
        return;
      }
      session = id;
      state.running = true;
      void poll(id, version);
    } catch (error) {
      if (version === epoch) state.error = errorText(error);
    } finally {
      if (version === epoch) state.starting = false;
    }
  }
  function pause() {
    if (state.paused) return;
    frozen.value = entries.value;
    state.paused = true;
  }
  function resume() {
    state.paused = false;
    frozen.value = [];
  }
  async function exportLogs() {
    if (!session || !exportCount.value || state.exporting) return;
    const version = epoch;
    state.exporting = true;
    state.exportNotice = '';
    try {
      const saved = await api.exportLogcat(session, { ...filter.value }, state.cursor);
      if (version === epoch && saved) {
        state.exportNotice = t('日志已导出。');
        state.exportError = false;
      }
    } catch (error) {
      if (version === epoch) {
        state.exportNotice = errorText(error);
        state.exportError = true;
      }
    } finally {
      state.exporting = false;
    }
  }
  function dispose() {
    disposed = true;
    epoch++;
    clearTimeout(timer);
    stop(session);
    session = '';
  }
  return {
    state,
    entries,
    apps,
    filtered,
    exportCount,
    filter,
    start,
    pause,
    resume,
    retry: () => start(target),
    loadApps,
    exportLogs,
    dispose,
  };
}
