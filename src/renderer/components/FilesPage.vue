<script setup lang="ts">
import { RefreshCw, Upload, Folder, File, FolderPlus, Download, ChevronUp, Home } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useWorkbench } from '@/composables/workbench';
import { sizeLabel, parentPath, displayPath } from './format';
import type { DeviceFile } from '../../shared/contracts';
const w = useWorkbench(),
  s = w.state;
async function upload() {
  if (w.device.value)
    await w.run('上传文件', async () => {
      if (await w.api.upload(w.device.value!, s.path)) {
        s.files = await w.api.listFiles(w.device.value!, s.path);
        s.notice = { text: '上传完成。' };
      }
    });
}
async function download() {
  if (w.device.value && s.file?.type === 'file')
    await w.run('下载文件', async () => {
      if (await w.api.download(w.device.value!, s.file!.path)) s.notice = { text: '下载完成。' };
    });
}
function open(f: DeviceFile) {
  if (!s.busy && f.type === 'directory') void w.loadFiles(f.path);
}
const date = (value: number) =>
  new Date(value * 1000).toLocaleString('zh-CN', {
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
    <h2>选择已连接的设备</h2>
    <p>浏览共享存储、上传和下载文件。</p>
  </div>
  <template v-else>
    <div class="file-toolbar">
      <Button
        class="icon-button"
        variant="outline"
        aria-label="共享存储"
        title="共享存储"
        :disabled="!!s.busy"
        @click="w.loadFiles('/sdcard')"
        ><Home aria-hidden="true" /></Button
      ><Button
        class="icon-button"
        variant="outline"
        aria-label="上一级"
        title="上一级"
        :disabled="!!s.busy || s.path === '/'"
        @click="w.loadFiles(parentPath(s.path))"
        ><ChevronUp aria-hidden="true"
      /></Button>
      <form @submit.prevent="w.loadFiles(s.pathInput)">
        <Input v-model="s.pathInput" aria-label="设备目录" :disabled="!!s.busy" :spellcheck="false" />
      </form>
      <Button
        class="icon-button"
        variant="outline"
        aria-label="刷新目录"
        :disabled="!!s.busy"
        @click="w.loadFiles(s.path)"
        ><RefreshCw aria-hidden="true"
      /></Button>
    </div>
    <div class="file-actions">
      <Button variant="outline" :disabled="!!s.busy" @click="upload"
        ><Upload class="icon-info" aria-hidden="true" />上传文件</Button
      ><Button variant="outline" :disabled="!!s.busy || s.file?.type !== 'file'" @click="download"
        ><Download class="icon-info" aria-hidden="true" />下载</Button
      ><Button
        variant="outline"
        :disabled="!!s.busy"
        @click="
          s.name = '';
          s.modal = 'folder';
        "
        ><FolderPlus class="icon-files" aria-hidden="true" />新建文件夹</Button
      ><span class="muted">{{ s.files.length }} 项</span>
    </div>
    <table class="file-table" aria-label="设备文件">
      <thead>
        <tr>
          <th>名称</th>
          <th>大小</th>
          <th>修改时间</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="f in s.files"
          :key="f.path"
          :tabindex="s.busy ? -1 : 0"
          :aria-selected="s.file?.path === f.path"
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
              ><small v-if="f.type === 'link'">链接</small></span
            >
          </td>
          <td>{{ f.type === 'file' ? sizeLabel(f.size) : '—' }}</td>
          <td>{{ date(f.modified) }}</td>
        </tr>
      </tbody>
    </table>
    <div v-if="!s.files.length && !s.busy" class="empty-directory">此目录为空</div>
    <p class="field-hint">双击文件夹进入。上传不会覆盖同名文件；链接和特殊文件仅供查看。</p>
  </template>
</template>
