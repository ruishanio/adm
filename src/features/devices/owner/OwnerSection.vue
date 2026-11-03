<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ShieldCheck, ChevronRight, RefreshCw, X } from '@lucide/vue';
import { useDevices } from '@/features/devices/state';
import { useInstall } from '@/features/apps/install/state';
import { useOwner } from './state';
import { useWorkspace } from '@/shared/composables/workspace';
import { t } from '@/shared/i18n';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Checkbox } from '@/shared/ui/checkbox';
import AppSelect from '@/shared/ui/AppSelect.vue';
import AppSearchSelect from '@/shared/ui/AppSearchSelect.vue';
import AppDialog from '@/shared/ui/AppDialog.vue';

const w = useWorkspace(),
  devices = useDevices(),
  install = useInstall(),
  owner = useOwner();
const current = computed(() => devices.state.details?.owner);
function splitComponent(component = '') {
  const separator = component.indexOf('/');
  const packageName = separator < 0 ? component : component.slice(0, separator);
  const receiver = separator < 0 ? '' : component.slice(separator + 1);
  // 从设备或安装包读取的相对类名展开显示，避免用户误把点号当成缺失内容。
  return { packageName, receiver: receiver.startsWith('.') ? packageName + receiver : receiver };
}
const currentFields = computed(() => splitComponent(current.value || ''));
const fields = reactive(splitComponent(owner.state.component));
function joinedFields() {
  return fields.packageName || fields.receiver ? `${fields.packageName}/${fields.receiver}` : '';
}
watch(
  () => owner.state.component,
  (component) => {
    // 本地输入保留未完成的内容；外部选择安装包时才重新拆分、展开类名。
    if (component !== joinedFields()) Object.assign(fields, splitComponent(component));
  },
  { flush: 'sync' },
);
const ready = computed(() => !!devices.state.details && w.online.value);
const admins = computed(() => install.state.apk?.admins || []);
const manual = ref(false);
watch(
  () => install.state.apk?.id,
  () => {
    manual.value = false;
  },
);
function updateField(field: 'packageName' | 'receiver', value: string | number) {
  fields[field] = String(value);
  manual.value = true;
  // 任一字段修改（包括清空）都立即同步组件，让原有检查与授权失效。
  owner.state.component = joinedFields();
}
const canCheck = computed(() => !!fields.packageName.trim() && !!fields.receiver.trim());
function checkOwner() {
  if (canCheck.value) void owner.checkOwner();
}
const descriptionId = computed(() =>
  owner.state.error
    ? 'owner-error'
    : owner.state.ownerCheck
      ? 'owner-result'
      : owner.state.scan &&
          (owner.state.scan.loading || owner.state.scan.error || !owner.state.scan.admins.length)
        ? 'owner-scan-result'
        : 'owner-help',
);
// 只有多个接收器才需要选择入口；实际配置始终由两个可编辑字段呈现。
const choice = computed({
  get: () =>
    !manual.value && admins.value.includes(owner.state.component) ? owner.state.component : 'manual',
  set: (value: string) => {
    manual.value = value === 'manual';
    if (!manual.value) owner.state.component = value;
  },
});
const options = computed(() => [
  ...admins.value.map((value) => ({ value, label: splitComponent(value).receiver })),
  { value: 'manual', label: t('自定义组件') },
]);
const deviceOptions = computed(() => {
  const candidates = (owner.state.scan?.admins || []).map((admin) => ({
    ...admin,
    ...splitComponent(admin.component),
  }));
  const counts = new Map<string, number>();
  for (const admin of candidates) counts.set(admin.packageName, (counts.get(admin.packageName) || 0) + 1);
  return candidates.map((admin) => {
    // 列表优先辨认应用，多个接收器才补充短类名；完整组件仍用于检索和选中后的表单。
    const receiver = admin.receiver.startsWith(`${admin.packageName}.`)
      ? admin.receiver.slice(admin.packageName.length + 1)
      : admin.receiver;
    return {
      value: admin.component,
      label: admin.label || admin.packageName,
      description:
        counts.get(admin.packageName)! > 1
          ? `${receiver} · ${admin.packageName}`
          : admin.label && admin.label !== admin.packageName
            ? admin.packageName
            : undefined,
    };
  });
});
const deviceChoice = computed(
  () => deviceOptions.value.find((item) => item.value === owner.state.component)?.value || '',
);
function selectDeviceAdmin(component: string) {
  manual.value = true;
  owner.selectDeviceAdmin(component);
}
const setting = computed(() => owner.state.setting);
const settingFields = computed(() => splitComponent(setting.value?.component));
const settingTrigger = ref<HTMLElement>();
function openSetting(event: MouseEvent) {
  settingTrigger.value = event.currentTarget as HTMLElement;
  owner.openSetting();
}
const removal = computed(() => owner.state.removal);
const removalFields = computed(() => splitComponent(removal.value?.component));
const removalTrigger = ref<HTMLElement>();
function openRemoval(event: MouseEvent) {
  // macOS 鼠标点击按钮不一定聚焦，显式记录触发项，关闭确认窗后恢复键盘操作位置。
  removalTrigger.value = event.currentTarget as HTMLElement;
  void owner.openRemoval();
}
const unsupported = '此管理应用未以测试模式激活，Android 不允许通过 ADB 移除。请在管理应用中解除设备管理。';
const removalMessage = computed(() =>
  removal.value?.check?.summary === unsupported ? t(unsupported) : removal.value?.check?.summary,
);
</script>

