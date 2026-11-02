<script setup lang="ts">
import { t } from '../shared/i18n';
import { onMounted, onBeforeUnmount, provide, computed, ref } from 'vue';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  Smartphone,
  AppWindow,
  PackagePlus,
  FolderOpen,
  ScrollText,
  LoaderCircle,
  Check,
  X,
  Minus,
  Square,
} from '@lucide/vue';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { createWorkbench, workbenchKey } from '@/composables/workbench';
import { useFocusMode } from '@/composables/focus-mode';
import { connection, deviceStatus } from '../shared/contracts';
import Sidebar from './components/Sidebar.vue';
import SidebarDivider from './components/SidebarDivider.vue';
import DeviceInfoPage from './components/DeviceInfoPage.vue';
import ApplicationsPage from './components/ApplicationsPage.vue';
import InstallDialog from './components/InstallDialog.vue';
import FilesPage from './components/FilesPage.vue';
import DeviceLogsPage from './components/DeviceLogsPage.vue';
import ConnectionDialog from './components/ConnectionDialog.vue';
import SettingsDialog from './components/SettingsDialog.vue';
import AppDialog from './components/AppDialog.vue';
const w = createWorkbench(api),
  s = w.state;
provide(workbenchKey, w);
useFocusMode();
let unlisten: (() => void) | undefined,
  unlistenResize: (() => void) | undefined,
  disposed = false;
