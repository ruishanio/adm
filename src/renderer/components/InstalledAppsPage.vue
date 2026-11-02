<script setup lang="ts">
import { computed } from 'vue';
import { AppWindow, Info, RefreshCw, Search, Trash2 } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useWorkbench } from '@/composables/workbench';
import { t } from '../../shared/i18n';
import AppDialog from './AppDialog.vue';

const w = useWorkbench(),
  s = w.state;
const filtered = computed(() => {
  const query = s.appQuery.trim().toLowerCase();
  return s.apps.filter(
    (app) =>
      (s.showSystemApps || !app.system) &&
      (app.packageName.toLowerCase().includes(query) || app.label?.toLowerCase().includes(query)),
  );
});
const details = computed(() => s.application?.details);
const rows = computed(() =>
  details.value
    ? [
        [t('应用名称'), details.value.label || t('名称不可用')],
        [t('应用包名'), details.value.packageName],
        [t('版本'), details.value.versionName || '—'],
        [t('版本代码'), details.value.versionCode],
        [t('应用类型'), details.value.system ? t('系统应用') : t('用户应用')],
        [t('应用状态'), details.value.enabled ? t('已启用') : t('已停用')],
        ['UID', details.value.uid || '—'],
        [t('最低 Android API'), details.value.minimumSdk || '—'],
        [t('目标 Android API'), details.value.targetSdk || '—'],
        [t('首次安装'), details.value.firstInstallTime || '—'],
        [t('最近更新'), details.value.lastUpdateTime || '—'],
        [t('安装来源'), details.value.installer || '—'],
        [t('APK 路径'), details.value.apkPath],
      ]
    : [],
);
function close() {
  s.modal = null;
  s.application = undefined;
}
</script>

<template>
  <div v-if="!w.online.value" class="empty-state">
    <AppWindow class="icon-apps" aria-hidden="true" />
    <h2>{{ t('选择已连接的设备') }}</h2>
    <p>{{ t('查看和管理设备上的已安装应用。') }}</p>
  </div>
  <div v-else class="installed-apps">
    <div class="apps-toolbar">
      <div class="apps-search">
        <Search aria-hidden="true" />
        <Input
          v-model="s.appQuery"
          type="search"
          :aria-label="t('搜索应用名称或包名')"
          :placeholder="t('搜索应用名称或包名')"
          :spellcheck="false"
        />
      </div>
      <label class="checkbox" for="show-system-apps"
        ><Checkbox id="show-system-apps" v-model="s.showSystemApps" :aria-label="t('显示系统应用')" />{{
          t('显示系统应用')
        }}</label
      >
      <Button variant="outline" :disabled="!!s.busy" @click="w.loadApps"
        ><RefreshCw aria-hidden="true" />{{ t('刷新应用') }}</Button
      >
    </div>
    <div class="apps-summary">
      <span>{{ t('主用户（用户 0）') }}</span
      ><span v-if="s.appsLoaded">{{ t('{count} 个应用', { count: filtered.length }) }}</span>
    </div>
    <div v-if="!s.appsLoaded" class="apps-empty" role="status">
      <p>{{ s.busy ? t('正在读取应用列表…') : t('应用列表尚未加载，请刷新。') }}</p>
    </div>
    <div v-else class="apps-scroll">
      <table class="apps-table" :aria-label="t('已安装应用')">
        <thead>
          <tr>
            <th scope="col">{{ t('应用名称') }}</th>
            <th scope="col">{{ t('应用类型') }}</th>
            <th scope="col">{{ t('应用状态') }}</th>
            <th scope="col">
              <span class="sr-only">{{ t('应用信息') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="app in filtered" :key="app.packageName">
            <td>
              <button class="app-package" :disabled="!!s.busy" @click="w.openApp(app)">
                <AppWindow class="icon-apps" aria-hidden="true" />
                <span class="app-identity">
                  <span class="app-name">{{ app.label || app.packageName }}</span>
                  <span class="app-identifier">{{ app.label ? app.packageName : t('名称不可用') }}</span>
                </span>
              </button>
            </td>
            <td>{{ app.system ? t('系统应用') : t('用户应用') }}</td>
            <td>{{ app.enabled ? t('已启用') : t('已停用') }}</td>
            <td>
              <Button
                variant="ghost"
                class="icon-button"
                :aria-label="
                  t('查看 {package} 的信息', {
                    package: app.label ? `${app.label} (${app.packageName})` : app.packageName,
                  })
                "
                :title="t('应用信息')"
                :disabled="!!s.busy"
                @click="w.openApp(app)"
                ><Info aria-hidden="true"
              /></Button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!filtered.length" class="apps-empty">
        {{
          s.appQuery.trim()
            ? t('没有匹配的应用')
            : s.showSystemApps
              ? t('没有已安装的应用')
              : t('没有已安装的用户应用')
        }}
      </p>
    </div>
  </div>
  <AppDialog
    v-if="s.modal === 'app-details' || s.modal === 'app-uninstall'"
    :title="s.modal === 'app-uninstall' ? t('卸载应用') : t('应用信息')"
    :busy="!!s.busy"
    content-class="app-details-dialog"
    @close="close"
  >
    <div class="dialog-body app-details-body">
      <p class="muted app-target">
        {{ t('目标：{name}', { name: s.application?.deviceName || '' }) }}
        <br />{{ s.application?.target.serial }} · {{ t('主用户（用户 0）') }}
      </p>
      <template v-if="s.modal === 'app-uninstall' && details">
        <p class="app-uninstall-package">{{ details.label || details.packageName }}</p>
        <p v-if="details.label" class="app-confirm-version">{{ details.packageName }}</p>
        <p class="app-confirm-version">
          {{ t('版本') }}：{{ details.versionName || '—' }} ({{ details.versionCode }})
        </p>
        <p>{{ t('卸载会删除该用户下的应用及其数据，此操作无法撤销。') }}</p>
      </template>
      <dl v-else-if="details" class="app-properties">
        <div v-for="[label, value] in rows" :key="label">
          <dt>{{ label }}</dt>
          <dd>{{ value }}</dd>
        </div>
      </dl>
      <p v-else-if="s.busy" role="status">{{ t('读取应用信息') }}</p>
      <p v-if="s.application?.error" class="inline-result error" role="alert">{{ s.application.error }}</p>
      <p v-if="details?.system" class="field-hint">{{ t('系统应用仅支持查看，不支持卸载。') }}</p>
    </div>
    <footer class="dialog-footer">
      <template v-if="s.modal === 'app-uninstall'">
        <Button variant="outline" :disabled="!!s.busy" @click="s.modal = 'app-details'">{{
          t('取消')
        }}</Button>
        <Button class="destructive" :disabled="!!s.busy || !w.online.value" @click="w.uninstallApp"
          ><Trash2 aria-hidden="true" />{{ t('确认卸载') }}</Button
        >
      </template>
      <template v-else>
        <Button
          v-if="details && !details.system"
          variant="outline"
          :disabled="!!s.busy"
          @click="s.modal = 'app-uninstall'"
          ><Trash2 aria-hidden="true" />{{ t('卸载应用') }}</Button
        >
        <Button variant="outline" :disabled="!!s.busy" @click="close">{{ t('关闭') }}</Button>
      </template>
    </footer>
  </AppDialog>
</template>
