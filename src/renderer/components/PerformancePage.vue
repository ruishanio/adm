<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  Activity,
  Battery,
  Thermometer,
  Timer,
  Pause,
  Play,
  RefreshCw,
  ArrowDown,
  ArrowUp,
  ChevronRight,
} from '@lucide/vue';
import { Button } from '@/components/ui/button';
import AppSelect from './AppSelect.vue';
import AppSearchSelect from './AppSearchSelect.vue';
import PerformanceChart from './PerformanceChart.vue';
import { useWorkbench } from '@/composables/workbench';
import { createPerformance, type PerformancePoint } from '@/composables/performance';
import { t, type MessageKey } from '../../shared/i18n';
import type { LogApp } from '../../shared/contracts';
const w = useWorkbench();
const perf = createPerformance(w.api),
  s = perf.state;
const apps = ref<LogApp[]>([]),
  appsLoading = ref(false),
  appsError = ref('');
const network = ref('');
const coresExpanded = ref(false);
let appEpoch = 0;
async function loadApps() {
  const version = ++appEpoch;
  apps.value = [];
  appsError.value = '';
  appsLoading.value = false;
  if (!w.online.value || !w.device.value) return;
  appsLoading.value = true;
  try {
    const list = await w.api.logcatApps(w.device.value);
    if (version === appEpoch) apps.value = list;
  } catch (error) {
    if (version === appEpoch) appsError.value = error instanceof Error ? error.message : String(error);
  } finally {
    if (version === appEpoch) appsLoading.value = false;
  }
}
watch(
  () => (w.online.value ? w.state.selected : ''),
  () => {
    perf.start(w.online.value ? w.device.value : undefined);
    network.value = '';
    coresExpanded.value = false;
    void loadApps();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  appEpoch++;
  perf.dispose();
});
const sample = perf.sample;
const latest = computed(() => perf.points.value.at(-1));
const appOptions = computed(() => [
  { value: '__none__', label: t('选择应用') },
  // 刷新失败或目标应用卸载后仍保留当前筛选身份，不让选择框变成空白。
  ...(s.packageName && !apps.value.some((a) => a.packageName === s.packageName)
    ? [{ value: s.packageName, label: s.packageName }]
    : []),
  ...[...apps.value]
    .sort((a, b) => (a.label || a.packageName).localeCompare(b.label || b.packageName))
    .map((a) => ({
      value: a.packageName,
      label: a.label || a.packageName,
      description: a.label ? a.packageName : undefined,
    })),
]);
const intervalOptions = computed(() =>
  [1, 2, 5].map((n) => ({ value: String(n * 1000), label: t('每 {seconds} 秒', { seconds: n }) })),
);
const cores = computed(
  () =>
    sample.value?.cpus
      .filter((c) => c.name !== 'cpu')
      .sort((a, b) => Number(a.name.slice(3)) - Number(b.name.slice(3))) ?? [],
);
const networkOptions = computed(
  () => sample.value?.networks.map((n) => ({ value: n.name, label: n.name })) ?? [],
);
watch(networkOptions, (options) => {
  if (!options.some((n) => n.value === network.value))
    network.value = options.find((n) => /^(wlan|eth|rmnet)/.test(n.value))?.value || options[0]?.value || '';
});
const networkValue = computed(() => latest.value?.networks[network.value]);
const percent = (n?: number | null) => (n == null ? '—' : `${n.toFixed(1)}%`);
const bytes = (n?: number | null) =>
  n == null
    ? '—'
    : n >= 1024 ** 3
      ? `${(n / 1024 ** 3).toFixed(2)} GiB`
      : `${(n / 1024 ** 2).toFixed(1)} MiB`;
