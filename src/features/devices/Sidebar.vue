<script setup lang="ts">
import { useDevices } from '@/features/devices/state';
const devicesFeature = useDevices();

import { t } from '@/shared/i18n/index';
import { computed } from 'vue';
import { Smartphone, Cable, RefreshCw, Plus, Settings2, Search, Pencil, Copy, ListMinus } from '@lucide/vue';
import { Button } from '@/shared/ui/button/index';
import { Input } from '@/shared/ui/input/index';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/shared/ui/context-menu/index';
import { useWorkspace } from '@/shared/composables/workspace';
import { type Device } from '@/shared/api/types';
import { deviceName } from '@/shared/utils/device';
import { deviceStatus, connection, targetKey } from '@/shared/utils/device';
import { APP_VERSION } from '@/shared/app-info';
import DeviceConnectionIcon from '@/features/devices/DeviceConnectionIcon.vue';
const w = useWorkspace(),
  s = w.state;
const connected = computed(
  () => devicesFeature.state.snapshot?.devices.filter((d) => d.state === 'device') || [],
);
const groups = computed(() =>
  [
    { label: t('已连接'), devices: connected.value },
    {
      label: t('其他设备'),
      devices: devicesFeature.state.snapshot?.devices.filter((d) => d.state !== 'device') || [],
    },
  ].map((g) => ({
    ...g,
    filtered: g.devices.filter((d) =>
      `${deviceName(d, devicesFeature.state.snapshot?.settings)} ${d.serial}`
        .toLowerCase()
        .includes(s.query.toLowerCase()),
    ),
  })),
);
function selectDevice(e: MouseEvent, device: Device) {
  devicesFeature.select(device);
  // macOS WebView 鼠标点击按钮默认不聚焦，显式保留焦点以继续使用方向键。
  (e.currentTarget as HTMLButtonElement).focus({ preventScroll: true });
}
function rowKey(e: KeyboardEvent) {
  if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
  e.preventDefault();
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.device-row'));
  buttons[
    (buttons.indexOf(e.currentTarget as HTMLButtonElement) +
      (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) %
      buttons.length
  ]?.focus();
}
</script>
<template>
  <aside id="device-sidebar" class="sidebar">
    <header class="sidebar-heading" data-tauri-drag-region>
      <h1 data-tauri-drag-region>{{ t('设备') }}</h1>
      <Button
        variant="ghost"
        class="icon-button"
        :aria-label="t('刷新设备')"
        :title="t('刷新设备 · ⌘/Ctrl+R')"
        :disabled="!!s.busy"
        @click="devicesFeature.refresh(true)"
        ><RefreshCw aria-hidden="true"
      /></Button>
    </header>
    <label v-if="(devicesFeature.state.snapshot?.devices.length || 0) > 5" class="device-search"
      ><Search aria-hidden="true" /><Input
        v-model="s.query"
        :aria-label="t('查找设备')"
        :placeholder="t('查找设备')"
    /></label>
    <nav class="device-list" :aria-label="t('设备列表')">
      <template v-for="(group, index) in groups" :key="group.label">
        <div v-if="index === 0 || group.devices.length" class="device-group-heading">
          <h2 class="group-title">{{ group.label }}</h2>
          <span
            v-if="index === 0"
            class="device-count"
            :aria-label="t('{count} 台已连接设备', { count: connected.length })"
            >{{ connected.length }}</span
          >
        </div>
        <ContextMenu v-for="d in group.filtered" :key="targetKey(d)">
          <ContextMenuTrigger as-child :disabled="!!s.busy"
            ><Button
              variant="ghost"
              :class="[
                'device-row',
                { selected: s.selected === targetKey(d), offline: d.state !== 'device' },
              ]"
              :disabled="!!s.busy"
              :aria-pressed="s.selected === targetKey(d)"
              :aria-label="`${deviceName(d, devicesFeature.state.snapshot?.settings)} ${connection(d)} ${deviceStatus(d)} ${d.serial}`"
              :title="`${deviceName(d, devicesFeature.state.snapshot?.settings)}\n${d.serial}\n${connection(d)}\n${deviceStatus(d)}`"
              @click="selectDevice($event, d)"
              @keydown="rowKey"
            >
              <Smartphone
                :class="['device-icon', { connected: d.state === 'device' }]"
                aria-hidden="true"
              /><span class="device-copy"
                ><span class="device-name">{{ deviceName(d, devicesFeature.state.snapshot?.settings) }}</span
                ><span class="device-caption">
                  <DeviceConnectionIcon :device="d" />
                  <span class="device-identifier">{{ d.serial }}</span>
                  <span v-if="d.state !== 'device'" class="device-state-text">{{
                    deviceStatus(d)
                  }}</span></span
                ></span
              >
            </Button></ContextMenuTrigger
          >
          <ContextMenuContent class="device-context-menu"
            ><ContextMenuItem :disabled="!!s.busy" @select="devicesFeature.editName(d)"
              ><Pencil aria-hidden="true" /><span>{{ t('备注名称…') }}</span></ContextMenuItem
            ><ContextMenuItem @select="w.run(t('复制设备标识'), () => w.api.copySerial(d.serial))"
              ><Copy aria-hidden="true" /><span>{{ t('复制设备标识') }}</span></ContextMenuItem
            ><ContextMenuSeparator /><ContextMenuItem :disabled="!!s.busy" @select="devicesFeature.hide(d)"
              ><ListMinus aria-hidden="true" /><span>{{ t('从列表移除') }}</span></ContextMenuItem
            ></ContextMenuContent
          >
        </ContextMenu>
      </template>
      <div
        v-if="devicesFeature.state.snapshot && !devicesFeature.state.snapshot.devices.length"
        class="sidebar-empty"
      >
        <Cable aria-hidden="true" :size="24" />
        <p>{{ t('尚未发现设备') }}</p>
        <span>{{ t('连接 USB，或添加网络设备') }}</span>
      </div>
    </nav>
    <footer class="sidebar-footer">
      <Button class="connect-button" variant="outline" :disabled="!!s.busy" @click="s.modal = 'connect'"
        ><Plus aria-hidden="true" />{{ t('连接设备') }}</Button
      >
      <div class="sidebar-settings">
        <Button variant="ghost" class="quiet" :disabled="!!s.busy" @click="s.modal = 'settings'"
          ><Settings2 aria-hidden="true" />{{ t('设置') }}</Button
        ><span>v{{ devicesFeature.state.snapshot?.version || APP_VERSION }}</span>
      </div>
    </footer>
  </aside>
</template>
