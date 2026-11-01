<script setup lang="ts">
import { computed } from 'vue';
import { Smartphone, Cable, RefreshCw, Plus, Settings2, Search } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { useWorkbench } from '@/composables/workbench';
import { deviceName, deviceStatus, connection, targetKey } from '../../shared/contracts';
import { APP_NAME, APP_SHORT_NAME } from '../../shared/app-info';
const w = useWorkbench(),
  s = w.state;
const connected = computed(() => s.snapshot?.devices.filter((d) => d.state === 'device') || []);
const groups = computed(() =>
  [
    { label: '已连接', devices: connected.value },
    { label: '其他设备', devices: s.snapshot?.devices.filter((d) => d.state !== 'device') || [] },
  ].map((g) => ({
    ...g,
    filtered: g.devices.filter((d) =>
      `${deviceName(d, s.snapshot?.settings)} ${d.serial}`.toLowerCase().includes(s.query.toLowerCase()),
    ),
  })),
);
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
  <aside class="sidebar">
    <div class="native-drag-area" data-tauri-drag-region />
    <header class="sidebar-heading" data-tauri-drag-region>
      <span class="app-mark" aria-hidden="true"><Smartphone /></span>
      <h1 :title="APP_NAME" data-tauri-drag-region>{{ APP_SHORT_NAME }}</h1>
    </header>
    <label v-if="(s.snapshot?.devices.length || 0) > 5" class="device-search"
      ><Search aria-hidden="true" /><Input v-model="s.query" aria-label="查找设备" placeholder="查找设备"
    /></label>
    <nav class="device-list" aria-label="设备列表">
      <template v-for="(group, index) in groups" :key="group.label">
        <div v-if="index === 0 || group.devices.length" class="device-group-heading">
          <h2 class="group-title">{{ group.label }}</h2>
          <template v-if="index === 0"
            ><span class="device-count" :aria-label="`${connected.length} 台已连接设备`">{{
              connected.length
            }}</span
            ><Button
              variant="ghost"
              class="icon-button"
              aria-label="刷新设备"
              title="刷新设备 · ⌘/Ctrl+R"
              :disabled="!!s.busy"
              @click="w.refresh(true)"
              ><RefreshCw aria-hidden="true" /></Button
          ></template>
        </div>
        <ContextMenu v-for="d in group.filtered" :key="targetKey(d)">
          <ContextMenuTrigger as-child :disabled="!!s.busy"
            ><Button
              variant="ghost"
              :class="['device-row', { selected: s.selected === targetKey(d) }]"
              :disabled="!!s.busy"
              :aria-pressed="s.selected === targetKey(d)"
              :title="`${deviceName(d, s.snapshot?.settings)}\n${d.serial} · ${deviceStatus(d)}`"
              @click="w.select(d)"
              @keydown.f2.prevent="w.editName(d)"
              @keydown="rowKey"
            >
              <Smartphone
                :class="['device-icon', { connected: d.state === 'device' }]"
                aria-hidden="true"
              /><span class="device-name">{{ deviceName(d, s.snapshot?.settings) }}</span
              ><span
                :class="['status-dot', { online: d.state === 'device', pending: d.state === 'unauthorized' }]"
                :aria-label="deviceStatus(d)"
              /><span class="device-caption"
                >{{ d.state === 'device' ? connection(d) : deviceStatus(d) }}<span>·</span
                >{{ d.serial }}</span
              >
            </Button></ContextMenuTrigger
          >
          <ContextMenuContent class="device-context-menu"
            ><ContextMenuItem :disabled="!!s.busy" @select="w.editName(d)">备注名称…</ContextMenuItem
            ><ContextMenuItem @select="w.run('复制设备标识', () => w.api.copySerial(d.serial))"
              >复制设备标识</ContextMenuItem
            ><ContextMenuSeparator /><ContextMenuItem :disabled="!!s.busy" @select="w.hide(d)"
              >从列表移除</ContextMenuItem
            ></ContextMenuContent
          >
        </ContextMenu>
      </template>
      <div v-if="s.snapshot && !s.snapshot.devices.length" class="sidebar-empty">
        <Cable aria-hidden="true" :size="24" />
        <p>尚未发现设备</p>
        <span>连接 USB，或添加网络设备</span>
      </div>
    </nav>
    <footer class="sidebar-footer">
      <Button class="connect-button" variant="outline" :disabled="!!s.busy" @click="s.modal = 'connect'"
        ><Plus aria-hidden="true" />连接设备</Button
      >
      <div class="sidebar-settings">
        <Button variant="ghost" class="quiet" :disabled="!!s.busy" @click="s.modal = 'settings'"
          ><Settings2 aria-hidden="true" />设置</Button
        ><span>v{{ s.snapshot?.version || '1.0.0' }}</span>
      </div>
    </footer>
  </aside>
</template>