<template>
  <section class="info-disclosure owner-section">
    <Button
      variant="ghost"
      class="owner-config-toggle"
      :aria-expanded="owner.state.ownerExpanded"
      aria-controls="owner-configuration"
      @click="owner.state.ownerExpanded = !owner.state.ownerExpanded"
    >
      <ShieldCheck class="icon-owner" aria-hidden="true" />
      <span class="disclosure-title">{{ t('设备所有者') }}</span>
      <span class="disclosure-preview">{{
        ready ? (current ? t('已设置') : t('尚未设置')) : t('读取中…')
      }}</span>
      <ChevronRight class="disclosure-chevron" aria-hidden="true" />
    </Button>
    <div id="owner-configuration" class="owner-form" :hidden="!owner.state.ownerExpanded">
      <p v-if="!ready" class="field-hint" role="status">{{ t('读取中…') }}</p>
      <div v-else-if="current" class="owner-current">
        <dl class="owner-current-identity">
          <dt>{{ t('应用包名') }}</dt>
          <dd>{{ currentFields.packageName }}</dd>
          <dt>{{ t('管理接收器') }}</dt>
          <dd>{{ currentFields.receiver }}</dd>
        </dl>
        <Button variant="outline" :disabled="!!w.state.busy" @click="openRemoval">{{
          t('移除所有者…')
        }}</Button>
      </div>
      <form v-else class="owner-setup" @submit.prevent="checkOwner">
        <div class="owner-fields">
          <label for="owner-device-app">{{ t('设备应用') }}</label>
          <AppSearchSelect
            id="owner-device-app"
            content-class="owner-app-menu"
            :model-value="deviceChoice"
            :options="deviceOptions"
            :placeholder="t('选择管理应用')"
            :aria-label="t('设备应用')"
            :search-placeholder="t('搜索名称、包名或接收器')"
            :empty-label="t('没有匹配的管理应用')"
            :disabled="!!w.state.busy || !deviceOptions.length"
            @update:model-value="selectDeviceAdmin"
          />
          <Button
            v-if="owner.state.scan?.loading"
            type="button"
            variant="ghost"
            class="icon-button owner-field-action"
            :aria-label="t('停止等待')"
            :title="t('停止等待')"
            @click="w.api.cancel()"
            ><X aria-hidden="true"
          /></Button>
          <Button
            v-else
            type="button"
            variant="ghost"
            class="icon-button owner-field-action"
            :disabled="!!w.state.busy"
            :aria-label="t('刷新管理应用')"
            :title="t('刷新管理应用')"
            @click="owner.scanDeviceAdmins"
            ><RefreshCw aria-hidden="true"
          /></Button>
          <template v-if="admins.length > 1">
            <label for="owner-candidate">{{ t('安装包组件') }}</label>
            <AppSelect id="owner-candidate" v-model="choice" :options="options" :disabled="!!w.state.busy" />
          </template>
          <label for="owner-package">{{ t('应用包名') }}</label>
          <Input
            id="owner-package"
            :model-value="fields.packageName"
            :aria-describedby="descriptionId"
            placeholder="com.example.app"
            :disabled="!!w.state.busy"
            :spellcheck="false"
            @update:model-value="updateField('packageName', $event)"
          />
          <label for="owner-receiver">{{ t('管理接收器') }}</label>
          <Input
            id="owner-receiver"
            :model-value="fields.receiver"
            :aria-describedby="descriptionId"
            placeholder="com.example.app.DeviceAdminReceiver"
            :disabled="!!w.state.busy"
            :spellcheck="false"
            @update:model-value="updateField('receiver', $event)"
          />
          <Button
            type="submit"
            variant="ghost"
            class="quiet owner-field-action"
            :disabled="!!w.state.busy || !canCheck"
            >{{ t('检查条件') }}</Button
          >
        </div>
        <div class="owner-setup-feedback">
          <p v-if="owner.state.scan?.loading" id="owner-scan-result" class="field-hint" role="status">
            {{ t('正在扫描设备上的管理应用…') }}
          </p>
          <p
            v-else-if="owner.state.scan?.error"
            id="owner-scan-result"
            class="inline-result error"
            role="alert"
          >
            {{ owner.state.scan.error }}
          </p>
          <p
            v-else-if="owner.state.scan && !deviceOptions.length"
            id="owner-scan-result"
            class="field-hint"
            role="status"
          >
            {{ t('未找到可用的管理应用，请先在设备上安装管理应用。') }}
          </p>
          <p
            v-if="
              !owner.state.ownerCheck &&
              !owner.state.error &&
              (!owner.state.scan ||
                (!owner.state.scan.loading && !owner.state.scan.error && deviceOptions.length))
            "
            id="owner-help"
            class="field-hint"
          >
            {{ t('选择管理应用或手动填写组件，然后检查条件。') }}
          </p>
          <p v-if="owner.state.error" id="owner-error" class="inline-result error" role="alert">
            {{ owner.state.error }}
          </p>
          <p
            v-else-if="owner.state.ownerCheck"
            id="owner-result"
            class="owner-check-result"
            role="status"
            :class="{ error: !owner.state.ownerCheck.canSet && !owner.state.ownerCheck.alreadySet }"
          >
            {{
              owner.state.ownerCheck.canSet
                ? t('检查通过，可以设置设备所有者。')
                : owner.state.ownerCheck.summary
            }}
          </p>
          <div class="owner-actions">
            <Button
              type="button"
              class="primary"
              :disabled="!!w.state.busy || !owner.state.ownerCheck?.canSet || !w.online.value"
              @click="openSetting"
              >{{ t('设置设备所有者') }}</Button
            >
          </div>
        </div>
      </form>
    </div>
  </section>
  <AppDialog
    v-if="w.state.modal === 'owner-set' && setting"
    :title="t('设置设备所有者')"
    :busy="!!w.state.busy"
    content-class="confirm-dialog"
    :return-focus="settingTrigger"
    @close="owner.closeSetting"
  >
    <div class="dialog-body dialog-stack">
      <div>
        <dl class="owner-current-identity">
          <dt>{{ t('应用包名') }}</dt>
          <dd>{{ settingFields.packageName }}</dd>
          <dt>{{ t('管理接收器') }}</dt>
          <dd>{{ settingFields.receiver }}</dd>
        </dl>
        <p class="dialog-subject-description">{{ setting.deviceName }}</p>
      </div>
      <p class="dialog-message">{{ t('此应用将获得设备管理权限，可以管理设备设置及限制。') }}</p>
      <label v-if="owner.state.ownerCheck?.canSet" class="checkbox owner-consent">
        <Checkbox
          v-model="owner.state.consent"
          :disabled="!!w.state.busy"
          :aria-label="t('确认将此设备授权给上述管理应用')"
        />
        <span>{{ t('确认将此设备授权给上述管理应用') }}</span>
      </label>
      <p v-if="w.state.busy" class="field-hint" role="status">{{ t('正在设置设备所有者…') }}</p>
      <p v-if="setting.error" class="inline-result error" role="alert">{{ setting.error }}</p>
    </div>
    <footer class="dialog-footer">
      <Button v-if="w.state.busy" variant="outline" @click="w.api.cancel()">{{ t('停止等待') }}</Button>
      <Button v-else variant="outline" @click="owner.closeSetting">{{
        setting.error ? t('关闭') : t('取消')
      }}</Button>
      <Button
        v-if="owner.state.ownerCheck?.canSet"
        :disabled="!!w.state.busy || !owner.state.consent || !w.online.value"
        @click="owner.setOwner"
        >{{ t('确认设置') }}</Button
      >
    </footer>
  </AppDialog>
  <AppDialog
    v-if="w.state.modal === 'owner-remove' && removal"
    :title="t('移除设备所有者')"
    :busy="!!w.state.busy"
    content-class="confirm-dialog"
    :return-focus="removalTrigger"
    @close="owner.closeRemoval"
  >
    <div class="dialog-body dialog-stack">
      <div>
        <dl class="owner-current-identity">
          <dt>{{ t('应用包名') }}</dt>
          <dd>{{ removalFields.packageName }}</dd>
          <dt>{{ t('管理接收器') }}</dt>
          <dd>{{ removalFields.receiver }}</dd>
        </dl>
        <p class="dialog-subject-description">{{ removal.deviceName }}</p>
      </div>
      <p v-if="w.state.busy" class="field-hint" role="status">
        {{ removal.check ? w.state.busy : t('正在检查移除条件…') }}
      </p>
      <p v-else-if="removal.check?.canRemove" class="dialog-message">
        {{ t('移除后，此应用将失去设备管理权限；应用及其数据会保留。') }}
      </p>
      <p v-else-if="removal.check" class="dialog-message">{{ removalMessage }}</p>
      <p v-else-if="!removal.error" class="field-hint" role="status">{{ t('正在检查移除条件…') }}</p>
      <p v-if="removal.error" class="inline-result error" role="alert">{{ removal.error }}</p>
    </div>
    <footer class="dialog-footer">
      <Button v-if="w.state.busy" variant="outline" @click="w.api.cancel()">{{ t('停止等待') }}</Button>
      <Button v-else variant="outline" @click="owner.closeRemoval">{{
        removal.check?.canRemove ? t('取消') : t('关闭')
      }}</Button>
      <Button
        v-if="removal.check?.canRemove"
        class="destructive"
        :disabled="!!w.state.busy || !w.online.value"
        @click="owner.removeOwner"
        >{{ t('确认移除') }}</Button
      >
    </footer>
  </AppDialog>
</template>
