<script setup lang="ts">
import { useInstall } from '@/features/apps/install/state';
const installFeature = useInstall();

import { PackagePlus } from '@lucide/vue';
import { Button } from '@/shared/ui/button/index';
import { useWorkspace } from '@/shared/composables/workspace';
import { t } from '@/shared/i18n/index';
import InstalledAppsPage from '@/features/apps/InstalledAppsPage.vue';

const w = useWorkspace();
</script>

<template>
  <div class="applications-page">
    <InstalledAppsPage>
      <template #actions>
        <Button variant="ghost" class="quiet" :disabled="!!w.state.busy" @click="installFeature.openInstall">
          <PackagePlus aria-hidden="true" />{{ t('安装应用') }}
        </Button>
      </template>
    </InstalledAppsPage>
  </div>
</template>
