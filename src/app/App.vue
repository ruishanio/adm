<script setup lang="ts">
import { t } from '@/shared/i18n/index';
import { onMounted, onBeforeUnmount, computed, ref } from 'vue';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  Smartphone,
  AppWindow,
  PackagePlus,
  FolderOpen,
  ScrollText,
  Activity,
  MonitorPlay,
  LoaderCircle,
  Check,
  X,
  Minus,
  Square,
  Layers,
  Hash,
} from '@lucide/vue';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/ui/tabs/index';
import { Button } from '@/shared/ui/button/index';
import { Input } from '@/shared/ui/input/index';
import { api } from '@/shared/api/client';
import { createWorkbench, provideWorkbench } from '@/app/workbench';
import { useFocusMode } from '@/shared/composables/focus-mode';
import { connection } from '@/shared/utils/device';
import { deviceStatus } from '@/shared/utils/device';
import Sidebar from '@/features/devices/Sidebar.vue';
import DeviceConnectionIcon from '@/features/devices/DeviceConnectionIcon.vue';
import SidebarDivider from '@/app/layout/SidebarDivider.vue';
import DeviceInfoPage from '@/features/devices/DeviceInfoPage.vue';
import ApplicationsPage from '@/features/apps/ApplicationsPage.vue';
import InstallDialog from '@/features/apps/install/InstallDialog.vue';
import FilesPage from '@/features/files/FilesPage.vue';
import DeviceLogsPage from '@/features/logs/DeviceLogsPage.vue';
import ControlPage from '@/features/control/ControlPage.vue';
import PerformancePage from '@/features/performance/PerformancePage.vue';
import ConnectionDialog from '@/features/devices/ConnectionDialog.vue';
import UpdateDialog from '@/features/settings/UpdateDialog.vue';
import SettingsDialog from '@/features/settings/SettingsDialog.vue';
import AppDialog from '@/shared/ui/AppDialog.vue';
import DialogDeviceTarget from '@/shared/ui/DialogDeviceTarget.vue';
const w = createWorkbench(api),
  s = w.workspace.state;
provideWorkbench(w);
useFocusMode();
let unlisten: (() => void) | undefined,
  unlistenResize: (() => void) | undefined,
  disposed = false;
