<script setup lang="ts">
import { APP_NAME, APP_FULL_NAME, APP_VERSION } from '@/shared/app-info';
import appIcon from '../../../src-tauri/icons/128x128.png';
import { t } from '@/shared/i18n/index';

import { Button } from '@/shared/ui/button';
import { useUpdates } from './updates';
import { useWorkspace } from '@/shared/composables/workspace';
const updates = useUpdates(),
  u = updates.state;
const workspace = useWorkspace();
defineProps<{ version?: string }>();
</script>
<template>
  <section class="about-panel" :aria-label="t('关于')">
    <header class="about-identity">
      <img :src="appIcon" width="76" height="76" alt="" />
      <h3>{{ APP_NAME }}</h3>
      <p>{{ APP_FULL_NAME }}<sup>™</sup></p>
    </header>
    <div class="about-version">
      <div>
        <p class="about-version-number">{{ t('版本 {version}', { version: version || APP_VERSION }) }}</p>
        <p v-if="u.update || u.phase === 'current'" class="about-update-status" role="status">
          {{ u.update ? t('有新版本 {version}', { version: u.update.version }) : t('已是最新版本') }}
        </p>
      </div>
      <Button variant="outline" @click="workspace.state.modal = 'settings-update'">
        {{ u.update ? t('查看更新') : t('检查更新') }}
      </Button>
    </div>
    <footer class="about-legal">
      <p class="metadata-inline">
        <span>© 2026 {{ t('睿善科技') }}</span>
        <span>{{ t('自有代码采用 MIT 许可') }}</span>
      </p>
      <p lang="en">Android is a trademark of Google LLC.</p>
    </footer>
  </section>
</template>
<style scoped>
.about-panel {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  overflow-wrap: anywhere;
  user-select: text;
}
.about-identity {
  display: grid;
  flex: 1 0 auto;
  justify-items: center;
  align-content: center;
  padding: var(--space-4) 0 var(--space-6);
  text-align: center;
}
.about-identity h3 {
  margin-top: var(--space-2);
  font-size: 22px;
  line-height: 1.25;
}
.about-identity p {
  margin-top: var(--space-1);
  color: var(--muted);
}
.about-identity sup {
  font-size: 9px;
}
.about-version {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-4) 0;
  border-block: 1px solid var(--line);
}
.about-version-number {
  font-weight: 600;
}
.about-update-status {
  margin-top: var(--space-1);
  font-size: 12px;
  color: var(--muted);
}
.about-legal {
  display: grid;
  gap: var(--space-1);
  padding-top: var(--space-3);
  font-size: 11px;
  color: var(--muted);
}
</style>
