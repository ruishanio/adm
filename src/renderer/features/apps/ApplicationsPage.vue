<script setup lang="ts">
import { PackagePlus } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { useWorkbench } from '@/composables/workbench';
import { t } from '../../../shared/i18n';
import InstalledAppsPage from './InstalledAppsPage.vue';

const w = useWorkbench();
</script>

<template>
  <div class="applications-page">
    <InstalledAppsPage>
      <template #actions>
        <Button variant="ghost" class="quiet" :disabled="!!w.state.busy" @click="w.openInstall">
          <PackagePlus aria-hidden="true" />{{ t('安装应用') }}
        </Button>
      </template>
    </InstalledAppsPage>
  </div>
</template>
