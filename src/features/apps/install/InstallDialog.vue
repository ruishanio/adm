<script setup lang="ts">
import { useInstall } from '@/features/apps/install/state';
import { t } from '@/shared/i18n/index';
import { computed, ref, watch, nextTick } from 'vue';
import { Package, LoaderCircle, X, Smartphone, AppWindow, TriangleAlert } from '@lucide/vue';
import { Button } from '@/shared/ui/button/index';
import { Input } from '@/shared/ui/input/index';
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
const ownerWarning = ref<HTMLElement>();
watch(
  () => installFeature.state.ownerAfter,
  async (enabled) => {
    if (!enabled) return;
    await nextTick();
    // 窄窗口或英文警告较长时只滚动弹窗正文，保证刚勾选的风险说明可见，外框与按钮位置保持不变。
    ownerWarning.value?.scrollIntoView?.({ block: 'nearest' });
  },
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
const receiverOptions = computed(() => [
  { value: '__none', label: t('选择管理接收器') },
  ...(apk.value?.admins || []).map((component) => ({
    value: component,
    label: receiverLabel(component),
  })),
]);
const receiver = computed({
  get: () => installFeature.state.adminComponent || '__none',
  set: (value: string) => {
    installFeature.state.adminComponent = value === '__none' ? '' : value;
  },
});
// 空态、读取完成和高级选项共用固定外框，长内容仅在正文内部滚动。
const properties = computed(() => [
  [t('版本'), apk.value ? `${apk.value.versionName || '—'} (${apk.value.versionCode || '—'})` : '—'],
  [t('最低 Android API'), apk.value?.minimumSdk || '—'],
]);
</script>
<template>
  <AppDialog
    :title="t('安装应用')"
    :busy="!!s.busy"
    content-class="install-dialog"
    @close="installFeature.closeInstall"
  >
    <div class="install-target" v-if="w.online.value">
      <Smartphone class="icon-device" aria-hidden="true" />
      <span class="muted">{{ t('安装到') }}</span>
      <strong :title="w.title.value">{{ w.title.value }}</strong>
      <span class="install-target-serial" :title="w.device.value?.serial">{{ w.device.value?.serial }}</span>
    </div>
    <div class="dialog-body install-body">
      <section :class="['install-package', { dragging: installFeature.state.dragging }]">
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
          <Button variant="outline" :disabled="!!s.busy" @click="installFeature.chooseApk"
            >{{ t('选择文件') }}…</Button
          >
        </div>
        <p id="install-file-hint" class="install-file-hint">
          <span>{{ t('也可拖入 APK 文件') }}</span
          ><span v-if="apk">{{ sizeLabel(apk.size) }}</span>
        </p>
        <div class="install-app-identity">
          <img v-if="apk?.icon && !iconFailed" :src="apk.icon" alt="" @error="iconFailed = true" />
          <AppWindow v-else class="icon-install" aria-hidden="true" />
          <div>
            <strong :title="apk?.label || apk?.packageName">{{
              apk ? apk.label || apk.packageName : t('应用信息')
            }}</strong>
            <span :title="apk?.packageName" class="muted">{{
              apk ? (apk.label ? apk.packageName : t('未能读取应用名称')) : t('选择 APK 后显示名称和图标')
            }}</span>
          </div>
        </div>
        <dl class="install-properties">
          <div v-for="[label, value] in properties" :key="label">
            <dt>{{ label }}</dt>
            <dd>{{ value }}</dd>
          </div>
        </dl>
      </section>
      <section class="install-options" :aria-label="t('高级选项')">
        <h3>{{ t('高级选项') }}</h3>
        <label class="checkbox">
          <Checkbox
            v-model="installFeature.state.ownerAfter"
            :disabled="!!s.busy || !apk?.admins.length"
            :aria-label="t('安装后配置设备所有者')"
            :aria-describedby="installFeature.state.ownerAfter ? 'install-owner-warning' : undefined"
          />
          {{ t('安装后配置设备所有者') }}
        </label>
        <p v-if="apk && !apk.admins.length" class="field-hint">
          {{ t('此 APK 未声明可用的设备管理接收器。') }}
        </p>
        <template v-if="installFeature.state.ownerAfter">
          <div class="install-receiver-row">
            <label for="install-admin">{{ t('管理接收器') }}</label>
            <AppSelect
              v-if="(apk?.admins.length || 0) > 1"
              id="install-admin"
              v-model="receiver"
              :options="receiverOptions"
              :disabled="!!s.busy"
            />
            <span v-else class="install-single-receiver" :title="installFeature.state.adminComponent">{{
              receiverLabel(installFeature.state.adminComponent)
            }}</span>
          </div>
          <div id="install-owner-warning" ref="ownerWarning" class="install-owner-warning" role="note">
            <TriangleAlert aria-hidden="true" />
            <div>
              <p>
                {{
                  t(
                    '此应用将获得设备管理权限，可以限制设备功能。正式管理应用通常无法通过 ADB 移除；若应用不提供解除功能，可能需要恢复出厂设置并清除数据。',
                  )
                }}
              </p>
              <p>{{ t('安装后仍需检查条件并单独确认，不会自动授权。') }}</p>
            </div>
          </div>
        </template>
      </section>
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
      <span class="install-upgrade-hint">{{ t('覆盖升级保留应用数据') }}</span>
      <Button v-if="s.busy" variant="outline" @click="w.api.cancel">{{ t('停止等待') }}</Button>
      <Button v-else variant="outline" @click="installFeature.closeInstall">{{ t('取消') }}</Button>
      <Button class="primary" :disabled="!installFeature.canInstall.value" @click="installFeature.install">{{
        t('安装')
      }}</Button>
    </footer>
  </AppDialog>
</template>