const fullscreen = ref(false);
const initialPlatform = /Mac/.test(navigator.platform) ? 'darwin' : 'win32';
const tabs = computed(() => [
  { value: 'info', label: t('设备信息'), icon: Smartphone },
  { value: 'apps', label: t('应用管理'), icon: AppWindow },
  { value: 'files', label: t('文件管理'), icon: FolderOpen },
  { value: 'logs', label: t('设备日志'), icon: ScrollText },
]);
async function windowAction(action: 'minimize' | 'toggleMaximize' | 'close') {
  if (isTauri()) await getCurrentWindow()[action]();
}
onMounted(async () => {
  w.start();
  if (isTauri()) {
    const appWindow = getCurrentWindow();
    // 区分普通铺满和系统全屏：只有 macOS 独立全屏收起顶部，Windows 始终保留。
    const syncWindowState = async () => {
      const next = await appWindow.isFullscreen();
      if (!disposed) fullscreen.value = next;
    };
    const stopResize = await appWindow.onResized(syncWindowState);
    if (disposed) stopResize();
    else unlistenResize = stopResize;
    await syncWindowState();
    // 使用系统拖放路径而非浏览器 File；Rust 只接受同次原生事件授予的 APK 路径。
    const stop = await getCurrentWebviewWindow().onDragDropEvent((event) => {
      if (event.payload.type === 'drop') void w.drop(event.payload.paths);
      else if (event.payload.type === 'over' || event.payload.type === 'enter') {
        w.dragEnter();
      } else s.dragging = false;
    });
    if (disposed) stop();
    else unlisten = stop;
  }
});
onBeforeUnmount(() => {
  disposed = true;
  unlisten?.();
  unlistenResize?.();
  w.dispose();
});
</script>
<template>
  <div
    :class="['app', s.snapshot?.platform || initialPlatform, { 'window-fullscreen': fullscreen }]"
    :style="{ '--sidebar-width': `${w.sidebar.value}px` }"
    @dragover.prevent
    @drop.prevent
  >
    <div class="native-drag-area" data-tauri-drag-region aria-hidden="true" />
    <Sidebar /><SidebarDivider />
    <main class="workspace">
      <div v-if="s.dragging && !s.modal" class="apk-drop-overlay" role="status">
        <PackagePlus class="icon-install" aria-hidden="true" />
        <strong>{{ t('松开以打开安装窗口') }}</strong>
      </div>
      <div v-if="(s.snapshot?.platform || initialPlatform) === 'win32'" class="window-controls">
        <Button variant="ghost" :aria-label="t('最小化窗口')" @click="windowAction('minimize')"
          ><Minus aria-hidden="true" /></Button
        ><Button variant="ghost" :aria-label="t('最大化或还原窗口')" @click="windowAction('toggleMaximize')"
          ><Square aria-hidden="true" /></Button
        ><Button
          variant="ghost"
          class="window-close"
          :aria-label="t('关闭窗口')"
          @click="windowAction('close')"
          ><X aria-hidden="true"
        /></Button>
      </div>
      <header class="device-header" data-tauri-drag-region>
        <div class="device-symbol"><Smartphone aria-hidden="true" /></div>
        <div class="device-title" data-tauri-drag-region>
          <h1 :title="w.title.value" data-tauri-drag-region>{{ w.title.value }}</h1>
          <p v-if="w.device.value" data-tauri-drag-region>
            <span :class="['status-dot', { online: w.online.value }]" />{{ deviceStatus(w.device.value)
            }}<span class="separator-dot">·</span>{{ connection(w.device.value)
            }}<template v-if="s.details && w.online.value"
              ><span class="separator-dot">·</span>Android {{ s.details.android }}</template
            ><span class="separator-dot">·</span><span class="serial">{{ w.device.value.serial }}</span>
          </p>
          <p v-else data-tauri-drag-region>{{ t('连接 Android 设备，开始管理') }}</p>
        </div>
      </header>
      <Tabs v-model="s.tab" class="work-tabs"
        ><TabsList class="tabs" :aria-label="t('设备操作')"
          ><TabsTrigger v-for="tab in tabs" :key="tab.value" :value="tab.value" :disabled="!!s.busy"
            ><component :is="tab.icon" :class="`icon-${tab.value}`" aria-hidden="true" />{{
              tab.label
            }}</TabsTrigger
          ></TabsList
        >
        <div
          :class="[
            'task-content',
            {
              'file-content': s.tab === 'files',
              'installed-app-content': s.tab === 'apps',
              'logs-content': s.tab === 'logs',
            },
          ]"
        >
          <TabsContent value="info"><DeviceInfoPage /></TabsContent
          ><TabsContent value="apps"><ApplicationsPage /></TabsContent
          ><TabsContent value="files"><FilesPage /></TabsContent
          ><TabsContent value="logs"><DeviceLogsPage v-if="s.tab === 'logs'" /></TabsContent></div
      ></Tabs>
      <div
        v-if="s.modal !== 'install' && (s.busy || s.notice)"
        :class="['task-notice', { error: s.notice?.error }]"
        :role="s.notice?.error ? 'alert' : 'status'"
      >
        <LoaderCircle v-if="s.busy" class="spin" aria-hidden="true" /><span
          v-else-if="s.notice?.error"
          class="error-mark"
          >!</span
        ><Check v-else aria-hidden="true" /><span>{{ s.busy || s.notice?.text }}</span
        ><Button v-if="s.busy" variant="outline" @click="w.api.cancel">{{ t('停止等待') }}</Button
        ><Button
          v-else
          variant="ghost"
          class="icon-button"
          :aria-label="t('关闭提示')"
          @click="s.notice = null"
          ><X aria-hidden="true"
        /></Button>
      </div>
    </main>
    <InstallDialog v-if="s.modal === 'install'" />
    <ConnectionDialog v-if="s.modal === 'connect'" /><SettingsDialog v-if="s.modal === 'settings'" />
    <AppDialog
      v-if="s.modal === 'rename' || s.modal === 'folder'"
      :title="s.modal === 'rename' ? t('备注名称') : t('新建文件夹')"
      :busy="!!s.busy"
      @close="s.modal = null"
      ><form @submit.prevent="w.saveModal">
        <div class="dialog-body">
          <label class="field"
            >{{ s.modal === 'rename' ? t('设备备注') : t('文件夹名称')
            }}<Input
              v-model="s.name"
              autofocus
              :maxlength="s.modal === 'rename' ? 80 : 255"
              :required="s.modal === 'folder'"
              :disabled="!!s.busy"
          /></label>
          <p class="field-hint">
            {{
              s.modal === 'rename'
                ? t('备注仅在本机显示，留空恢复设备原名称。')
                : t('创建于 {path}', { path: s.path })
            }}
          </p>
          <p v-if="s.notice?.error" class="inline-result error" role="alert">{{ s.notice.text }}</p>
        </div>
        <footer class="dialog-footer">
          <Button type="button" variant="outline" :disabled="!!s.busy" @click="s.modal = null">{{
            t('取消')
          }}</Button
          ><Button type="submit" class="primary" :disabled="!!s.busy">{{
            s.modal === 'rename' ? t('保存') : t('创建')
          }}</Button>
        </footer>
      </form></AppDialog
    >
  </div>
</template>
