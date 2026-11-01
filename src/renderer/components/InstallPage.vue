<script setup lang="ts">
import { computed } from 'vue';
import { Package, Upload, FilePlus2, Download, X } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useWorkbench } from '@/composables/workbench';
import { sizeLabel } from './format';
const w = useWorkbench(),
  s = w.state;
const properties = computed(() =>
  s.apk
    ? [
        ['应用包名', s.apk.packageName],
        ['版本', `${s.apk.versionName} (${s.apk.versionCode})`],
        ['最低 Android API', s.apk.minimumSdk],
        ['管理组件', s.apk.admins.length ? `${s.apk.admins.length} 个已识别` : '未声明'],
      ]
    : [],
);
</script>
<template>
  <section>
    <div class="section-heading">
      <h2><Package class="icon-install" aria-hidden="true" />安装包</h2>
      <Button v-if="s.apk" variant="ghost" class="text-button" :disabled="!!s.busy" @click="w.chooseApk"
        >更换 APK</Button
      >
    </div>
    <div :class="['drop-zone', { dragging: s.dragging, 'has-apk': s.apk }]">
      <template v-if="s.apk"
        ><div class="package-symbol"><Package aria-hidden="true" /></div>
        <div class="package-title">
          <strong>{{ s.apk.fileName }}</strong
          ><span>{{ sizeLabel(s.apk.size) }}<span class="separator-dot">·</span>APK 安装包</span>
        </div>
        <Button
          variant="ghost"
          class="icon-button"
          aria-label="移除安装包"
          :disabled="!!s.busy"
          @click="
            s.apk = undefined;
            s.component = '';
          "
          ><X aria-hidden="true" /></Button
      ></template>
      <template v-else
        ><Upload aria-hidden="true" :size="26" /><strong>将 APK 拖到这里</strong
        ><span>支持单个完整的 Android 安装包</span
        ><Button variant="outline" :disabled="!!s.busy" @click="w.chooseApk"
          ><FilePlus2 class="icon-install" aria-hidden="true" />选择文件</Button
        ></template
      >
    </div>
    <dl v-if="s.apk" class="properties apk-properties">
      <div v-for="[label, value] in properties" :key="label">
        <dt>{{ label }}</dt>
        <dd :title="value">{{ value }}</dd>
      </div>
    </dl>
  </section>
  <section class="install-options">
    <h2>安装选项</h2>
    <label class="checkbox"
      ><Checkbox v-model="s.allowTest" :disabled="!!s.busy" aria-label="允许安装测试包" />允许安装测试包
      <code>testOnly</code></label
    ><label class="checkbox"
      ><Checkbox
        v-model="s.ownerAfter"
        :disabled="!!s.busy"
        aria-label="安装后配置设备所有者"
      />安装后配置设备所有者</label
    >
    <p class="field-hint">覆盖升级保留应用数据。配置设备所有者需要再次检查并确认授权。</p>
  </section>
  <div class="install-action">
    <span class="muted">{{ w.online.value ? '目标：' + w.title.value : '请先选择已连接的设备' }}</span
    ><Button class="primary" :disabled="!w.online.value || !s.apk || !!s.busy" @click="w.install"
      ><Download aria-hidden="true" />安装到此设备</Button
    >
  </div>
</template>
