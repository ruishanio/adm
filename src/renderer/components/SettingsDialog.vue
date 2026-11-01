<script setup lang="ts">
import { t } from '../../shared/i18n';
import { ref } from 'vue';
import { SlidersHorizontal, Terminal, Smartphone, Info } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import AppDialog from './AppDialog.vue';
import AppSelect from './AppSelect.vue';
import { useWorkbench } from '@/composables/workbench';
import { APP_NAME, APP_FULL_NAME, APP_VERSION } from '../../shared/app-info';
import { language, setLanguage } from '../../shared/i18n';
const w = useWorkbench(),
  s = w.state;
const section = ref('general');
async function choose() {
  await w.run(t('检查 ADB'), async () => {
    if (await w.api.chooseAdb()) await w.refresh();
  });
}
async function reset() {
  await w.run(t('恢复默认 ADB'), async () => {
    await w.api.resetAdb();
    await w.refresh();
  });
}
async function restore() {
  await w.run(t('恢复设备列表'), async () => {
    await w.api.restore();
    await w.refresh();
  });
}
async function changeLanguage(next: string) {
  if (next !== 'zh-CN' && next !== 'en') return;
  await w.run(t('切换语言'), async () => {
    // 保存成功后再切换界面，避免磁盘写入失败时显示与偏好不一致。
    await w.api.language(next);
    setLanguage(next);
    if (s.snapshot) s.snapshot.settings.language = next;
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
              :options="[
                { value: 'zh-CN', label: '简体中文' },
                { value: 'en', label: 'English' },
              ]"
              @update:model-value="changeLanguage"
            />
          </label>
        </TabsContent>
        <TabsContent value="adb">
          <p class="field-hint">{{ t('优先使用随应用附带的 ADB，也可指定本机 platform-tools。') }}</p>
          <div class="path-display mono">{{ s.snapshot?.adbPath || t('未找到 ADB') }}</div>
          <div class="settings-buttons">
            <Button variant="outline" :disabled="!!s.busy" @click="choose">{{ t('选择 ADB…') }}</Button
            ><Button variant="outline" :disabled="!!s.busy || !s.snapshot?.settings.adbPath" @click="reset">{{
              t('恢复默认')
            }}</Button>
          </div>
        </TabsContent>
        <TabsContent value="devices">
          <p class="field-hint">
            {{ t('已隐藏 {count} 台设备。', { count: s.snapshot?.settings.hiddenDevices.length || 0 }) }}
          </p>
          <Button
            variant="outline"
            :disabled="!!s.busy || !s.snapshot?.settings.hiddenDevices.length"
            @click="restore"
            >{{ t('恢复已移除设备') }}</Button
          >
        </TabsContent>
        <TabsContent value="about">
          <h3>{{ APP_NAME }}</h3>
          <p class="field-hint">{{ APP_FULL_NAME }}</p>
          <p class="field-hint">{{ t('版本 {version}', { version: s.snapshot?.version || APP_VERSION }) }}</p>
        </TabsContent>
        <p v-if="s.notice?.error" class="inline-result error" role="alert">{{ s.notice.text }}</p>
      </div>
    </Tabs>
  </AppDialog>
</template>
