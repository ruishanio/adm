<script setup lang="ts">
import { ref } from 'vue';
import { FileText } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { t } from '../../shared/i18n';

const props = defineProps<{ platform?: string; openNotices: () => Promise<void> }>();
const opening = ref(false);
const failed = ref(false);

async function open() {
  if (opening.value) return;
  opening.value = true;
  failed.value = false;
  try {
    await props.openNotices();
  } catch {
    failed.value = true;
  } finally {
    opening.value = false;
  }
}
</script>

<template>
  <section class="license-panel" :aria-label="t('第三方许可')">
    <!-- 保留图形要求的原始署名；依赖许可全文由本地文件提供，不再渲染审计清单。 -->
    <p class="license-notice">
      The Android robot is reproduced or modified from work created and shared by Google and used according to
      terms described in the Creative Commons 3.0 Attribution License
      (https://creativecommons.org/licenses/by/3.0/).
    </p>
    <p v-if="platform === 'win32'" class="license-notice">
      {{
        t(
          'WebView2 适用微软的独立许可条款。其 Microsoft Defender SmartScreen 会收集用户信息并发送给微软，详见完整声明中的微软隐私声明及 Edge 隐私白皮书。',
        )
      }}
    </p>
    <p class="field-hint">{{ t('完整许可与版权声明已随应用附带，可离线查看。') }}</p>
    <Button variant="outline" :disabled="opening" :aria-busy="opening" data-open-notices @click="open">
      <FileText aria-hidden="true" />{{ t('查看完整声明') }}
    </Button>
    <p v-if="failed" role="alert" class="license-error">{{ t('无法打开声明文件，请重试。') }}</p>
  </section>
</template>

<style scoped>
.license-notice {
  font-size: 12px;
  line-height: 1.6;
  margin: 12px 0;
  overflow-wrap: anywhere;
  user-select: text;
}
.license-notice:first-child {
  margin-top: 0;
}
.license-error {
  color: var(--error);
  font-size: 12px;
  margin: 8px 0;
}
</style>
