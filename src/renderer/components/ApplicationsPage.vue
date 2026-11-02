<script setup lang="ts">
import { PackagePlus } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { useWorkbench } from '@/composables/workbench';
import { t } from '../../shared/i18n';
import InstalledAppsPage from './InstalledAppsPage.vue';

const w = useWorkbench();
</script>

<template>
  <div class="applications-page">
    <div class="applications-heading">
      <h2>{{ t('已安装应用') }}</h2>
      <Button class="primary" :disabled="!!w.state.busy" @click="w.openInstall">
        <PackagePlus aria-hidden="true" />{{ t('安装应用') }}
      </Button>
    </div>
    <InstalledAppsPage />
  </div>
</template>
