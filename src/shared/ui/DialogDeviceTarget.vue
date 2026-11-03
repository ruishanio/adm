<script setup lang="ts">
import { Smartphone } from '@lucide/vue';
import { t } from '@/shared/i18n';

defineProps<{ name: string; serial?: string; scope?: string }>();
</script>
<template>
  <div class="dialog-device-target">
    <Smartphone class="icon-info" aria-hidden="true" />
    <div>
      <p class="dialog-target-name">
        <span>{{ t('目标设备') }}</span
        >{{ name }}
      </p>
      <p v-if="serial || scope" class="metadata-inline dialog-target-meta">
        <span v-if="serial">{{ serial }}</span
        ><span v-if="scope">{{ scope }}</span>
      </p>
    </div>
  </div>
</template>