let checkTimer: number | undefined;
let unlistenProgress: (() => void) | undefined;
const fullscreen = ref(false);
const initialPlatform = /Mac/.test(navigator.platform) ? 'darwin' : 'win32';
const tabs = computed(() => [
  { value: 'info', label: t('设备信息'), icon: Smartphone },
  { value: 'performance', label: t('性能监控'), icon: Activity },
  { value: 'control', label: t('控制设备'), icon: MonitorPlay },
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
    if (import.meta.env.PROD) {
      void w.updates.check(true);
      checkTimer = window.setInterval(() => void w.updates.check(true), 60 * 60 * 1000);
    }
    const stopProgress = await appWindow.listen<number>('adm-update-progress', ({ payload }) => {
      if (w.updates.state.phase === 'downloading') w.updates.state.progress = payload;
    });
    if (disposed) stopProgress();
    else unlistenProgress = stopProgress;
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
      if (event.payload.type === 'drop') void w.install.drop(event.payload.paths);
      else if (event.payload.type === 'over' || event.payload.type === 'enter') {
        w.install.dragEnter();
      } else w.install.state.dragging = false;
    });
    if (disposed) stop();
    else unlisten = stop;
  }
});
onBeforeUnmount(() => {
  disposed = true;
  clearInterval(checkTimer);
  unlistenProgress?.();
  unlisten?.();
  unlistenResize?.();
  w.dispose();
});
</script>
<template>
  <div
    :class="[
      'app',
      w.devices.state.snapshot?.platform || initialPlatform,
      { 'window-fullscreen': fullscreen },
    ]"
    :style="{ '--sidebar-width': `${w.workspace.sidebar.value}px` }"
    @dragover.prevent
    @drop.prevent
  >
    <div class="native-drag-area" data-tauri-drag-region aria-hidden="true" />
    <Sidebar /><SidebarDivider />
    <main class="workspace">
      <div v-if="w.install.state.dragging && !s.modal" class="apk-drop-overlay" role="status">
        <PackagePlus class="icon-install" aria-hidden="true" />
        <strong>{{ t('松开以打开安装窗口') }}</strong>
      </div>
      <div v-if="(w.devices.state.snapshot?.platform || initialPlatform) === 'win32'" class="window-controls">
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
          <h1 :title="w.workspace.title.value" data-tauri-drag-region>{{ w.workspace.title.value }}</h1>
          <p v-if="w.workspace.device.value" class="device-summary" data-tauri-drag-region>
            <span class="device-connection" data-tauri-drag-region>
              <span :class="['status-dot', { online: w.workspace.online.value }]" aria-hidden="true" />
              {{ deviceStatus(w.workspace.device.value) }}
            </span>
            <span class="device-summary-item" data-tauri-drag-region>
              <DeviceConnectionIcon :device="w.workspace.device.value" data-tauri-drag-region />
              {{ connection(w.workspace.device.value) }}
            </span>
            <span
              v-if="w.devices.state.details && w.workspace.online.value"
              class="device-summary-item"
              data-tauri-drag-region
            >
              <Layers aria-hidden="true" data-tauri-drag-region />
              Android {{ w.devices.state.details.android }}
            </span>
            <span class="device-summary-item serial" data-tauri-drag-region>
              <Hash aria-hidden="true" data-tauri-drag-region />
              <span data-tauri-drag-region>{{ w.workspace.device.value.serial }}</span>
            </span>
          </p>
          <p v-else data-tauri-drag-region>
            {{ t('插上 USB 线，或点“{action}”。', { action: t('连接设备') }) }}
          </p>
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
              'performance-content': s.tab === 'performance',
              'control-content': s.tab === 'control',
            },
          ]"
        >
          <TabsContent value="info"><DeviceInfoPage /></TabsContent
          ><TabsContent value="performance"><PerformancePage v-if="s.tab === 'performance'" /></TabsContent
          ><TabsContent value="control"><ControlPage v-if="s.tab === 'control'" /></TabsContent
          ><TabsContent value="apps"><ApplicationsPage /></TabsContent
          ><TabsContent value="files"><FilesPage /></TabsContent
          ><TabsContent value="logs"><DeviceLogsPage v-if="s.tab === 'logs'" /></TabsContent></div
      ></Tabs>
      <!-- 在弹窗或所有者扫描区反馈的任务不重复插入底部进度栏，避免挤压工作区。 -->
      <div
        v-if="
          s.modal !== 'install' &&
          s.modal !== 'owner-remove' &&
          s.modal !== 'owner-set' &&
          s.modal !== 'app-details' &&
          !w.apps.state.application?.reading &&
          !(s.tab === 'info' && w.owner.state.ownerExpanded && w.owner.state.scan?.loading) &&
          (s.busy || s.notice)
        "
        :class="['task-notice', { error: s.notice?.error }]"
        :role="s.notice?.error ? 'alert' : 'status'"
      >
        <LoaderCircle v-if="s.busy" class="spin" aria-hidden="true" /><span
          v-else-if="s.notice?.error"
          class="error-mark"
          >!</span
        ><Check v-else aria-hidden="true" /><span>{{ s.busy || s.notice?.text }}</span
        ><Button v-if="s.busy" variant="outline" @click="w.workspace.api.cancel">{{ t('停止等待') }}</Button
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
    <ConnectionDialog v-if="s.modal === 'connect'" /><SettingsDialog
      v-if="s.modal === 'settings' || s.modal === 'settings-update'"
    />
    <UpdateDialog
      v-if="s.modal === 'update' || s.modal === 'settings-update'"
      :version="w.devices.state.snapshot?.version"
      @close="s.modal = s.modal === 'settings-update' ? 'settings' : null"
    />
    <AppDialog
      v-if="s.modal === 'rename' || s.modal === 'folder'"
      :title="s.modal === 'rename' ? t('备注名称') : t('新建文件夹')"
      :busy="!!s.busy"
      @close="s.modal = null"
      ><form @submit.prevent="w.saveModal">
        <div class="dialog-body dialog-stack">
          <DialogDeviceTarget
            v-if="s.modal === 'rename' && w.devices.state.renameDevice"
            :name="w.devices.state.renameDevice.model || w.devices.state.renameDevice.serial"
            :serial="w.devices.state.renameDevice.serial"
          />
          <div>
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
                  : t('创建于 {path}', { path: w.files.state.path })
              }}
            </p>
          </div>
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
