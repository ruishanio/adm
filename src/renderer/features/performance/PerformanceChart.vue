<script setup lang="ts">
import { computed } from 'vue';
const props = withDefaults(
  defineProps<{
    label: string;
    points: { time: number; values: (number | null)[]; breakBefore?: boolean }[];
    colors: string[];
    maximum: number;
    maximumLabel: string;
    compact?: boolean;
    showTimeAxis?: boolean;
  }>(),
  { compact: false, showTimeAxis: true },
);
const end = computed(() => props.points.at(-1)?.time ?? Date.now());
// 用真实采样时间定位；缺失点分段绘制，不能把不支持或暂停期间的数据连成连续曲线。
const paths = computed(() =>
  props.colors.map((color, series) => {
    const segments: { x: number; y: number }[][] = [];
    let segment: { x: number; y: number }[] = [];
    for (const point of props.points) {
      if (point.breakBefore) {
        if (segment.length) segments.push(segment);
        segment = [];
      }
      const value = point.values[series];
      if (value == null || !Number.isFinite(value)) {
        if (segment.length) segments.push(segment);
        segment = [];
        continue;
      }
      const x = Math.max(0, Math.min(600, (point.time - (end.value - 120_000)) / 200));
      const y = 100 - Math.max(0, Math.min(1, value / Math.max(1, props.maximum))) * 100;
      segment.push({ x, y });
    }
    if (segment.length) segments.push(segment);
    return {
      color,
      segments: segments.map((points) => ({
        line: points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' '),
        area:
          `M${points[0].x},100 ` +
          points.map((p) => `L${p.x},${p.y}`).join(' ') +
          ` L${points.at(-1)!.x},100 Z`,
      })),
    };
  }),
);
const ticks = computed(() =>
  [120, 60, 0].map((seconds) =>
    new Date(end.value - seconds * 1000).toLocaleTimeString([], {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  ),
);
</script>
<template>
  <div :class="['performance-chart', { 'performance-chart-compact': compact }]">
    <span v-if="!compact" class="performance-axis-max">{{ maximumLabel }}</span>
    <svg viewBox="0 0 600 100" preserveAspectRatio="none" role="img" :aria-label="label">
      <title>{{ label }}</title>
      <path d="M0 0H600 M0 50H600 M150 0V100 M300 0V100 M450 0V100" class="performance-grid" />
      <g v-for="(series, i) in paths" :key="i" :style="{ color: series.color }">
        <g v-for="(segment, index) in series.segments" :key="index">
          <path :d="segment.area" fill="currentColor" fill-opacity="0.06" />
          <path
            :d="segment.line"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            vector-effect="non-scaling-stroke"
          />
        </g>
      </g>
    </svg>
    <div v-if="!compact && showTimeAxis" class="performance-time-axis">
      <span v-for="(tick, i) in ticks" :key="i">{{ tick }}</span>
    </div>
  </div>
</template>
