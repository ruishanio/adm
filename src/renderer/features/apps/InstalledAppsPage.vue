<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { AppWindow, Ellipsis, RefreshCw, Search } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useWorkbench } from '@/composables/workbench';
import { t } from '../../../shared/i18n';
import AppDetailsDialog from './AppDetailsDialog.vue';
import InstalledAppIcon from './InstalledAppIcon.vue';
import AppActionItems from './AppActionItems.vue';
import { useAppResources } from '@/features/apps/resources';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent } from '@/components/ui/context-menu';
import { DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuPortal, DropdownMenuContent } from 'reka-ui';
import type { InstalledApp, AppAction } from '../../../shared/contracts';
import { sizeLabel } from '../../lib/format';
import ResizableTable from '../../components/ResizableTable.vue';
import type { ColumnDefinition } from '@/composables/column-widths';

const w = useWorkbench(),
  s = w.state;
const resources = useAppResources(w);
const selected = ref('');
const dialogReturnFocus = ref<HTMLElement>();
const appColumns: readonly ColumnDefinition[] = [
  { label: '应用名称', width: 240, min: 180, max: 2400 },
  { label: '版本', width: 90, min: 70, max: 600 },
  { label: '安装包大小', width: 100, min: 90, max: 360 },
  { label: '运行状态', width: 104, min: 86, max: 360 },
  { label: '操作', width: 96, min: 96, max: 96, resizable: false },
];
function isOwner(app: InstalledApp) {
  return s.details?.owner?.split('/')[0] === app.packageName;
}
function menuAction(app: InstalledApp, action: AppAction | 'details' | 'copy' | 'uninstall') {
  selected.value = app.packageName;
  // 菜单焦点锁关闭前不能可靠地聚焦外部，显式记录应用行供弹窗关闭时恢复。
  const row = [...document.querySelectorAll<HTMLElement>('.application-row')].find(
    (row) => row.dataset.package === app.packageName,
  );
  dialogReturnFocus.value = row;
  if (action === 'details') void w.openApp(app);
  else if (action === 'copy') void w.copyPackage(app);
  else if (action === 'launch') void w.launchApp(app);
  else void w.openApp(app, action);
}
function rowKey(event: KeyboardEvent, index: number) {
  if (s.busy || event.target !== event.currentTarget) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    menuAction(filtered.value[index], 'details');
  } else if (event.key === ' ') {
    event.preventDefault();
    selected.value = filtered.value[index].packageName;
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? filtered.value.length - 1
          : Math.max(0, Math.min(filtered.value.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    selected.value = filtered.value[next].packageName;
    const rows = (event.currentTarget as HTMLElement).closest('tbody')?.querySelectorAll<HTMLElement>('tr');
    rows?.[next]?.focus();
  }
}
watch(
  () => [s.selected, w.online.value],
  () => {
    selected.value = '';
  },
);
const filtered = computed(() => {
  const query = s.appQuery.trim().toLowerCase();
  return s.apps.filter(
    (app) =>
      (s.showSystemApps || !app.system) &&
      (app.packageName.toLowerCase().includes(query) || app.label?.toLowerCase().includes(query)),
  );
});
watch(filtered, (apps) => {
  if (!apps.some((app) => app.packageName === selected.value)) selected.value = '';
});
</script>

<template>
  <header class="workspace-toolbar">
    <div class="toolbar-row">
      <div class="toolbar-search">
        <Search aria-hidden="true" />
        <Input
          v-model="s.appQuery"
          type="search"
          :aria-label="t('搜索应用名称或包名')"
          :placeholder="t('搜索应用名称或包名')"
          :spellcheck="false"
          :disabled="!w.online.value"
        />
      </div>
      <Button
        variant="ghost"
        class="icon-button"
        :title="t('刷新应用')"
        :aria-label="t('刷新应用')"
        :disabled="!w.online.value || !!s.busy"
        @click="w.loadApps"
        ><RefreshCw aria-hidden="true"
      /></Button>
      <label class="checkbox" for="show-system-apps"
        ><Checkbox
          id="show-system-apps"
          v-model="s.showSystemApps"
          :disabled="!w.online.value"
          :aria-label="t('显示系统应用')"
        />{{ t('显示系统应用') }}</label
      >
    </div>
    <div class="toolbar-actions">
      <slot name="actions" />
      <span v-if="w.online.value && s.appsLoaded" class="toolbar-meta">{{
        t('{count} 个应用', { count: filtered.length })
      }}</span>
    </div>
  </header>
  <div v-if="!w.online.value" class="empty-state">
    <AppWindow class="icon-apps" aria-hidden="true" />
    <h2>{{ t('选择已连接的设备') }}</h2>
    <p>{{ t('查看和管理设备上的已安装应用。') }}</p>
  </div>
  <div v-else class="installed-apps">
    <div v-if="!s.appsLoaded" class="apps-empty" role="status">
      <p>{{ s.busy ? t('正在读取应用列表…') : t('应用列表尚未加载，请刷新。') }}</p>
    </div>
    <ResizableTable
      v-else
      id="installed-apps-table"
      :label="t('已安装应用')"
      :columns="appColumns"
      storage-key="adm.apps-column-widths.v2"
      table-class="apps-table"
      scroll-class="apps-scroll"
      :busy="!!s.busy"
    >
      <ContextMenu
        v-for="(app, index) in filtered"
        :key="app.packageName"
        @update:open="
          (value) => {
            if (value && !s.busy) selected = app.packageName;
          }
        "
      >
        <ContextMenuTrigger as-child :disabled="!!s.busy">
          <tr
            class="application-row"
            :data-package="app.packageName"
            :class="{ selected: selected === app.packageName }"
            :aria-selected="selected === app.packageName"
            :aria-disabled="!!s.busy"
            :tabindex="s.busy ? -1 : selected === app.packageName || (!selected && index === 0) ? 0 : -1"
            @click="!s.busy && (selected = app.packageName)"
            @dblclick="!s.busy && menuAction(app, 'details')"
            @keydown="rowKey($event, index)"
          >
            <td>
              <span
                class="app-identity"
                :title="app.label ? `${app.label}\n${app.packageName}` : app.packageName"
              >
                <InstalledAppIcon
                  :cache-key="resources.iconKey(app)"
                  :src="resources.icons[resources.iconKey(app)]"
                  @visible="resources.requestIcon(app)"
                />
                <span class="app-name">{{ app.label || app.packageName }}</span>
                <span v-if="!app.enabled" class="app-disabled-label">{{ t('已禁用') }}</span>
              </span>
            </td>
            <td
              :title="
                app.version ? `${app.version.name || app.version.code} (${app.version.code})` : undefined
              "
            >
              {{ app.version?.name || app.version?.code || '—' }}
            </td>
            <td class="app-size" :title="t('主 APK 与拆分 APK 的合计，不含应用数据和缓存。')">
              {{ app.apkSize == null ? '—' : sizeLabel(app.apkSize) }}
            </td>
            <td
              :title="
                resources.running.value
                  ? t('按关联进程判断，包含后台和缓存进程；约每 5 秒更新。')
                  : resources.error.value || t('正在读取运行状态…')
              "
            >
              <span class="app-running" :class="{ running: resources.running.value?.has(app.packageName) }">
                <i v-if="resources.running.value?.has(app.packageName)" aria-hidden="true" />
                {{
                  resources.running.value
                    ? resources.running.value.has(app.packageName)
                      ? t('运行中')
                      : t('未运行')
                    : '—'
                }}
              </span>
            </td>
            <td @click.stop @dblclick.stop>
              <div class="app-row-actions">
                <Button
                  variant="ghost"
                  class="quiet app-details-button"
                  :disabled="!!s.busy"
                  :aria-label="t('查看 {package} 的信息', { package: app.label || app.packageName })"
                  @click="menuAction(app, 'details')"
                  >{{ t('详情') }}</Button
                >
                <DropdownMenuRoot
                  @update:open="
                    (value) => {
                      if (value) selected = app.packageName;
                    }
                  "
                >
                  <DropdownMenuTrigger as-child
                    ><Button
                      variant="ghost"
                      class="icon-button"
                      :disabled="!!s.busy"
                      :aria-label="t('{name} 的更多操作', { name: app.label || app.packageName })"
                      ><Ellipsis aria-hidden="true" /></Button
                  ></DropdownMenuTrigger>
                  <DropdownMenuPortal
                    ><DropdownMenuContent
                      class="device-context-menu app-action-menu"
                      align="end"
                      :side-offset="4"
                      @close-auto-focus="
                        (event) => {
                          if (s.modal) event.preventDefault();
                        }
                      "
                    >
                      <AppActionItems
                        :app="app"
                        :owner="isOwner(app)"
                        :busy="!!s.busy"
                        dropdown
                        @action="menuAction(app, $event)"
                      /> </DropdownMenuContent
                  ></DropdownMenuPortal>
                </DropdownMenuRoot>
              </div>
            </td>
          </tr>
        </ContextMenuTrigger>
        <ContextMenuContent
          class="device-context-menu app-action-menu"
          @close-auto-focus="
            (event) => {
              if (s.modal) event.preventDefault();
            }
          "
        >
          <AppActionItems
            :app="app"
            :owner="isOwner(app)"
            :busy="!!s.busy"
            @action="menuAction(app, $event)"
          />
        </ContextMenuContent>
      </ContextMenu>
      <template #empty>
        <p v-if="!filtered.length" class="apps-empty">
          {{
            s.appQuery.trim()
              ? t('没有匹配的应用')
              : s.showSystemApps
                ? t('没有已安装的应用')
                : t('没有已安装的用户应用')
          }}
        </p>
      </template>
    </ResizableTable>
  </div>
  <AppDetailsDialog :return-focus="dialogReturnFocus" />
</template>
