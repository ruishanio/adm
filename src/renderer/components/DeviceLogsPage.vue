<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Pause, Play, Download, RefreshCw, Search } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import AppDialog from './AppDialog.vue';
import AppSelect from './AppSelect.vue';
import AppSearchSelect from './AppSearchSelect.vue';
import { useWorkbench } from '@/composables/workbench';
import { createLogcat } from '@/composables/logcat';
import { t } from '../../shared/i18n';
import type { LogEntry } from '../../shared/contracts';

const w = useWorkbench();
const logs = createLogcat(w.api),
  s = logs.state;
const scroller = ref<HTMLElement>(),
  scrollTop = ref(0),
  viewport = ref(400);
const selected = ref<LogEntry>();
const rowHeight = 26;
// 仅渲染视口附近的行；长日志和持续输出不会让 DOM 随缓存规模增长。
const startIndex = computed(() =>
  Math.max(0, Math.min(logs.filtered.value.length - 1, Math.floor(scrollTop.value / rowHeight)) - 8),
);
const rows = computed(() =>
  logs.filtered.value.slice(startIndex.value, startIndex.value + Math.ceil(viewport.value / rowHeight) + 16),
);
const applicationValue = computed({
  get: () => s.packageName || '__all__',
  set: (value: string) => {
    s.packageName = value === '__all__' ? '' : value;
  },
});
const applications = computed(() => [
  { value: '__all__', label: s.appsLoading ? t('正在读取应用列表…') : t('全部应用') },
  ...[...logs.apps.value]
    .sort((a, b) => (a.label || a.packageName).localeCompare(b.label || b.packageName))
    .map((app) => ({
      value: app.packageName,
      label: app.label || app.packageName,
      description: app.label ? app.packageName : undefined,
    })),
]);
const levels = computed(() => [
  { value: 'V', label: t('全部级别') },
  { value: 'D', label: t('Debug 及以上') },
  { value: 'I', label: t('Info 及以上') },
  { value: 'W', label: t('Warn 及以上') },
  { value: 'E', label: t('Error 及以上') },
  { value: 'F', label: 'Fatal' },
]);
const missingUid = computed(() => logs.entries.value.some((entry) => entry.time && !entry.uid));
const watchTarget = watch(
  () => (w.online.value ? w.state.selected : ''),
  () => {
    selected.value = undefined;
    scrollTop.value = 0;
    void logs.start(w.online.value ? w.device.value : undefined);
  },
  { immediate: true },
);
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(() => {
    viewport.value = scroller.value?.clientHeight || 400;
  });
  if (scroller.value) observer.observe(scroller.value);
});
onBeforeUnmount(() => {
  watchTarget();
  observer?.disconnect();
  logs.dispose();
});
async function follow() {
  await nextTick();
  if (!s.paused && scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
}
watch([logs.filtered, () => s.paused], () => {
  if (!s.paused) void follow();
});
function onScroll() {
  scrollTop.value = scroller.value?.scrollTop || 0;
}
function pauseOnNavigate(event: KeyboardEvent) {
  if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) logs.pause();
}
</script>

