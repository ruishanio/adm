<script setup lang="ts">
import { t } from '../../../shared/i18n';
import { computed, ref, nextTick, watch } from 'vue';
import {
  RefreshCw,
  Upload,
  Folder,
  File,
  FolderPlus,
  Download,
  ArrowUp,
  HardDrive,
  ChevronRight,
  Pencil,
  Check,
  X,
  ChevronDown,
  Trash2,
  FolderOpen,
} from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useWorkbench } from '@/composables/workbench';
import { sizeLabel, parentPath, displayPath } from '../../lib/format';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'reka-ui';
import AppDialog from '../../components/AppDialog.vue';
import ResizableTable from '../../components/ResizableTable.vue';
import type { ColumnDefinition } from '@/composables/column-widths';
import type { DeviceFile } from '../../../shared/contracts';
import { locale } from '../../../shared/i18n';
import { useFileActions } from './actions';
const w = useWorkbench(),
  s = w.state;
const editing = ref(false);
const fileColumns: readonly ColumnDefinition[] = [
  { label: '名称', width: 300, min: 180, max: 2400 },
  { label: '大小', width: 85, min: 70, max: 360 },
  { label: '修改时间', width: 160, min: 130, max: 800 },
];
const fileScroll = ref<InstanceType<typeof ResizableTable> | null>(null);
// 切换目录或设备时回到列表顶部；普通刷新保留当前浏览位置。
watch(
  [() => s.path, () => s.selected],
  () => {
    fileScroll.value?.scrollToTop();
  },
  { flush: 'post' },
);
const breadcrumbs = computed(() => {
  const parts = s.path.split('/').filter(Boolean);
  return parts.map((name, index) => ({
    name: index === 0 && name === 'sdcard' ? t('共享存储') : displayPath(name),
    path: '/' + parts.slice(0, index + 1).join('/'),
  }));
});
async function editPath() {
  s.pathInput = s.path;
  editing.value = true;
  await nextTick();
  document.getElementById('file-path-input')?.focus();
}
function cancelEdit() {
  editing.value = false;
  s.pathInput = s.path;
}
async function navigate() {
  await w.loadFiles(s.pathInput);
  if (!s.notice?.error) editing.value = false;
}
watch(() => s.selected, cancelEdit);
const { upload, download, pending, nextName, actionError, canModify, fileAction, submitAction } =
  useFileActions(w);
