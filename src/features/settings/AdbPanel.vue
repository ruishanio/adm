<script setup lang="ts">
import { computed, ref } from 'vue';
import { File } from '@lucide/vue';
import { useDevices } from '@/features/devices/state';
import { useWorkspace } from '@/shared/composables/workspace';
import type { AdbSource } from '@/shared/api/types';
import { t } from '@/shared/i18n';
import { Button } from '@/shared/ui/button';

const w = useWorkspace();
const devices = useDevices();
const settings = computed(() => devices.state.snapshot?.settings);
const disabled = computed(() => !!w.state.busy || !settings.value);
const pendingSource = ref<AdbSource>();
const searching = ref(false);
const source = computed(() => pendingSource.value ?? settings.value?.adbSource);
const system = computed(() => source.value === 'system');
// 系统文件失效时仍展示所选位置，以便更正。
const location = computed(() => devices.state.snapshot?.adbPath || settings.value?.adbPath);
const pathError = computed(() => {
  const snap = devices.state.snapshot;
  return snap && snap.settings.adbSource === source.value && !snap.adbPath ? snap.error : '';
});

async function setSource(next: AdbSource) {
  if (w.state.busy || next === settings.value?.adbSource) return;
  pendingSource.value = next;
  try {
    await w.run(t('ADB 来源'), async () => {
      await w.api.setAdbSource(next);
      await devices.refreshAfterAdbChange();
    });
  } finally {
    pendingSource.value = undefined;
  }
}
async function search() {
  await w.run(t('自动搜索'), async () => {
    searching.value = true;
    try {
      await w.api.searchSystemAdb();
      await devices.refreshAfterAdbChange();
    } finally {
      searching.value = false;
    }
  });
}
async function choose() {
  await w.run(t('检查 ADB'), async () => {
    // 取消文件选择不触碰原来源，也不清空之前找到的系统路径。
    if (await w.api.chooseAdb()) await devices.refreshAfterAdbChange();
  });
}
</script>
<template>
  <section class="adb-settings">
    <fieldset class="adb-source-group">
      <legend>{{ t('ADB 来源') }}</legend>
      <p class="adb-intro">{{ t('ADM 通过 ADB 连接和管理 Android 设备。') }}</p>
      <label v-for="option in ['bundled', 'system'] as const" :key="option">
        <input
          type="radio"
          name="adm-adb-source"
          :value="option"
          :aria-labelledby="`adb-source-${option}-label`"
          :aria-describedby="`adb-source-${option}-hint`"
          :checked="source === option"
          :disabled="disabled && pendingSource !== option"
          @change="setSource(option)"
        />
        <span class="adb-option-copy">
          <strong :id="`adb-source-${option}-label`">{{
            option === 'bundled' ? t('内置 ADB') : t('系统 ADB')
          }}</strong>
          <span :id="`adb-source-${option}-hint`">
            {{
              option === 'bundled'
                ? t('由 ADM 提供，无需额外配置。')
                : t('使用电脑上已有的 ADB，可自动查找或手动选择文件。')
            }}
          </span>
        </span>
      </label>
    </fieldset>

    <div v-if="system" class="adb-file-section">
      <p v-if="!settings || pendingSource || searching" class="adb-path-caption" role="status">
        {{ t('正在读取…') }}
      </p>
      <template v-else>
        <p v-if="location" class="adb-path-caption">
          {{ settings.adbPath ? t('手动指定的位置') : t('自动搜索结果') }}
        </p>
        <div v-if="location" class="adb-file-location">
          <File aria-hidden="true" />
          <p class="adb-file-path mono" dir="ltr">{{ location }}</p>
        </div>
        <p v-if="pathError" class="inline-result error" role="alert">{{ pathError }}</p>
      </template>
      <div class="adb-system-actions">
        <Button variant="outline" :disabled="disabled" @click="search">
          {{ settings?.adbPath ? t('自动搜索') : t('重新搜索') }}
        </Button>
        <Button variant="outline" :disabled="disabled" @click="choose">{{ t('选择文件…') }}</Button>
      </div>
    </div>
    <p v-else-if="pathError" class="inline-result error" role="alert">{{ pathError }}</p>
    <p
      v-if="w.state.notice?.error && w.state.notice.text !== pathError"
      class="inline-result error"
      role="alert"
    >
      {{ w.state.notice.text }}
    </p>
  </section>
</template>