<template>
  <section class="logs-page" :aria-label="t('设备日志')">
    <div class="logs-toolbar">
      <div class="logs-filters">
        <div class="logs-app-field">
          <label class="sr-only" for="log-app">{{ t('应用') }}</label>
          <AppSearchSelect
            id="log-app"
            v-model="applicationValue"
            :options="applications"
            :aria-label="t('应用')"
            :search-placeholder="t('搜索应用名称或包名')"
            :empty-label="t('没有匹配的应用')"
            :disabled="!w.online.value || s.appsLoading"
            :title="t('按主用户的应用 UID 筛选；共享 UID 的应用可能同时显示。')"
          />
          <Button
            variant="ghost"
            class="icon-button"
            :aria-label="t('刷新应用')"
            :title="t('刷新应用')"
            :disabled="!w.online.value || s.appsLoading"
            @click="logs.loadApps"
            ><RefreshCw :class="{ spin: s.appsLoading }" aria-hidden="true"
          /></Button>
        </div>
        <div class="logs-level-field">
          <label class="sr-only" for="log-level">{{ t('级别') }}</label>
          <AppSelect id="log-level" v-model="s.level" :options="levels" />
        </div>
        <label class="logs-search" for="log-keyword"
          ><Search aria-hidden="true" /><span class="sr-only">{{ t('日志关键词') }}</span>
          <Input
            id="log-keyword"
            v-model="s.keyword"
            :placeholder="t('搜索日志关键词')"
            :maxlength="256"
            type="search"
          />
        </label>
        <label class="checkbox logs-crash-filter" for="log-crashes"
          ><Checkbox id="log-crashes" v-model="s.crashesOnly" />{{ t('仅崩溃') }}</label
        >
      </div>
      <div class="logs-command-bar">
        <div v-if="s.dropped || s.truncated" class="logs-buffer-notice" role="status">
          <span v-if="s.dropped">{{ t('已淘汰 {count} 条旧日志', { count: s.dropped }) }}</span>
          <span v-if="s.truncated">{{ t('{count} 条超长日志已截断', { count: s.truncated }) }}</span>
        </div>
        <div class="logs-actions">
          <Button
            v-if="!s.running && !s.starting && w.online.value"
            variant="ghost"
            class="quiet"
            @click="logs.retry"
            ><RefreshCw aria-hidden="true" />{{ t('重新读取') }}</Button
          >
          <Button
            variant="ghost"
            class="quiet"
            :disabled="!logs.entries.value.length"
            :title="t('暂停滚动时仍继续接收日志。')"
            :aria-pressed="s.paused"
            @click="s.paused ? logs.resume() : logs.pause()"
          >
            <Play v-if="s.paused" aria-hidden="true" /><Pause v-else aria-hidden="true" />{{
              s.paused ? t('继续滚动') : t('暂停滚动')
            }}
          </Button>
          <Button
            variant="ghost"
            class="quiet"
            :disabled="!logs.exportCount.value || s.exporting"
            :title="t('导出当前筛选下已缓存的日志，包含暂停滚动期间收到的内容。')"
            @click="logs.exportLogs"
          >
            <Download aria-hidden="true" />{{ s.exporting ? t('正在导出…') : t('导出日志') }}
          </Button>
        </div>
      </div>
      <p v-if="s.packageName" class="field-hint">
        {{ t('按主用户的应用 UID 筛选；共享 UID 的应用可能同时显示。') }}
      </p>
      <p v-if="s.packageName && missingUid" class="field-hint">
        {{ t('部分日志缺少 UID，无法按应用归属筛选。') }}
      </p>
      <p v-if="s.error || s.appsError" class="logs-error" role="alert">{{ s.error || s.appsError }}</p>
      <p v-if="s.exportNotice" :class="['logs-export-notice', { 'logs-error': s.exportError }]" role="status">
        {{ s.exportNotice }}
      </p>
    </div>
    <div class="logs-column-head" aria-hidden="true">
      <span>{{ t('时间') }}</span
      ><span>{{ t('级别') }}</span
      ><span>PID / TID</span><span>Tag</span><span>{{ t('日志内容') }}</span>
    </div>
    <div
      ref="scroller"
      class="logs-scroller"
      tabindex="0"
      :aria-label="t('日志列表，选择一行查看完整内容')"
      @scroll="onScroll"
      @pointerdown="logs.pause"
      @wheel="
        (e) => {
          if (e.deltaY < 0) logs.pause();
        }
      "
      @keydown="pauseOnNavigate"
    >
      <div v-if="!logs.filtered.value.length" class="logs-empty" role="status">
        {{
          !w.online.value
            ? t('请选择已连接的设备查看日志。')
            : s.starting
              ? t('正在连接 Logcat…')
              : logs.entries.value.length
                ? t('没有匹配的日志')
                : s.error
                  ? t('已停止接收')
                  : t('等待设备输出日志…')
        }}
      </div>
      <div
        v-else
        class="logs-virtual"
        :style="{ height: `${logs.filtered.value.length * rowHeight + 12}px` }"
      >
        <div :style="{ transform: `translateY(${startIndex * rowHeight}px)` }">
          <button
            v-for="entry in rows"
            :key="entry.id"
            type="button"
            :class="[
              'log-row',
              {
                'log-crash': entry.crash,
                'log-warning': entry.level === 'W',
                'log-error': entry.level === 'E',
              },
            ]"
            :aria-label="entry.crash ? `${t('崩溃日志')}: ${entry.raw}` : undefined"
            @focus="logs.pause"
            @click="selected = entry"
          >
            <time :title="entry.time">{{ entry.time.slice(11) }}</time
            ><span class="log-level">{{ entry.level }}</span> <span>{{ entry.pid }}/{{ entry.tid }}</span
            ><span>{{ entry.tag }}</span>
            <span class="log-message">{{ entry.message }}</span>
          </button>
        </div>
      </div>
    </div>
    <AppDialog
      v-if="selected"
      :title="selected.crash ? t('崩溃日志') : t('日志详情')"
      content-class="log-detail-dialog"
      @close="selected = undefined"
    >
      <div class="dialog-body">
        <p class="field-hint">
          UID {{ selected.uid || '—' }} · PID {{ selected.pid || '—' }} · TID {{ selected.tid || '—' }}
        </p>
        <pre class="log-detail-text">{{ selected.raw }}</pre>
      </div>
    </AppDialog>
  </section>
</template>
