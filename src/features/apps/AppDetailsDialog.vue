<script setup lang="ts">
import { useApps } from '@/features/apps/state';
const appsFeature = useApps();
import { useDevices } from '@/features/devices/state';
const devicesFeature = useDevices();

import { computed } from 'vue';
import { Trash2, Square, Eraser } from '@lucide/vue';
import { Button } from '@/shared/ui/button/index';
import { useWorkspace } from '@/shared/composables/workspace';
import { t } from '@/shared/i18n/index';
import type { InstalledApp } from '@/shared/api/types';
import AppDialog from '@/shared/ui/AppDialog.vue';
import { sizeLabel } from '@/shared/utils/format';
defineProps<{ returnFocus?: HTMLElement }>();
const w = useWorkspace(),
  s = w.state;
function isOwner(app: InstalledApp) {
  return devicesFeature.state.details?.owner?.split('/')[0] === app.packageName;
}
const details = computed(() => appsFeature.state.application?.details);
const rows = computed(() =>
  details.value
    ? [
        [t('应用名称'), details.value.label || details.value.packageName],
        [t('应用包名'), details.value.packageName],
        [t('版本'), details.value.versionName || '—'],
        [t('版本代码'), details.value.versionCode],
        [t('应用类型'), details.value.system ? t('系统应用') : t('用户应用')],
        [t('启用状态'), details.value.enabled ? t('已启用') : t('已禁用')],
        [t('安装包大小'), details.value.apkSize == null ? '—' : sizeLabel(details.value.apkSize)],
        ['UID', details.value.uid || '—'],
        [t('最低 Android API'), details.value.minimumSdk || '—'],
        [t('目标 Android API'), details.value.targetSdk || '—'],
        [t('首次安装'), details.value.firstInstallTime || '—'],
        [t('最近更新'), details.value.lastUpdateTime || '—'],
        [t('安装来源'), details.value.installer || '—'],
        [t('APK 路径'), details.value.apkPath],
      ]
    : [],
);
const confirmation = computed(() => s.modal === 'app-confirm' || s.modal === 'app-uninstall');
const dialogTitle = computed(() =>
  s.modal === 'app-uninstall'
    ? t('卸载应用')
    : s.modal === 'app-confirm'
      ? appsFeature.state.application?.action === 'clear-data'
        ? t('清除应用数据')
        : t('强制停止应用')
      : t('应用信息'),
);
function close() {
  s.modal = null;
  appsFeature.state.application = undefined;
}
</script>
<template>
  <AppDialog
    v-if="s.modal === 'app-details' || confirmation"
    :title="dialogTitle"
    :busy="!!s.busy"
    :return-focus="returnFocus"
    content-class="app-details-dialog"
    @close="close"
  >
    <div class="dialog-body app-details-body">
      <p class="muted app-target">
        {{ t('目标：{name}', { name: appsFeature.state.application?.deviceName || '' }) }}
        <span class="metadata-inline">
          <span>{{ appsFeature.state.application?.target.serial }}</span
          ><span>{{ t('主用户（用户 0）') }}</span>
        </span>
      </p>
      <template v-if="confirmation && details">
        <p class="app-uninstall-package">{{ details.label || details.packageName }}</p>
        <p v-if="details.label" class="app-confirm-version">{{ details.packageName }}</p>
        <p class="app-confirm-version">
          {{ t('版本') }}：{{ details.versionName || '—' }} ({{ details.versionCode }})
        </p>
        <p v-if="s.modal === 'app-uninstall'">
          {{ t('卸载会删除该用户下的应用及其数据，此操作无法撤销。') }}
        </p>
        <p v-else-if="appsFeature.state.application?.action === 'clear-data'">
          {{ t('将删除此应用的登录状态、设置、数据库及缓存，无法撤销。应用仍会保留安装。') }}
        </p>
        <p v-else>{{ t('将停止此应用的所有关联进程，当前任务可能中断；保存的数据不会被清除。') }}</p>
      </template>
      <dl v-else-if="details" class="app-properties">
        <div v-for="[label, value] in rows" :key="label">
          <dt>{{ label }}</dt>
          <dd>{{ value }}</dd>
        </div>
      </dl>
      <p v-else-if="s.busy" role="status">{{ t('读取应用信息') }}</p>
      <p v-if="appsFeature.state.application?.error" class="inline-result error" role="alert">
        {{ appsFeature.state.application.error }}
      </p>
      <p v-if="details?.system" class="field-hint">{{ t('系统应用仅支持查看。') }}</p>
      <p v-else-if="details && isOwner(details)" class="field-hint">
        {{ t('设备所有者应用不支持停止、清除数据或卸载。') }}
      </p>
    </div>
    <footer class="dialog-footer">
      <template v-if="confirmation">
        <Button
          variant="outline"
          :disabled="!!s.busy"
          @click="appsFeature.state.application?.action ? close() : (s.modal = 'app-details')"
          >{{ t('取消') }}</Button
        >
        <Button
          :class="appsFeature.state.application?.action === 'force-stop' ? '' : 'destructive'"
          :disabled="!!s.busy || !w.online.value || !details || details.system || isOwner(details)"
          @click="s.modal === 'app-uninstall' ? appsFeature.uninstallApp() : appsFeature.confirmAppAction()"
        >
          <Trash2 v-if="s.modal === 'app-uninstall'" aria-hidden="true" />
          <Eraser
            v-else-if="appsFeature.state.application?.action === 'clear-data'"
            aria-hidden="true"
          /><Square v-else aria-hidden="true" />
          {{
            s.modal === 'app-uninstall'
              ? t('确认卸载')
              : appsFeature.state.application?.action === 'clear-data'
                ? t('确认清除数据')
                : t('确认强制停止')
          }}
        </Button>
      </template>
      <template v-else>
        <Button
          v-if="details && !details.system && !isOwner(details)"
          variant="outline"
          :disabled="!!s.busy"
          @click="s.modal = 'app-uninstall'"
          ><Trash2 aria-hidden="true" />{{ t('卸载应用') }}</Button
        >
        <Button variant="outline" :disabled="!!s.busy" @click="close">{{ t('关闭') }}</Button>
      </template>
    </footer>
  </AppDialog>
</template>
