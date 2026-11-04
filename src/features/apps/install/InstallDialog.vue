<script setup lang="ts">
import { useInstall } from '@/features/apps/install/state';
import { t } from '@/shared/i18n/index';
import { computed, ref, watch } from 'vue';
import { Package, LoaderCircle, X, Smartphone, AppWindow, TriangleAlert, ChevronRight } from '@lucide/vue';
import { Input } from '@/shared/ui/input/index';
import { Button } from '@/shared/ui/button/index';
import { Checkbox } from '@/shared/ui/checkbox/index';
import { useWorkspace } from '@/shared/composables/workspace';
import { sizeLabel } from '@/shared/utils/format';
import AppDialog from '@/shared/ui/AppDialog.vue';
import AppSelect from '@/shared/ui/AppSelect.vue';

const installFeature = useInstall(),
  w = useWorkspace(),
  s = w.state;
const apk = computed(() => installFeature.state.apk);
const iconFailed = ref(false);
const ownerOption = ref<HTMLLabelElement>();
const advancedToggle = ref<HTMLElement>();
const fileRow = ref<HTMLElement>();
const reviewing = computed(() => installFeature.state.step === 'review');
watch(
  reviewing,
  (onReview) => {
    // 切页后让键盘焦点回到当前步骤，避免连续按回车触发安装。
    if (onReview) advancedToggle.value?.focus();
    else fileRow.value?.querySelector<HTMLButtonElement>('.install-choose-file')?.focus();
  },
  { flush: 'post' },
);
watch(
  () => apk.value?.id,
  () => {
    iconFailed.value = false;
  },
);
function receiverLabel(component: string) {
  const name = component.split('/')[1] || component;
  const prefix = apk.value?.packageName || '';
  return prefix && name.startsWith(prefix + '.') ? name.slice(prefix.length + 1) : name.replace(/^\./, '');
}
const receiverOptions = computed(() =>
  (apk.value?.admins || []).map((component) => ({
    value: component,
    label: receiverLabel(component),
  })),
);
const properties = computed(() => [
  [t('应用包名'), apk.value?.packageName || '—'],
  [t('版本'), apk.value ? `${apk.value.versionName || '—'} (${apk.value.versionCode || '—'})` : '—'],
  [t('最低 Android API'), apk.value?.minimumSdk || '—'],
]);
</script>
<template>
  <AppDialog
    :title="reviewing ? t('确认安装（2/2）') : t('选择安装包（1/2）')"
    :busy="!!s.busy"
    content-class="install-dialog"
    @close="installFeature.closeInstall"
  >
    <div class="install-target" v-if="reviewing && w.online.value">
      <Smartphone class="icon-device" aria-hidden="true" />
      <span class="muted">{{ t('安装到') }}</span>
      <strong :title="w.title.value">{{ w.title.value }}</strong>
      <span
        v-if="w.device.value?.serial !== w.title.value"
        class="install-target-serial"
        :title="w.device.value?.serial"
        >{{ w.device.value?.serial }}</span
      >
    </div>
    <div class="dialog-body install-body">
      <section
        v-if="!reviewing"
        ref="fileRow"
        :class="['install-package', { dragging: installFeature.state.dragging }]"
        :aria-label="t('安装包')"
      >
        <div class="install-file-row">
          <label for="install-apk-file">{{ t('安装包') }}</label>
          <div class="install-file-control">
            <Package class="icon-install" aria-hidden="true" />
            <Input
              id="install-apk-file"
              :model-value="apk?.fileName || ''"
              :placeholder="t('未选择安装包')"
              :title="apk?.fileName"
              :disabled="!!s.busy"
              aria-describedby="install-file-hint"
              readonly
            />
            <Button
              v-if="apk"
              variant="ghost"
              class="icon-button"
              :aria-label="t('移除安装包')"
              :disabled="!!s.busy"
              @click="installFeature.removeApk"
              ><X aria-hidden="true"
            /></Button>
          </div>
          <Button
            class="install-choose-file"
            variant="outline"
            :disabled="!!s.busy"
            @click="installFeature.chooseApk"
            >{{ t('选择文件') }}…</Button
          >
        </div>
        <p id="install-file-hint" class="install-file-hint">
          {{ apk ? sizeLabel(apk.size) : t('也可拖入 APK 文件') }}
        </p>
      </section>
      <template v-else-if="apk">
        <section
          class="install-package"
          :class="{ dragging: installFeature.state.dragging }"
          :aria-label="t('应用信息')"
        >
          <dl class="install-properties">
            <div>
              <dt>{{ t('应用名称') }}</dt>
              <dd class="install-app-identity">
                <img v-if="apk.icon && !iconFailed" :src="apk.icon" alt="" @error="iconFailed = true" />
                <AppWindow v-else class="icon-install" aria-hidden="true" />
                <strong :title="apk.label || undefined">{{ apk.label || t('未能读取应用名称') }}</strong>
                <small class="install-package-type" :class="{ 'test-only': apk.testOnly }">{{
                  apk.testOnly ? t('测试包') : t('普通包')
                }}</small>
              </dd>
            </div>
            <div v-for="[label, value] in properties" :key="label">
              <dt>{{ label }}</dt>
              <dd :title="value">{{ value }}</dd>
            </div>
            <div>
              <dt>{{ t('安装包') }}</dt>
              <dd class="install-reviewed-file">
                <span :title="apk.fileName">{{ apk.fileName }}</span
                ><small>{{ sizeLabel(apk.size) }}</small>
              </dd>
            </div>
          </dl>
        </section>
        <!-- 使用原生折叠控件；每次打开弹窗从收起开始，同次收放不清空已选配置。 -->
        <details :key="apk.id" class="install-options">
          <summary ref="advancedToggle">
            <span>{{ t('高级选项') }}</span>
            <ChevronRight aria-hidden="true" />
            <span v-if="installFeature.state.ownerConsent" class="install-options-preview">{{
              t('设备所有者')
            }}</span>
          </summary>
          <div class="install-options-body">
            <label ref="ownerOption" class="checkbox">
              <Checkbox
                :model-value="!!installFeature.state.ownerConsent"
                aria-haspopup="dialog"
                @update:model-value="(enabled) => installFeature.requestOwnerAfter(enabled === true)"
                :disabled="!!s.busy || !apk?.admins.length"
                :aria-label="t('安装后配置设备所有者')"
              />
              {{ t('安装后配置设备所有者') }}
            </label>
            <div v-if="installFeature.state.ownerConsent" class="install-receiver-row">
              <span class="muted">{{ t('管理接收器') }}</span>
              <span class="install-single-receiver" :title="installFeature.state.ownerConsent.component">{{
                receiverLabel(installFeature.state.ownerConsent.component)
              }}</span>
            </div>
            <p v-if="!apk.admins.length" class="field-hint">
              {{ t('此 APK 未声明可用的设备管理接收器。') }}
            </p>
          </div>
        </details>
      </template>
    </div>
    <div
      v-if="s.busy || s.notice?.error"
      :class="['install-feedback', { error: s.notice?.error }]"
      :role="s.notice?.error ? 'alert' : 'status'"
    >
      <LoaderCircle v-if="s.busy" class="spinning" aria-hidden="true" /><span>{{
        s.busy || s.notice?.text
      }}</span>
    </div>
    <footer class="dialog-footer">
      <Button
        v-if="reviewing"
        variant="ghost"
        class="dialog-secondary-action"
        :disabled="!!s.busy"
        @click="installFeature.changeStep('file')"
        >{{ t('返回') }}</Button
      >
      <Button v-if="s.busy" variant="outline" @click="installFeature.stopWaiting">{{ t('停止等待') }}</Button>
      <Button v-else variant="outline" @click="installFeature.closeInstall">{{ t('取消') }}</Button>
      <Button
        v-if="!reviewing"
        class="primary"
        :disabled="!apk || !!s.busy"
        @click="installFeature.changeStep('review')"
        >{{ t('下一步') }}</Button
      >
      <Button
        v-else
        class="primary"
        :disabled="!installFeature.canInstall.value"
        @click="installFeature.install"
        >{{ t('安装') }}</Button
      >
    </footer>
    <AppDialog
      v-if="installFeature.state.ownerWarningOpen && apk"
      :title="t('安装后配置设备所有者')"
      content-class="confirm-dialog install-owner-confirm"
      :return-focus="ownerOption?.control || undefined"
      @close="installFeature.finishOwnerWarning(false)"
    >
      <div class="dialog-body dialog-stack">
        <dl class="owner-current-identity">
          <dt>{{ t('目标设备') }}</dt>
          <dd>
            {{ w.title.value }}
            <span v-if="w.device.value?.serial !== w.title.value" class="muted"
              >({{ w.device.value?.serial }})</span
            >
          </dd>
          <dt>{{ t('应用名称') }}</dt>
          <dd>
            {{ apk.label || apk.packageName }}
            <span v-if="apk.label && apk.label !== apk.packageName" class="install-owner-package muted">{{
              apk.packageName
            }}</span>
          </dd>
          <dt class="install-owner-receiver-label">
            <label v-if="apk.admins.length > 1" for="install-admin">{{ t('管理接收器') }}</label
            ><template v-else>{{ t('管理接收器') }}</template>
          </dt>
          <dd>
            <AppSelect
              v-if="apk.admins.length > 1"
              id="install-admin"
              v-model="installFeature.state.adminComponent"
              :placeholder="t('选择管理接收器')"
              :options="receiverOptions"
            />
            <span v-else :title="installFeature.state.adminComponent">{{
              receiverLabel(installFeature.state.adminComponent)
            }}</span>
          </dd>
        </dl>
        <div class="install-owner-warning">
          <TriangleAlert aria-hidden="true" />
          <p class="dialog-message">
            {{
              t(
                '此应用将获得设备管理权限，可以限制设备功能。正式管理应用通常无法通过 ADB 移除；若应用不提供解除功能，可能需要恢复出厂设置并清除数据。',
              )
            }}
          </p>
        </div>
        <p class="field-hint">{{ t('安装成功后将自动检查设备，符合条件时设置设备所有者。') }}</p>
      </div>
      <footer class="dialog-footer">
        <Button variant="outline" @click="installFeature.finishOwnerWarning(false)">{{ t('取消') }}</Button>
        <Button
          class="primary"
          :disabled="!apk.admins.includes(installFeature.state.adminComponent)"
          @click="installFeature.finishOwnerWarning(true)"
          >{{ t('确定') }}</Button
        >
      </footer>
    </AppDialog>
  </AppDialog>
</template>
