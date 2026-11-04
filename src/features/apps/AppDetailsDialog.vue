<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { ChevronUp } from '@lucide/vue';
import { DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuPortal, DropdownMenuContent } from 'reka-ui';
import AppManagementItems from './AppManagementItems.vue';
import { useApps } from './state';
import { useDevices } from '@/features/devices/state';
import InstalledAppInfo from './InstalledAppInfo.vue';
import type { useAppResources } from './resources';
import { Button } from '@/shared/ui/button/index';
import { useWorkspace } from '@/shared/composables/workspace';
import { t } from '@/shared/i18n/index';
import type { InstalledApp, AppAction } from '@/shared/api/types';
import AppDialog from '@/shared/ui/AppDialog.vue';
defineProps<{ returnFocus?: HTMLElement; resources: ReturnType<typeof useAppResources> }>();
const appsFeature = useApps();
const devicesFeature = useDevices();
const footer = ref<HTMLElement>();
const moreButton = ref<InstanceType<typeof Button>>();
const section = ref<string | number>('overview');
const fromDetails = ref(false);
const w = useWorkspace(),
  s = w.state;
function isOwner(app: InstalledApp) {
  return devicesFeature.state.details?.owner?.split('/')[0] === app.packageName;
}
const application = computed(() => appsFeature.state.application);
const details = computed(() => application.value?.details);
// 列表快照仅用于立即绘制；所有写操作仍须等设备返回完整详情。
const subject = computed(() => details.value ?? application.value?.summary);
const actionsReady = computed(() => !!details.value && w.online.value && !s.busy);
const canManage = computed(
  () => actionsReady.value && !!details.value && !details.value.system && !isOwner(details.value),
);
const canLaunch = computed(
  () =>
    actionsReady.value &&
    !!details.value &&
    !details.value.system &&
    details.value.enabled &&
    !!details.value.launchComponent,
);
const reading = computed(() => !!application.value?.reading);
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
function requestAction(action: Exclude<AppAction, 'launch'> | 'uninstall') {
  if (!application.value || !canManage.value) return;
  fromDetails.value = true;
  application.value.action = action;
  s.modal = action === 'uninstall' ? 'app-uninstall' : 'app-confirm';
  // 详情与确认共用弹窗，切换后显式聚焦取消，避免回车误卸载。
  nextTick(() => footer.value?.querySelector('button')?.focus());
}
function close() {
  if (reading.value) {
    void w.api.cancel();
  }
  const current = application.value;
  if (confirmation.value && current && fromDetails.value) {
    fromDetails.value = false;
    current.action = undefined;
    current.error = '';
    s.modal = 'app-details';
    nextTick(() => moreButton.value?.$el.focus());
    return;
  }
  s.modal = null;
  appsFeature.state.application = undefined;
}
</script>
<template>
  <AppDialog
    v-if="s.modal === 'app-details' || confirmation"
    :title="dialogTitle"
    :busy="!!s.busy && !reading"
    :return-focus="returnFocus"
    :content-class="confirmation ? 'confirm-dialog' : 'app-details-dialog'"
    @close="close"
  >
    <div class="dialog-body dialog-stack">
      <InstalledAppInfo
        v-if="!confirmation && subject && application"
        v-model="section"
        :app="subject"
        :details="details"
        :reading="reading"
        :device-name="application.deviceName"
        :serial="application.target.serial"
        :resources="resources"
      />
      <template v-else-if="confirmation && subject">
        <div class="dialog-subject">
          <div>
            <p class="dialog-subject-name">{{ subject.label || subject.packageName }}</p>
            <p class="dialog-subject-description">{{ appsFeature.state.application?.deviceName }}</p>
          </div>
        </div>
        <p v-if="s.modal === 'app-uninstall'" class="dialog-message">
          {{ t('卸载将删除应用及其数据，此操作无法撤销。') }}
        </p>
        <p v-else-if="appsFeature.state.application?.action === 'clear-data'" class="dialog-message">
          {{ t('将删除此应用的登录状态、设置、数据库及缓存，无法撤销。应用仍会保留安装。') }}
        </p>
        <p v-else class="dialog-message">
          {{ t('将停止此应用的所有关联进程，当前任务可能中断；保存的数据不会被清除。') }}
        </p>
      </template>
      <p v-if="confirmation && reading" class="sr-only" role="status">{{ t('读取应用信息') }}</p>
      <p v-if="appsFeature.state.application?.error" class="inline-result error" role="alert">
        {{ appsFeature.state.application.error }}
      </p>
      <p v-if="subject?.system" class="field-hint">{{ t('系统应用仅支持查看。') }}</p>
      <p v-else-if="subject && isOwner(subject)" class="field-hint">
        {{ t('设备所有者应用不支持停止、清除数据或卸载。') }}
      </p>
      <span
        v-if="!confirmation && !reading && (s.busy || s.notice)"
        class="muted app-info-feedback"
        :role="s.notice?.error ? 'alert' : 'status'"
        >{{ s.busy || s.notice?.text }}</span
      >
    </div>
    <footer ref="footer" class="dialog-footer">
      <template v-if="confirmation">
        <Button variant="outline" :disabled="!!s.busy && !reading" @click="close">{{ t('取消') }}</Button>
        <Button
          :class="appsFeature.state.application?.action === 'force-stop' ? 'primary' : 'destructive'"
          :disabled="!canManage"
          @click="s.modal === 'app-uninstall' ? appsFeature.uninstallApp() : appsFeature.confirmAppAction()"
        >
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
        <div v-if="subject" class="app-info-actions" role="group" :aria-label="t('操作')">
          <Button variant="ghost" :disabled="!canLaunch" @click="details && appsFeature.launchApp(details)">
            {{ t('打开应用') }}
          </Button>
          <DropdownMenuRoot>
            <DropdownMenuTrigger as-child :disabled="!canManage">
              <Button
                ref="moreButton"
                variant="ghost"
                class="icon-button"
                :aria-label="t('{name} 的更多操作', { name: subject.label || subject.packageName })"
                :title="t('{name} 的更多操作', { name: subject.label || subject.packageName })"
              >
                <ChevronUp aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent
                class="device-context-menu app-action-menu app-info-menu"
                side="top"
                align="start"
                :side-offset="4"
                @close-auto-focus="
                  (event) => {
                    if (confirmation) event.preventDefault();
                  }
                "
              >
                <AppManagementItems dropdown :disabled="!canManage" @action="requestAction" />
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>
        </div>
        <Button variant="outline" :disabled="!!s.busy && !reading" @click="close">{{ t('关闭') }}</Button>
      </template>
    </footer>
  </AppDialog>
</template>