function open(f: DeviceFile) {
  if (!s.busy && f.type === 'directory') void w.loadFiles(f.path);
}
const date = (value: number) =>
  new Date(value * 1000).toLocaleString(locale.value, {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
</script>
<template>
  <div v-if="!w.online.value" class="empty-state">
    <Folder aria-hidden="true" />
    <h2>{{ t('选择已连接的设备') }}</h2>
    <p>{{ t('浏览共享存储、上传和下载文件。') }}</p>
  </div>
  <div v-else class="file-manager">
    <header class="workspace-toolbar">
      <div class="toolbar-row">
        <Button
          class="icon-button"
          variant="ghost"
          :aria-label="t('上一级')"
          :title="t('上一级')"
          :disabled="!!s.busy || s.path === '/'"
          @click="w.loadFiles(parentPath(s.path))"
          ><ArrowUp aria-hidden="true"
        /></Button>
        <form
          v-if="editing"
          class="file-path-editor"
          @submit.prevent="navigate"
          @keydown.esc.prevent.stop="cancelEdit"
        >
          <Input
            id="file-path-input"
            v-model="s.pathInput"
            :aria-label="t('设备目录')"
            :disabled="!!s.busy"
            :spellcheck="false"
          />
          <Button
            class="icon-button"
            type="submit"
            variant="ghost"
            :aria-label="t('前往目录')"
            :disabled="!!s.busy"
            ><Check aria-hidden="true"
          /></Button>
          <Button
            class="icon-button"
            type="button"
            variant="ghost"
            :aria-label="t('取消编辑路径')"
            :disabled="!!s.busy"
            @click="cancelEdit"
            ><X aria-hidden="true"
          /></Button>
        </form>
        <nav v-else class="file-breadcrumbs" :aria-label="t('当前目录')" :title="s.path">
          <Button
            class="icon-button"
            variant="ghost"
            :aria-label="t('根目录')"
            :disabled="!!s.busy"
            @click="w.loadFiles('/')"
            ><HardDrive aria-hidden="true"
          /></Button>
          <template v-for="part in breadcrumbs" :key="part.path"
            ><ChevronRight class="breadcrumb-separator" aria-hidden="true" /><Button
              variant="ghost"
              :disabled="!!s.busy"
              :aria-current="part.path === s.path ? 'location' : undefined"
              @click="w.loadFiles(part.path)"
              >{{ part.name }}</Button
            ></template
          >
        </nav>
        <Button
          v-if="!editing"
          class="icon-button"
          variant="ghost"
          :aria-label="t('编辑路径')"
          :title="t('编辑路径')"
          :disabled="!!s.busy"
          @click="editPath"
          ><Pencil aria-hidden="true"
        /></Button>
        <Button
          class="icon-button"
          variant="ghost"
          :aria-label="t('刷新目录')"
          :title="t('刷新目录')"
          :disabled="!!s.busy"
          @click="w.loadFiles(s.path)"
          ><RefreshCw aria-hidden="true"
        /></Button>
      </div>
      <div class="toolbar-actions file-actions">
        <Button
          variant="ghost"
          class="quiet"
          :disabled="!!s.busy"
          @click="
            s.name = '';
            s.modal = 'folder';
          "
        >
          <FolderPlus aria-hidden="true" />{{ t('新建文件夹') }}
        </Button>
        <span class="toolbar-separator" aria-hidden="true" />
        <DropdownMenuRoot>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" class="quiet" :disabled="!!s.busy"
              ><Upload aria-hidden="true" />{{ t('上传')
              }}<ChevronDown class="upload-chevron" aria-hidden="true"
            /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent class="device-context-menu file-menu" align="start" :side-offset="4">
              <DropdownMenuItem :disabled="!!s.busy" @select="upload('files')"
                ><File aria-hidden="true" />{{ t('上传文件…') }}</DropdownMenuItem
              >
              <DropdownMenuItem :disabled="!!s.busy" @select="upload('folders')"
                ><Folder aria-hidden="true" />{{ t('上传文件夹…') }}</DropdownMenuItem
              >
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenuRoot>
        <Button
          variant="ghost"
          class="quiet"
          :disabled="!!s.busy || s.file?.type !== 'file'"
          @click="download"
        >
          <Download aria-hidden="true" />{{ t('下载') }}
        </Button>
        <span class="toolbar-meta">{{ t('{count} 项', { count: s.files.length }) }}</span>
      </div>
    </header>
    <ResizableTable
      id="device-files-table"
      ref="fileScroll"
      :label="t('设备文件')"
      :columns="fileColumns"
      storage-key="adm.files-column-widths"
      table-class="file-table"
      scroll-class="file-scroll"
      :busy="!!s.busy"
    >
      <ContextMenu
        v-for="f in s.files"
        :key="f.path"
        @update:open="
          (value) => {
            if (value && !s.busy) s.file = f;
          }
        "
      >
        <ContextMenuTrigger as-child :disabled="!!s.busy">
          <tr
            :tabindex="s.busy ? -1 : 0"
            :aria-selected="s.file?.path === f.path"
            :aria-disabled="!!s.busy"
            :class="{ selected: s.file?.path === f.path }"
            @click="!s.busy && (s.file = f)"
            @dblclick="open(f)"
            @keydown.enter="open(f)"
            @keydown.space.prevent="!s.busy && (s.file = f)"
          >
            <td>
              <span class="file-name"
                ><Folder v-if="f.type === 'directory'" aria-hidden="true" class="folder-icon" /><File
                  v-else
                  aria-hidden="true"
                /><span :title="f.name">{{ displayPath(f.name) }}</span
                ><small v-if="f.type === 'link'">{{ t('链接') }}</small></span
              >
            </td>
            <td>{{ f.type === 'file' ? sizeLabel(f.size) : '—' }}</td>
            <td>{{ date(f.modified) }}</td>
          </tr>
        </ContextMenuTrigger>
        <ContextMenuContent
          class="device-context-menu file-menu"
          @close-auto-focus="
            (e) => {
              if (s.modal) e.preventDefault();
            }
          "
        >
          <ContextMenuItem v-if="f.type === 'directory'" :disabled="!!s.busy" @select="open(f)"
            ><FolderOpen aria-hidden="true" />{{ t('打开文件夹') }}</ContextMenuItem
          >
          <ContextMenuItem
            v-if="f.type === 'file'"
            :disabled="!!s.busy"
            @select="
              s.file = f;
              download();
            "
            ><Download aria-hidden="true" />{{ t('下载') }}</ContextMenuItem
          >
          <ContextMenuItem :disabled="!canModify(f)" @select="fileAction(f, 'file-rename')"
            ><Pencil aria-hidden="true" />{{ t('重命名…') }}</ContextMenuItem
          >
          <ContextMenuSeparator />
          <ContextMenuItem
            class="destructive"
            :disabled="!canModify(f)"
            @select="fileAction(f, 'file-delete')"
            ><Trash2 aria-hidden="true" />{{ t('删除…') }}</ContextMenuItem
          >
        </ContextMenuContent>
      </ContextMenu>
      <template #empty>
        <div v-if="!s.files.length && !s.busy" class="empty-directory">{{ t('此目录为空') }}</div>
      </template>
    </ResizableTable>
  </div>
  <AppDialog
    v-if="pending && (s.modal === 'file-rename' || s.modal === 'file-delete')"
    :title="s.modal === 'file-rename' ? t('重命名') : t('删除')"
    :busy="!!s.busy"
    @close="s.modal = null"
  >
    <form @submit.prevent="submitAction">
      <div class="dialog-body">
        <template v-if="s.modal === 'file-rename'">
          <label class="field"
            >{{ t('名称') }}<Input v-model="nextName" required :disabled="!!s.busy" :spellcheck="false"
          /></label>
        </template>
        <p v-else>{{ t('删除后无法恢复，文件夹内的所有内容也会一并删除。') }}</p>
        <div class="path-display">{{ pending.file.path }}</div>
        <p v-if="actionError" class="file-action-error" role="alert">{{ actionError }}</p>
      </div>
      <footer class="dialog-footer">
        <Button type="button" variant="outline" :disabled="!!s.busy" @click="s.modal = null">{{
          t('取消')
        }}</Button>
        <Button
          type="submit"
          :class="s.modal === 'file-delete' ? 'destructive' : 'primary'"
          :disabled="!!s.busy || (s.modal === 'file-rename' && !nextName)"
          >{{ s.modal === 'file-delete' ? t('删除') : t('保存') }}</Button
        >
      </footer>
    </form>
  </AppDialog>
</template>
