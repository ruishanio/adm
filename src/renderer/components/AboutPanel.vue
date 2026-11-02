<script setup lang="ts">
import { APP_NAME, APP_FULL_NAME, APP_VERSION } from '../../shared/app-info';
import { t } from '../../shared/i18n';

defineProps<{ version?: string }>();
</script>
<template>
  <section class="about-panel" :aria-label="t('关于')">
    <h3>{{ APP_NAME }}</h3>
    <p class="field-hint">{{ APP_FULL_NAME }}<sup>™</sup></p>
    <p class="field-hint">{{ t('版本 {version}', { version: version || APP_VERSION }) }}</p>
    <p class="field-hint">{{ t('自有代码采用 MIT 许可') }} · © 2026 RuiNext</p>
    <p class="about-attribution">Android is a trademark of Google LLC.</p>
  </section>
</template>
<style scoped>
.about-panel h3 {
  font-size: 18px;
  margin: 0;
}
.about-panel sup {
  font-size: 9px;
}
.about-attribution {
  font-size: 11px;
  line-height: 1.5;
  color: var(--muted);
  margin: 10px 0;
  overflow-wrap: anywhere;
  user-select: text;
}
</style>
