<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useColumnWidths, type ColumnDefinition } from '@/composables/column-widths';
import { t } from '../../shared/i18n';

const props = defineProps<{
  id: string;
  label: string;
  columns: readonly ColumnDefinition[];
  storageKey: string;
  tableClass: string;
  scrollClass: string;
  busy?: boolean;
}>();
const widths = useColumnWidths(props.columns, { storageKey: props.storageKey, flexColumn: 0 });
const body = ref<HTMLElement>();
const header = ref<HTMLElement>();
const scrollbarWidth = ref(0);
let observer: ResizeObserver | undefined;

function syncHeader() {
  if (header.value && body.value) header.value.scrollLeft = body.value.scrollLeft;
}
function syncBody() {
  // Tab 聚焦超出可视范围的表头分隔线时，也让正文跟随横向位置。
  if (header.value && body.value && body.value.scrollLeft !== header.value.scrollLeft)
    body.value.scrollLeft = header.value.scrollLeft;
}
onMounted(() => {
  observer = new ResizeObserver(() => {
    if (!body.value) return;
    // 按实际滚动条宽度补齐表头末端，兼容不同平台的常驻与浮动滚动条。
    widths.viewportWidth.value = body.value.clientWidth;
    scrollbarWidth.value = body.value.offsetWidth - body.value.clientWidth;
    void nextTick(syncHeader);
  });
  if (body.value) observer.observe(body.value);
});
onBeforeUnmount(() => observer?.disconnect());
defineExpose({
  scrollToTop: () => {
    if (body.value) body.value.scrollTop = 0;
  },
});
</script>

<template>
  <div class="resizable-table">
    <div class="resizable-table-header">
      <div
        ref="header"
        class="table-header-viewport"
        :style="{ marginRight: `${scrollbarWidth}px` }"
        @scroll="syncBody"
      >
        <table :class="[tableClass, 'resizable-table-head']" :style="widths.style.value" role="presentation">
          <colgroup>
            <col
              v-for="column in widths.columns.value"
              :key="column.label"
              :style="{ width: `${column.width}px` }"
            />
          </colgroup>
          <thead>
            <tr>
              <th v-for="(column, index) in widths.columns.value" :key="column.label">
                <span :class="column.hiddenLabel ? 'sr-only' : 'table-column-label'">{{
                  t(column.label)
                }}</span>
                <span
                  v-if="column.resizable !== false"
                  class="table-column-resizer"
                  :class="{ resizing: widths.resizing.value === index }"
                  role="separator"
                  aria-orientation="vertical"
                  :aria-controls="id"
                  :aria-label="t('调整 {column} 列宽', { column: t(column.label) })"
                  :aria-valuemin="column.min"
                  :aria-valuemax="column.max"
                  :aria-valuenow="column.width"
                  :title="t('拖动调整列宽，双击恢复默认')"
                  tabindex="0"
                  @mousedown="widths.startResize(index, $event)"
                  @keydown="widths.onKey(index, $event)"
                  @dblclick.prevent="widths.reset(index)"
                />
              </th>
            </tr>
          </thead>
        </table>
      </div>
    </div>
    <div
      ref="body"
      class="resizable-table-scroll"
      :class="scrollClass"
      :aria-busy="!!busy"
      @scroll="syncHeader"
    >
      <table :id="id" :class="tableClass" :style="widths.style.value" :aria-label="label">
        <colgroup>
          <col
            v-for="column in widths.columns.value"
            :key="column.label"
            :style="{ width: `${column.width}px` }"
          />
        </colgroup>
        <!-- 保留正文表格的列标题语义，视觉表头独立展示，滚动条只属于下方正文。 -->
        <thead class="sr-only">
          <tr>
            <th v-for="column in columns" :key="column.label" scope="col">{{ t(column.label) }}</th>
          </tr>
        </thead>
        <tbody>
          <slot />
        </tbody>
      </table>
      <slot name="empty" />
    </div>
  </div>
</template>
