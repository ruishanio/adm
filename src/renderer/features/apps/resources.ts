import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import type { Workbench } from '../../composables/workbench';
import type { InstalledApp } from '../../../shared/contracts';

/** 图标按可见行批量读取；进程独立串行轮询，换设备、隐藏页面和迟到响应均隔离。 */
export function useAppResources(w: Workbench) {
  const icons = reactive<Record<string, string | null>>({});
  const running = ref<Set<string>>();
  const error = ref('');
  const visible = ref(typeof document === 'undefined' || !document.hidden);
  const active = computed(() => w.online.value && w.state.tab === 'apps' && visible.value);
  const queue = new Map<string, InstalledApp>();
  let generation = 0,
    iconGeneration = 0,
    disposed = false,
    querying = false,
    readingIcons = false;
  let poll: ReturnType<typeof setTimeout> | undefined, iconTimer: ReturnType<typeof setTimeout> | undefined;
  const iconKey = (app: InstalledApp) =>
    `${w.state.selected}|${app.packageName}|${app.apkPath}|${app.version?.code || ''}`;
  function requestIcon(app: InstalledApp) {
    const key = iconKey(app);
    if (disposed || key in icons || queue.has(key)) return;
    queue.set(key, app);
    clearTimeout(iconTimer);
    iconTimer = setTimeout(() => void drainIcons(), 40);
  }
  async function drainIcons() {
    if (readingIcons || disposed || !active.value || !w.device.value || w.state.busy) return;
    const epoch = iconGeneration,
      target = { ...w.device.value };
    const batch = [...queue.entries()].slice(0, 24);
    if (!batch.length) return;
    batch.forEach(([key]) => queue.delete(key));
    readingIcons = true;
    try {
      const result = await w.api.appIcons(
        target,
        batch.map(([, app]) => app.packageName),
      );
      if (epoch === iconGeneration && !disposed)
        batch.forEach(([key, app]) => {
          icons[key] = result[app.packageName] || null;
        });
    } catch {
      // 本轮读取失败显示通用图标，手动刷新列表后可重新尝试，不对损坏资源反复请求。
      if (epoch === iconGeneration && !disposed)
        batch.forEach(([key]) => {
          icons[key] = null;
        });
    } finally {
      readingIcons = false;
      if (!disposed && queue.size) iconTimer = setTimeout(() => void drainIcons(), 40);
    }
  }
  async function refreshRunning() {
    clearTimeout(poll);
    if (querying || disposed || !active.value || !w.device.value || !w.state.appsLoaded || w.state.busy)
      return;
    const epoch = generation,
      target = { ...w.device.value };
    querying = true;
    try {
      const packages = await w.api.appRunning(target);
      if (epoch === generation && active.value && !disposed) {
        running.value = new Set(packages);
        error.value = '';
      }
    } catch (cause) {
      if (epoch === generation && active.value && !disposed) {
        running.value = undefined;
        error.value = cause instanceof Error ? cause.message : String(cause);
      }
    } finally {
      querying = false;
      if (active.value && !disposed)
        poll = setTimeout(() => void refreshRunning(), epoch === generation ? 5000 : 0);
    }
  }
  const visibility = () => {
    visible.value = !document.hidden;
  };
  watch(
    () => [w.state.selected, w.online.value],
    () => {
      generation++;
      // 同设备的操作和页面隐藏只暂停读取，不丢弃已请求图标；换传输会话才废弃响应。
      iconGeneration++;
      queue.clear();
      running.value = undefined;
      error.value = '';
      Object.keys(icons).forEach((key) => delete icons[key]);
    },
    { flush: 'sync' },
  );
  watch(
    () => w.state.apps,
    () => {
      // 刷新重试失败的图标；成功项按会话、包路径和版本复用缓存。
      Object.keys(icons)
        .filter((key) => icons[key] === null)
        .forEach((key) => delete icons[key]);
    },
  );
  watch(
    () => [active.value, w.state.busy, w.state.appsLoaded, w.state.appStateEpoch, w.state.apps],
    () => {
      clearTimeout(poll);
      if (!active.value || w.state.busy) {
        generation++;
        if (!active.value) running.value = undefined;
      } else {
        void refreshRunning();
        void drainIcons();
      }
    },
    { immediate: true },
  );
  onMounted(() => document.addEventListener('visibilitychange', visibility));
  onBeforeUnmount(() => {
    disposed = true;
    generation++;
    iconGeneration++;
    queue.clear();
    clearTimeout(poll);
    clearTimeout(iconTimer);
    document.removeEventListener('visibilitychange', visibility);
  });
  return { icons, running, error, iconKey, requestIcon, refreshRunning };
}
