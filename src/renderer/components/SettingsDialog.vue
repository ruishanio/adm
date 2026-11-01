<script setup lang="ts">
import { Button } from '@/components/ui/button';
import AppDialog from './AppDialog.vue';
import { useWorkbench } from '@/composables/workbench';
import { APP_NAME } from '../../shared/app-info';
const w = useWorkbench(),
  s = w.state;
async function choose() {
  await w.run('检查 ADB', async () => {
    if (await w.api.chooseAdb()) await w.refresh();
  });
}
async function reset() {
  await w.run('恢复默认 ADB', async () => {
    await w.api.resetAdb();
    await w.refresh();
  });
}
async function restore() {
  await w.run('恢复设备列表', async () => {
    await w.api.restore();
    await w.refresh();
  });
}
</script>
<template>
  <AppDialog title="设置" :busy="!!s.busy" @close="s.modal = null"
    ><div class="dialog-body settings-body">
      <h3>ADB 工具</h3>
      <p class="field-hint">优先使用随应用附带的 ADB，也可指定本机 platform-tools。</p>
      <div class="path-display mono">{{ s.snapshot?.adbPath || '未找到 ADB' }}</div>
      <div class="settings-buttons">
        <Button variant="outline" :disabled="!!s.busy" @click="choose">选择 ADB…</Button
        ><Button variant="outline" :disabled="!!s.busy || !s.snapshot?.settings.adbPath" @click="reset"
          >恢复默认</Button
        >
      </div>
      <hr />
      <h3>设备列表</h3>
      <p class="field-hint">已隐藏 {{ s.snapshot?.settings.hiddenDevices.length || 0 }} 台设备。</p>
      <Button
        variant="outline"
        :disabled="!!s.busy || !s.snapshot?.settings.hiddenDevices.length"
        @click="restore"
        >恢复已移除设备</Button
      >
      <p v-if="s.notice?.error" class="inline-result error" role="alert">{{ s.notice.text }}</p>
      <hr />
      <p class="about-name">{{ APP_NAME }}</p>
      <p class="field-hint">版本 {{ s.snapshot?.version || '1.0.0' }} · Tauri 2</p>
    </div>
    <footer class="dialog-footer">
      <Button variant="outline" :disabled="!!s.busy" @click="s.modal = null">完成</Button>
    </footer></AppDialog
  >
</template>
