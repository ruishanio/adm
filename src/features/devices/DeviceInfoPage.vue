<script setup lang="ts">
import { useDevices } from '@/features/devices/state';
const devicesFeature = useDevices();
import OwnerSection from '@/features/devices/owner/OwnerSection.vue';

import { t } from '@/shared/i18n/index';
import { computed } from 'vue';
import {
  Smartphone,
  ArrowRight,
  Cpu,
  ChevronRight,
  RefreshCw,
  MemoryStick,
  HardDrive,
  Battery,
  Timer,
  FileCode,
} from '@lucide/vue';
import { Button } from '@/shared/ui/button/index';
import { useWorkspace } from '@/shared/composables/workspace';
import { deviceStatus } from '@/shared/utils/device';
import { deviceInfoGroups, buildProperties, overviewMetrics } from '@/features/devices/format';
const w = useWorkspace(),
  s = w.state;
const groups = computed(() => deviceInfoGroups(devicesFeature.state.details));
const metrics = computed(() => overviewMetrics(devicesFeature.state.details));
const metricIcons = { memory: MemoryStick, storage: HardDrive, battery: Battery, uptime: Timer };
const disclosures = computed(() => [
  { ...groups.value[1], icon: Cpu, preview: devicesFeature.state.details?.architecture },
  { ...groups.value[2], icon: Battery, preview: devicesFeature.state.details?.system?.runtime.addresses[0] },
  {
    id: 'build',
    title: t('系统构建详情'),
    icon: FileCode,
    preview: devicesFeature.state.details?.system?.buildId,
    rows: buildProperties(devicesFeature.state.details),
  },
]);
</script>
<template>
  <div v-if="!w.online.value" class="empty-state">
    <Smartphone aria-hidden="true" />
    <h2>{{ w.device.value ? deviceStatus(w.device.value) : t('从左侧选择设备') }}</h2>
    <p>
      {{
        w.device.value?.state === 'unauthorized'
          ? t('请解锁设备并允许此电脑进行调试。')
          : t('设备连接后，可查看系统信息并配置设备所有者。')
      }}
    </p>
    <Button variant="outline" @click="s.modal = 'connect'"
      >{{ t('连接设备') }}<ArrowRight aria-hidden="true"
    /></Button>
  </div>
  <div v-else class="device-info-layout">
    <section class="device-overview" :aria-busy="!devicesFeature.state.details">
      <div class="section-heading">
        <h2>{{ t('设备概览') }}</h2>
        <span v-if="!devicesFeature.state.details" class="muted">{{ t('正在读取…') }}</span>
        <Button
          v-else
          variant="ghost"
          class="quiet info-refresh"
          :disabled="!!s.busy"
          @click="devicesFeature.refresh(true)"
        >
          <RefreshCw aria-hidden="true" />{{ t('刷新信息') }}
        </Button>
      </div>
      <dl class="device-metrics">
        <div v-for="metric in metrics" :key="metric.id" :data-metric="metric.id">
          <dt>
            <component :is="metricIcons[metric.id as keyof typeof metricIcons]" aria-hidden="true" />{{
              metric.label
            }}
          </dt>
          <dd>
            <span class="metric-value">{{ metric.value }}</span
            ><span class="metric-detail">{{ metric.detail }}</span>
          </dd>
        </div>
      </dl>
      <div class="device-basics">
        <h3>{{ t('基本信息') }}</h3>
        <dl class="properties device-properties">
          <div v-for="item in groups[0].rows" :key="item.label">
            <dt>{{ item.label }}</dt>
            <dd>{{ item.value }}</dd>
          </div>
        </dl>
      </div>
    </section>
    <section class="device-details" :aria-label="t('系统信息')">
      <details v-for="group in disclosures" :key="group.id" class="info-disclosure" :data-group="group.id">
        <summary>
          <component :is="group.icon" class="icon-info" aria-hidden="true" />
          <span class="disclosure-title">{{ group.title }}</span>
          <span class="disclosure-preview">{{ group.preview }}</span>
          <ChevronRight class="disclosure-chevron" aria-hidden="true" />
        </summary>
        <dl class="properties device-properties">
          <div v-for="item in group.rows" :key="item.label" :class="{ 'property-wide': item.wide }">
            <dt>{{ item.label }}</dt>
            <dd>{{ item.value }}</dd>
          </div>
        </dl>
      </details>
      <OwnerSection />
    </section>
  </div>
</template>
