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
    <InstalledAppsPage>
      <template #heading="{ count }">
        <header class="applications-heading">
          <div class="applications-title">
            <h2>{{ t('已安装应用') }}</h2>
            <span v-if="count !== undefined" class="applications-count">{{
              t('{count} 个应用', { count })
            }}</span>
          </div>
          <Button class="primary" :disabled="!!w.state.busy" @click="w.openInstall">
            <PackagePlus aria-hidden="true" />{{ t('安装应用') }}
          </Button>
        </header>
      </template>
    </InstalledAppsPage>
  </div>
</template>
