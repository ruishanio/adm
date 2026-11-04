<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { Check, Copy } from '@lucide/vue';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs/index';
import InstalledAppIcon from './InstalledAppIcon.vue';
import type { useAppResources } from './resources';
import type { AppDetails, InstalledApp } from '@/shared/api/types';
import { useWorkspace } from '@/shared/composables/workspace';
import { t } from '@/shared/i18n/index';
import { Button } from '@/shared/ui/button/index';
import { sizeLabel } from '@/shared/utils/format';

const section = defineModel<string | number>({ required: true });
const props = defineProps<{
  app: InstalledApp;
  details?: AppDetails;
  reading: boolean;
  deviceName: string;
  serial: string;
  resources: ReturnType<typeof useAppResources>;
}>();
const workspace = useWorkspace();
const version = computed(() => {
  const name = props.details ? props.details.versionName : props.app.version?.name;
  const code = props.details ? props.details.versionCode : props.app.version?.code;
  return name && code && name !== code ? `${name} (${code})` : name || code || '—';
});
const technical = computed(() =>
  [
    [t('最低 Android API'), props.details?.minimumSdk],
    [t('目标 Android API'), props.details?.targetSdk],
    ['UID', props.details?.uid],
    [t('首次安装'), props.details?.firstInstallTime],
    [t('安装来源'), props.details?.installer],
    [t('APK 路径'), props.app.apkPath],
  ].filter(([, value]) => value && value !== 'null'),
);
const hasLabel = computed(() => props.app.label && props.app.label !== props.app.packageName);
const copyState = ref<'idle' | 'pending' | 'done'>('idle');
const copyError = ref('');
let reset: ReturnType<typeof setTimeout> | undefined;
let active = true;
onBeforeUnmount(() => {
  active = false;
  clearTimeout(reset);
});
async function copyPackage() {
  if (copyState.value === 'pending') return;
  clearTimeout(reset);
  copyState.value = 'pending';
  copyError.value = '';
  try {
    // 复制使用当前详情的完整包名；成功反馈留在按钮旁，不覆盖工作区的提示。
    await workspace.api.copyPackage(props.app.packageName);
    if (!active) return;
    copyState.value = 'done';
    reset = setTimeout(() => (copyState.value = 'idle'), 2000);
  } catch (error) {
    if (!active) return;
    copyState.value = 'idle';
    copyError.value = error instanceof Error ? error.message : String(error);
  }
}
</script>
<template>
  <header class="app-info-identity">
    <InstalledAppIcon
      :cache-key="resources.iconKey(app)"
      :src="resources.icons[resources.iconKey(app)]"
      @visible="resources.requestIcon(app)"
    />
    <div class="app-info-heading">
      <h3 v-if="hasLabel">{{ app.label }}</h3>
      <div class="app-info-package">
        <span v-if="hasLabel">{{ app.packageName }}</span>
        <h3 v-else>{{ app.packageName }}</h3>
        <Button
          variant="ghost"
          class="icon-button"
          :aria-label="t('复制包名')"
          :title="t('复制包名')"
          :disabled="!!workspace.state.busy"
          @click="copyPackage"
          ><Check v-if="copyState === 'done'" class="app-copy-done" aria-hidden="true" /><Copy
            v-else
            aria-hidden="true"
        /></Button>
        <span class="sr-only" role="status">{{ copyState === 'done' ? t('包名已复制。') : '' }}</span>
      </div>
    </div>
  </header>
  <p v-if="copyError" class="inline-result error" role="alert">{{ copyError }}</p>
  <Tabs v-model="section" class="app-info-sections">
    <TabsList class="tabs app-info-tabs" :aria-label="t('应用信息')">
      <TabsTrigger value="overview">{{ t('概览') }}</TabsTrigger>
      <TabsTrigger value="technical">{{ t('技术信息') }}</TabsTrigger>
    </TabsList>
    <TabsContent value="overview" class="app-info-panel">
      <dl class="app-info-fields">
        <dt>{{ t('目标设备') }}</dt>
        <dd class="metadata-inline app-info-target">
          {{ deviceName }}<span v-if="serial && serial !== deviceName">{{ serial }}</span>
        </dd>
        <dt>{{ t('版本') }}</dt>
        <dd>{{ version }}</dd>
        <dt>{{ t('应用类型') }}</dt>
        <dd>{{ app.system ? t('系统应用') : t('用户应用') }}</dd>
        <dt>{{ t('启用状态') }}</dt>
        <dd>{{ app.enabled ? t('已启用') : t('已禁用') }}</dd>
        <dt>{{ t('安装包大小') }}</dt>
        <dd>{{ sizeLabel(app.apkSize) }}</dd>
        <dt>{{ t('最近更新') }}</dt>
        <dd role="status">{{ reading ? t('读取中…') : details?.lastUpdateTime || '—' }}</dd>
      </dl>
    </TabsContent>
    <TabsContent value="technical" class="app-info-panel">
      <p v-if="reading" class="muted" role="status">{{ t('读取中…') }}</p>
      <dl class="app-info-fields">
        <template v-for="[label, value] in technical" :key="label">
          <dt>{{ label }}</dt>
          <dd>{{ value }}</dd>
        </template>
      </dl>
    </TabsContent>
  </Tabs>
</template>
