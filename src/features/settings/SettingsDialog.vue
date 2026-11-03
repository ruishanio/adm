<script setup lang="ts">
import { useDevices } from '@/features/devices/state';
const devicesFeature = useDevices();

import { t } from '@/shared/i18n/index';
import { ref } from 'vue';
import { SlidersHorizontal, Terminal, Smartphone, Info } from '@lucide/vue';
import { Button } from '@/shared/ui/button/index';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/ui/tabs/index';
import AppDialog from '@/shared/ui/AppDialog.vue';
import AppSelect from '@/shared/ui/AppSelect.vue';
import { useWorkspace } from '@/shared/composables/workspace';
import AboutPanel from '@/features/settings/AboutPanel.vue';
import { language, setLanguage, isLocale, languageOptions } from '@/shared/i18n/index';
const w = useWorkspace(),
  s = w.state;
const section = ref('general');
async function choose() {
  await w.run(t('检查 ADB'), async () => {
    if (await w.api.chooseAdb()) await devicesFeature.refresh();
  });
}
async function reset() {
  await w.run(t('恢复默认 ADB'), async () => {
    await w.api.resetAdb();
    await devicesFeature.refresh();
  });
}
async function restore() {
  await w.run(t('恢复设备列表'), async () => {
    await w.api.restore();
    await devicesFeature.refresh();
  });
}
async function changeLanguage(next: string) {
  if (!isLocale(next)) return;
  await w.run(t('切换语言'), async () => {
    // 保存成功后再切换界面，避免磁盘写入失败时显示与偏好不一致。
    await w.api.language(next);
    setLanguage(next);
    if (devicesFeature.state.snapshot) devicesFeature.state.snapshot.settings.language = next;
  });
}
</script>
<template>
  <AppDialog :title="t('设置')" content-class="settings-dialog" :busy="!!s.busy" @close="s.modal = null">
    <Tabs v-model="section" orientation="vertical" class="settings-layout">
      <TabsList class="settings-navigation" :aria-label="t('设置分类')">
        <TabsTrigger value="general"><SlidersHorizontal aria-hidden="true" />{{ t('通用') }}</TabsTrigger>
        <TabsTrigger value="adb"><Terminal aria-hidden="true" />{{ t('ADB 工具') }}</TabsTrigger>
        <TabsTrigger value="devices"><Smartphone aria-hidden="true" />{{ t('设备列表') }}</TabsTrigger>
        <TabsTrigger value="about"><Info aria-hidden="true" />{{ t('关于') }}</TabsTrigger>
      </TabsList>
      <div class="settings-content">
        <TabsContent value="general">
          <label class="field" for="language-preference"
            >{{ t('界面语言') }}
            <AppSelect
              id="language-preference"
              :model-value="language"
              :disabled="!!s.busy"
              :options="languageOptions"
              @update:model-value="changeLanguage"
            />
          </label>
          <p v-if="devicesFeature.state.snapshot?.platform === 'darwin'" class="field-hint">
            {{ t('部分 macOS 系统菜单将在重启应用后使用所选语言。') }}
          </p>
        </TabsContent>
        <TabsContent value="adb">
          <p class="field-hint">{{ t('优先使用随应用附带的 ADB，也可指定本机 platform-tools。') }}</p>
          <div class="path-display mono">{{ devicesFeature.state.snapshot?.adbPath || t('未找到 ADB') }}</div>
          <div class="settings-buttons">
            <Button variant="outline" :disabled="!!s.busy" @click="choose">{{ t('选择 ADB…') }}</Button
            ><Button
              variant="outline"
              :disabled="!!s.busy || !devicesFeature.state.snapshot?.settings.adbPath"
              @click="reset"
              >{{ t('恢复默认') }}</Button
            >
          </div>
        </TabsContent>
        <TabsContent value="devices">
          <p class="field-hint">
            {{
              t('已隐藏 {count} 台设备。', {
                count: devicesFeature.state.snapshot?.settings.hiddenDevices.length || 0,
              })
            }}
          </p>
          <Button
            variant="outline"
            :disabled="!!s.busy || !devicesFeature.state.snapshot?.settings.hiddenDevices.length"
            @click="restore"
            >{{ t('恢复已移除设备') }}</Button
          >
        </TabsContent>
        <TabsContent value="about">
          <AboutPanel :version="devicesFeature.state.snapshot?.version" />
        </TabsContent>
        <p v-if="s.notice?.error" class="inline-result error" role="alert">{{ s.notice.text }}</p>
      </div>
    </Tabs>
  </AppDialog>
</template>