const rate = (n?: number | null) =>
  n == null ? '—' : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MiB/s` : `${(n / 1024).toFixed(1)} KiB/s`;
const usage = computed(() =>
  sample.value?.memoryTotal != null && sample.value.memoryAvailable != null
    ? sample.value.memoryTotal - sample.value.memoryAvailable
    : null,
);
const duration = computed(() => {
  const seconds = sample.value?.uptimeSeconds;
  if (seconds == null) return '—';
  const days = Math.floor(seconds / 86400);
  const time = [Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, Math.floor(seconds) % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
  return days ? `${days}d ${time}` : time;
});
const thermalKeys: MessageKey[] = [
  '正常',
  '轻度发热',
  '中度发热',
  '严重发热',
  '温控临界',
  '温控紧急',
  '即将关机',
];
const chartPoints = (value: (p: PerformancePoint) => (number | null)[]) =>
  perf.points.value.map((p) => ({ time: p.time, values: value(p), breakBefore: p.breakBefore }));
const cpuPoints = computed(() => chartPoints((p) => [p.cpu.cpu ?? null]));
const memoryPoints = computed(() => chartPoints((p) => [p.memory]));
const networkPoints = computed(() =>
  chartPoints((p) => [p.networks[network.value]?.received ?? null, p.networks[network.value]?.sent ?? null]),
);
const networkMax = computed(
  () => Math.max(1024, ...networkPoints.value.flatMap((p) => p.values.map((v) => v ?? 0))) * 1.1,
);
const fpsPoints = computed(() => chartPoints((p) => [p.fps]));
const fpsMax = computed(() => Math.max(60, ...perf.points.value.map((p) => p.fps ?? 0)));
const pssPoints = computed(() => chartPoints((p) => [p.pss]));
const pssMax = computed(() => Math.max(64 * 1024 ** 2, ...perf.points.value.map((p) => p.pss ?? 0)) * 1.1);
</script>
<template>
  <section v-if="!w.online.value" class="empty-state">
    <Activity aria-hidden="true" />
    <h2>{{ t('请选择已连接的设备') }}</h2>
    <p>{{ t('连接后可查看实时性能曲线。') }}</p>
  </section>
  <section v-else class="performance-page" :aria-label="t('性能监控')">
    <div class="workspace-toolbar performance-toolbar">
      <div class="performance-vitals">
        <span :title="t('运行时间')"
          ><Timer aria-hidden="true" /><span class="sr-only">{{ t('运行时间') }}</span
          >{{ duration }}</span
        >
        <span :title="t('电池电量')"
          ><Battery aria-hidden="true" /><span class="sr-only">{{ t('电池电量') }}</span
          >{{ percent(sample?.batteryPercent) }}</span
        >
        <span :title="t('电池温度')"
          ><Thermometer aria-hidden="true" /><span class="sr-only">{{ t('电池温度') }}</span
          >{{ sample?.batteryTemperature == null ? '—' : `${sample.batteryTemperature.toFixed(1)} °C` }}</span
        >
      </div>
      <div class="performance-controls">
        <label class="sr-only" for="performance-interval">{{ t('采样间隔') }}</label>
        <AppSelect
          id="performance-interval"
          :model-value="String(s.interval)"
          :options="intervalOptions"
          @update:model-value="s.interval = Number($event)"
        />
        <Button
          variant="ghost"
          class="quiet"
          :aria-pressed="s.paused"
          @click="s.paused ? perf.resume() : perf.pause()"
          ><Play v-if="s.paused" aria-hidden="true" /><Pause v-else aria-hidden="true" />{{
            s.paused ? t('继续采样') : t('暂停采样')
          }}</Button
        >
      </div>
    </div>
    <p v-if="s.error" class="performance-error" role="alert">
      {{ s.error
      }}<Button variant="ghost" class="quiet" @click="perf.resume"
        ><RefreshCw aria-hidden="true" />{{ t('重试') }}</Button
      >
    </p>
    <p
      v-if="sample?.thermalStatus != null && sample.thermalStatus > 0"
      class="performance-thermal"
      role="status"
    >
      {{ t('温控状态') }}：{{ t(thermalKeys[sample.thermalStatus]) }}
    </p>
    <div class="performance-plots" :aria-busy="s.loading">
      <p v-if="s.loading && !sample" class="field-hint">{{ t('正在采样…') }}</p>
      <section class="performance-group" :aria-label="t('设备性能')">
        <header class="performance-group-heading">
          <h2>{{ t('设备性能') }}</h2>
          <span class="muted">{{ t('最近 2 分钟') }}</span>
        </header>
        <section class="performance-section">
          <div class="performance-metric-row">
            <div class="performance-metric-summary">
              <h3>CPU</h3>
              <strong class="performance-reading cpu-color">{{ percent(latest?.cpu.cpu) }}</strong>
              <Button
                v-if="cores.length"
                variant="ghost"
                class="quiet performance-core-toggle"
                :aria-expanded="coresExpanded"
                aria-controls="performance-core-list"
                @click="coresExpanded = !coresExpanded"
              >
                <ChevronRight :class="{ expanded: coresExpanded }" aria-hidden="true" />
                {{ t('{count} 个核心', { count: cores.length }) }}
              </Button>
            </div>
            <PerformanceChart
              label="CPU"
              :points="cpuPoints"
              :colors="['var(--brand)']"
              :maximum="100"
              maximum-label="100%"
              :show-time-axis="false"
            />
          </div>
          <p v-if="sample && !sample.cpus.some((c) => c.name === 'cpu')" class="field-hint">
            {{ t('当前设备不支持读取 CPU 占用。') }}
          </p>
          <!-- 核心细节只折叠展示，后台继续采集，展开时保留同一段历史。 -->
          <div v-if="coresExpanded" id="performance-core-list" class="performance-cores">
            <div v-for="core in cores" :key="core.name" class="performance-core">
              <div class="performance-core-heading">
                <span>{{ core.name.toUpperCase() }}</span>
                <span class="cpu-color">{{ percent(latest?.cpu[core.name]) }}</span>
              </div>
              <PerformanceChart
                :label="core.name.toUpperCase()"
                :points="chartPoints((p) => [p.cpu[core.name] ?? null])"
                :colors="['var(--brand)']"
                :maximum="100"
                maximum-label="100%"
                compact
              />
              <span class="performance-core-frequency">{{
                core.online === false
                  ? t('离线')
                  : core.frequencyMhz == null
                    ? '— MHz'
                    : `${Math.round(core.frequencyMhz)} MHz`
              }}</span>
            </div>
          </div>
        </section>
        <section class="performance-section">
          <div class="performance-metric-row">
            <div class="performance-metric-summary">
              <h3>{{ t('内存') }}</h3>
              <strong class="performance-reading memory-color">{{ percent(latest?.memory) }}</strong>
              <span class="performance-detail">{{ bytes(usage) }} / {{ bytes(sample?.memoryTotal) }}</span>
              <span v-if="sample?.swapTotal != null && sample.swapTotal > 0" class="performance-detail">
                Swap {{ bytes(sample.swapFree == null ? null : sample.swapTotal - sample.swapFree) }} /
                {{ bytes(sample.swapTotal) }}
              </span>
            </div>
            <PerformanceChart
              :label="t('内存')"
              :points="memoryPoints"
              :colors="['var(--install)']"
              :maximum="100"
              maximum-label="100%"
              :show-time-axis="false"
            />
          </div>
        </section>
        <section class="performance-section">
          <div class="performance-metric-row">
            <div class="performance-metric-summary">
              <div class="performance-network-heading">
                <h3>{{ t('网络') }}</h3>
                <label v-if="networkOptions.length" for="performance-network" class="sr-only">{{
                  t('网卡')
                }}</label>
                <AppSelect
                  v-if="networkOptions.length"
                  id="performance-network"
                  variant="inline"
                  v-model="network"
                  :options="networkOptions"
                />
              </div>
              <div class="performance-network-rates">
                <span class="network-color"
                  ><ArrowDown aria-hidden="true" /><span class="sr-only">{{ t('接收') }}</span
                  >{{ rate(networkValue?.received) }}</span
                >
                <span class="upload-color"
                  ><ArrowUp aria-hidden="true" /><span class="sr-only">{{ t('发送') }}</span
                  >{{ rate(networkValue?.sent) }}</span
                >
              </div>
            </div>
            <PerformanceChart
              :label="t('网络收发速率')"
              :points="networkPoints"
              :colors="['var(--device)', 'var(--owner)']"
              :maximum="networkMax"
              :maximum-label="rate(networkMax)"
            />
          </div>
          <p v-if="sample && !networkOptions.length" class="field-hint">
            {{ t('当前设备不支持读取网络计数。') }}
          </p>
        </section>
      </section>
      <section class="performance-group performance-app-section" :aria-label="t('应用性能')">
        <header class="performance-group-heading">
          <h2>{{ t('应用性能') }}</h2>
          <div class="performance-app-picker">
            <AppSearchSelect
              id="performance-app"
              :model-value="s.packageName || '__none__'"
              :options="appOptions"
              :disabled="appsLoading"
              :aria-label="t('应用')"
              :search-placeholder="t('搜索应用名称或包名')"
              :empty-label="t('没有匹配的应用')"
              @update:model-value="perf.chooseApp($event === '__none__' ? '' : $event)"
            />
            <Button
              variant="ghost"
              class="icon-button"
              :disabled="appsLoading"
              :title="t('刷新应用')"
              :aria-label="t('刷新应用')"
              @click="loadApps"
              ><RefreshCw :class="{ spin: appsLoading }" aria-hidden="true"
            /></Button>
          </div>
        </header>
        <p v-if="appsError" class="performance-error" role="alert">{{ appsError }}</p>
        <p v-if="!s.packageName" class="field-hint">
          {{ t('选择一个应用，查看性能数据。') }}
        </p>
        <template v-else>
          <div class="performance-metric-row">
            <div class="performance-metric-summary">
              <h3>{{ t('渲染 FPS') }}</h3>
              <strong class="performance-reading fps-color">{{
                latest?.fps == null ? '—' : latest.fps.toFixed(1)
              }}</strong>
              <span class="performance-detail">{{ t('卡顿比例') }} {{ percent(latest?.jank) }}</span>
            </div>
            <PerformanceChart
              :label="t('渲染 FPS')"
              :points="fpsPoints"
              :colors="['var(--folder)']"
              :maximum="fpsMax"
              :maximum-label="`${Math.ceil(fpsMax)} FPS`"
              :show-time-axis="false"
            />
          </div>
          <p v-if="sample?.app && !sample.app.frames.length" class="field-hint">
            {{ t('暂无帧率数据，应用可能未运行或不支持此项统计。') }}
          </p>
          <div class="performance-metric-row">
            <div class="performance-metric-summary">
              <h3>{{ t('内存（PSS）') }}</h3>
              <strong class="performance-reading memory-color">{{ bytes(sample?.app?.pssBytes) }}</strong>
            </div>
            <PerformanceChart
              :label="t('内存（PSS）')"
              :points="pssPoints"
              :colors="['var(--install)']"
              :maximum="pssMax"
              :maximum-label="bytes(pssMax)"
            />
          </div>
          <!-- 选中应用后再解释指标，避免空态先展示采样术语和统计限制。 -->
          <details class="performance-help">
            <summary><ChevronRight aria-hidden="true" />{{ t('指标说明') }}</summary>
            <p>{{ t('FPS：应用界面每秒绘制的帧数。画面静止时可为 0。') }}</p>
            <p>{{ t('卡顿比例：采样期间，系统判定为卡顿的帧所占比例。') }}</p>
            <p>{{ t('PSS：应用占用的内存，共享内存按比例计入。') }}</p>
            <p>
              {{ t('帧率来自 Android 界面渲染统计（HWUI），不代表屏幕刷新率，部分游戏和视频画面不计入。') }}
            </p>
          </details>
        </template>
      </section>
    </div>
  </section>
</template>
