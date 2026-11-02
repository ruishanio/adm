<script setup lang="ts">
import { useInstall } from '@/features/apps/install/state';
const installFeature = useInstall();
import { useOwner } from '@/features/devices/owner/state';
const ownerFeature = useOwner();

import { t } from '@/shared/i18n/index';
import { computed } from 'vue';
import { Package, Upload, FilePlus2, Download, LoaderCircle, X } from '@lucide/vue';
import { Button } from '@/shared/ui/button/index';
import { Checkbox } from '@/shared/ui/checkbox/index';
import { useWorkspace } from '@/shared/composables/workspace';
import { sizeLabel } from '@/shared/utils/format';
import AppDialog from '@/shared/ui/AppDialog.vue';
const w = useWorkspace(),
  s = w.state;
const properties = computed(() =>
  installFeature.state.apk
    ? [
        [t('应用包名'), installFeature.state.apk.packageName],
        [t('版本'), `${installFeature.state.apk.versionName} (${installFeature.state.apk.versionCode})`],
        [t('最低 Android API'), installFeature.state.apk.minimumSdk],
        [
          t('管理组件'),
          installFeature.state.apk.admins.length
            ? t('{count} 个已识别', { count: installFeature.state.apk.admins.length })
            : t('未声明'),
        ],
      ]
    : [],
);
</script>
<template>
  <AppDialog
    :title="t('安装应用')"
    :busy="!!s.busy"
    content-class="install-dialog"
    @close="installFeature.closeInstall"
  >
    <div class="dialog-body install-dialog-body">
      <p class="install-target muted">
        {{ w.online.value ? t('目标：{name}', { name: w.title.value }) : t('请先选择已连接的设备') }}
        <span v-if="w.online.value" class="metadata-inline">
          <span>{{ w.device.value?.serial }}</span
          ><span>{{ t('主用户（用户 0）') }}</span>
        </span>
      </p>
      <section>
        <div class="section-heading">
          <h2><Package class="icon-install" aria-hidden="true" />{{ t('安装包') }}</h2>
          <Button
            v-if="installFeature.state.apk"
            variant="ghost"
            class="text-button"
            :disabled="!!s.busy"
            @click="installFeature.chooseApk"
            >{{ t('更换 APK') }}</Button
          >
        </div>
        <div
          :class="[
            'drop-zone',
            { dragging: installFeature.state.dragging, 'has-apk': installFeature.state.apk },
          ]"
        >
          <template v-if="installFeature.state.apk"
            ><div class="package-symbol"><Package aria-hidden="true" /></div>
            <div class="package-title">
              <strong>{{ installFeature.state.apk.fileName }}</strong
              ><span class="metadata-inline">
                <span>{{ sizeLabel(installFeature.state.apk.size) }}</span
                ><span>{{ t('APK 安装包') }}</span>
              </span>
            </div>
            <Button
              variant="ghost"
              class="icon-button"
              :aria-label="t('移除安装包')"
              :disabled="!!s.busy"
              @click="
                installFeature.state.apk = undefined;
                ownerFeature.state.component = '';
              "
              ><X aria-hidden="true" /></Button
          ></template>
          <template v-else
            ><Upload aria-hidden="true" :size="26" /><strong>{{ t('将 APK 拖到这里') }}</strong
            ><span>{{ t('支持单个完整的 Android 安装包') }}</span
            ><Button variant="outline" :disabled="!!s.busy" @click="installFeature.chooseApk"
              ><FilePlus2 class="icon-install" aria-hidden="true" />{{ t('选择文件') }}</Button
            ></template
          >
        </div>
        <dl v-if="installFeature.state.apk" class="properties apk-properties">
          <div v-for="[label, value] in properties" :key="label">
            <dt>{{ label }}</dt>
            <dd :title="value">{{ value }}</dd>
          </div>
        </dl>
      </section>
      <section class="install-options">
        <h2>{{ t('安装选项') }}</h2>
        <label class="checkbox"
          ><Checkbox
            v-model="installFeature.state.allowTest"
            :disabled="!!s.busy"
            :aria-label="t('允许安装测试包')"
          />{{ t('允许安装测试包') }} <code>testOnly</code></label
        ><label class="checkbox"
          ><Checkbox
            v-model="ownerFeature.state.ownerAfter"
            :disabled="!!s.busy"
            :aria-label="t('安装后配置设备所有者')"
          />{{ t('安装后配置设备所有者') }}</label
        >
        <p class="field-hint">{{ t('覆盖升级保留应用数据。配置设备所有者需要再次检查并确认授权。') }}</p>
      </section>
    </div>
    <!-- 弹窗遮挡工作区时，进度、错误与停止等待入口必须留在弹窗内。 -->
    <div
      v-if="s.busy || s.notice?.error"
      :class="['install-feedback', { error: s.notice?.error }]"
      :role="s.notice?.error ? 'alert' : 'status'"
    >
      <LoaderCircle v-if="s.busy" class="spin" aria-hidden="true" />
      <span>{{ s.busy || s.notice?.text }}</span>
    </div>
    <footer class="dialog-footer">
      <Button v-if="s.busy" variant="outline" @click="w.api.cancel">{{ t('停止等待') }}</Button>
      <Button v-else variant="outline" @click="installFeature.closeInstall">{{ t('取消') }}</Button>
      <Button
        class="primary"
        :disabled="!w.online.value || !installFeature.state.apk || !!s.busy"
        @click="installFeature.install"
        ><Download aria-hidden="true" />{{ t('安装到此设备') }}</Button
      >
    </footer>
  </AppDialog>
</template>
