<script setup lang="ts">
import { t } from '../../../shared/i18n';
import { computed } from 'vue';
import {
  Smartphone,
  ArrowRight,
  Cpu,
  ShieldCheck,
  ChevronRight,
  RefreshCw,
  MemoryStick,
  HardDrive,
  Battery,
  Timer,
  FileCode,
} from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useWorkbench } from '@/composables/workbench';
import { deviceStatus } from '../../../shared/contracts';
import { deviceInfoGroups, buildProperties, overviewMetrics } from '@/lib/device-info';
const w = useWorkbench(),
  s = w.state;
const groups = computed(() => deviceInfoGroups(s.details));
const metrics = computed(() => overviewMetrics(s.details));
const metricIcons = { memory: MemoryStick, storage: HardDrive, battery: Battery, uptime: Timer };
const disclosures = computed(() => [
  { ...groups.value[1], icon: Cpu, preview: s.details?.architecture },
  { ...groups.value[2], icon: Battery, preview: s.details?.system?.runtime.addresses[0] },
  {
    id: 'build',
    title: t('系统构建详情'),
    icon: FileCode,
    preview: s.details?.system?.buildId,
    rows: buildProperties(s.details),
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
    <section class="device-overview" :aria-busy="!s.details">
      <div class="section-heading">
        <h2>{{ t('设备概览') }}</h2>
        <span v-if="!s.details" class="muted">{{ t('正在读取…') }}</span>
        <Button
          v-else
          variant="ghost"
          class="quiet info-refresh"
          :disabled="!!s.busy"
          @click="w.refresh(true)"
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
      <section class="info-disclosure owner-section">
        <Button
          variant="ghost"
          class="owner-config-toggle"
          :aria-expanded="s.ownerExpanded"
          aria-controls="owner-configuration"
          @click="s.ownerExpanded = !s.ownerExpanded"
        >
          <ShieldCheck class="icon-owner" aria-hidden="true" />
          <span class="disclosure-title">{{ t('设备所有者') }}</span>
          <ChevronRight class="disclosure-chevron" aria-hidden="true" />
        </Button>
        <div id="owner-configuration" class="owner-form" :hidden="!s.ownerExpanded">
          <p class="owner-identity" :class="{ 'owner-unset': !s.details?.owner }">
            <span>{{ t('当前所有者') }}</span>
            {{ s.details ? s.details.owner || t('尚未设置') : t('读取中…') }}
          </p>
          <div v-if="s.apk?.admins.length" class="form-row">
            <label for="apk-admin">{{ t('安装包组件') }}</label
            ><select id="apk-admin" v-model="s.component" :disabled="!!s.busy">
              <option v-for="component in s.apk.admins" :key="component" :value="component">
                {{ component }}
              </option>
              <option v-if="!s.apk.admins.includes(s.component)" :value="s.component">
                {{ t('自定义组件') }}
              </option>
            </select>
          </div>
          <div class="form-row">
            <label for="owner-component">{{ t('管理组件') }}</label>
            <div class="component-input">
              <Input
                id="owner-component"
                v-model="s.component"
                :aria-describedby="s.ownerCheck ? 'owner-result' : 'owner-help'"
                placeholder="com.example.app/.DeviceAdminReceiver"
                :disabled="!!s.busy"
                :spellcheck="false"
              /><Button variant="outline" :disabled="!!s.busy || !s.component.trim()" @click="w.checkOwner">{{
                t('检查条件')
              }}</Button>
            </div>
          </div>
          <div
            v-if="s.ownerCheck"
            id="owner-result"
            role="status"
            :class="['inline-result', s.ownerCheck.canSet || s.ownerCheck.alreadySet ? 'success' : 'error']"
          >
            {{ s.ownerCheck.summary }}
          </div>
          <p v-else id="owner-help" class="field-hint">
            {{ t('先安装管理应用，再检查组件、主用户和账号状态。') }}
          </p>
          <div class="owner-actions">
            <label class="checkbox"
              ><Checkbox
                v-model="s.consent"
                :disabled="!!s.busy || !s.ownerCheck?.canSet"
                :aria-label="t('确认将此设备授权给上述管理应用')"
              /><span>{{ t('确认将此设备授权给上述管理应用') }}</span></label
            ><Button
              class="primary"
              :disabled="!!s.busy || !s.consent || !s.ownerCheck?.canSet"
              @click="w.setOwner"
              >{{ t('设置设备所有者') }}</Button
            >
          </div>
        </div>
      </section>
    </section>
  </div>
</template>
