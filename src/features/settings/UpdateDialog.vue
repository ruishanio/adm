<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { APP_VERSION } from '@/shared/app-info';
import { useWorkspace } from '@/shared/composables/workspace';
import { t } from '@/shared/i18n';
import AppDialog from '@/shared/ui/AppDialog.vue';
import { Button } from '@/shared/ui/button';
import { useUpdates } from './updates';

const emit = defineEmits<{ close: [] }>();
const updates = useUpdates(),
  u = updates.state;
const workspace = useWorkspace();
const props = defineProps<{ version?: string }>();
const downloading = computed(() => u.phase === 'downloading');
const installing = computed(() => u.phase === 'installing');
const ready = computed(() => u.phase === 'ready' || installing.value);

const message = computed(() => {
  const version = u.update?.version || props.version || APP_VERSION;
  switch (u.phase) {
    case 'checking':
      return t('正在检查…');
    case 'current':
      return t('ADM {version} 已是最新版本。', { version });
    case 'available':
      return t('发现新版本 ADM {version}。', { version });
    case 'downloading':
      return t('正在下载 ADM {version}…', { version });
    case 'ready':
      return t('ADM {version} 已下载，现在安装并重启吗？', { version });
    case 'installing':
      return t('正在安装 ADM {version}…', { version });
    case 'idle':
      return '';
  }
});

onMounted(() => {
  // 手动进入时检查最新版本；重新打开正在下载或已就绪的更新时沿用同一次任务。
  if (!u.update && !updates.busy.value) void updates.check();
});
</script>

<template>
  <AppDialog
    :title="t('软件更新')"
    content-class="confirm-dialog"
    :busy="installing || downloading"
    @close="emit('close')"
  >
    <div class="dialog-body">
      <p v-if="u.error || u.phase === 'idle'" class="inline-result error" role="alert">
        {{ u.error || t('无法获取更新清单，请稍后重试。') }}
      </p>
      <p v-else-if="u.phase === 'ready' && workspace.state.busy" class="dialog-message" role="status">
        {{ t('请等设备操作完成后再更新。') }}
      </p>
      <template v-else>
        <p class="dialog-message" role="status">{{ message }}</p>
        <div v-if="downloading" class="update-progress">
          <!-- 总大小未知时省略 value，让系统显示未定进度，避免误报 0%。 -->
          <div class="update-track" :class="{ indeterminate: u.progress === null }">
            <progress :aria-label="t('下载更新')" :value="u.progress ?? undefined" max="100" />
          </div>
          <span v-if="u.progress !== null" aria-hidden="true">{{ u.progress }}%</span>
        </div>
      </template>
    </div>
    <footer class="dialog-footer">
      <Button variant="outline" :disabled="installing" @click="emit('close')">
        {{ downloading ? t('在后台下载') : u.update ? t('稍后') : t('关闭') }}
      </Button>
      <Button
        v-if="ready"
        class="primary"
        :disabled="installing || !!workspace.state.busy"
        @click="updates.install()"
      >
        {{ installing ? t('正在安装…') : t('安装并重启') }}
      </Button>
      <Button v-else-if="u.update && u.phase === 'available'" class="primary" @click="updates.download()">
        {{ u.update.portable ? t('下载便携版 ZIP') : u.error ? t('重试') : t('下载更新') }}
      </Button>
      <Button v-else-if="u.phase === 'idle'" class="primary" @click="updates.check()">{{ t('重试') }}</Button>
    </footer>
  </AppDialog>
</template>

<style scoped>
.update-progress {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 18px;
  margin-top: var(--space-2);
}
.update-track {
  flex: 1;
  min-width: 0;
  height: 6px;
  border-radius: var(--radius-control);
  overflow: hidden;
  background: var(--line);
  position: relative;
}
.update-track progress {
  display: block;
  width: 100%;
  height: 100%;
  appearance: none;
  border: none;
  background: transparent;
}
.update-track progress::-webkit-progress-bar {
  background: transparent;
}
.update-track progress::-webkit-progress-value {
  background: var(--accent);
  border-radius: var(--radius-control);
}
.update-track.indeterminate::after {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 32%;
  background: var(--accent);
  border-radius: inherit;
  animation: download-pending 1.4s ease-in-out infinite alternate;
}
@keyframes download-pending {
  to {
    transform: translateX(212.5%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .update-track.indeterminate::after {
    animation: none;
  }
}
.update-progress span {
  min-width: 4ch;
  text-align: end;
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
</style>
