<script setup lang="ts">
import { computed } from 'vue';
import { Smartphone, ArrowRight, Cpu, ShieldCheck, ChevronRight } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useWorkbench } from '@/composables/workbench';
import { deviceStatus } from '../../shared/contracts';
const w = useWorkbench(),
  s = w.state;
const properties = computed(() => [
  ['制造商', s.details?.manufacturer],
  ['型号', s.details?.model],
  ['Android 版本', s.details ? `${s.details.android} · API ${s.details.api}` : ''],
  ['安全补丁', s.details?.patch],
  ['处理器架构', s.details?.architecture],
  ['设备序列号', s.details?.serial],
]);
</script>
<template>
  <div v-if="!w.online.value" class="empty-state">
    <Smartphone aria-hidden="true" />
    <h2>{{ w.device.value ? deviceStatus(w.device.value) : '从左侧选择设备' }}</h2>
    <p>
      {{
        w.device.value?.state === 'unauthorized'
          ? '请解锁设备并允许此电脑进行调试。'
          : '设备连接后，可查看系统信息并配置设备所有者。'
      }}
    </p>
    <Button variant="outline" @click="s.modal = 'connect'">连接设备<ArrowRight aria-hidden="true" /></Button>
  </div>
  <template v-else>
    <section>
      <div class="section-heading">
        <h2><Cpu class="icon-info" aria-hidden="true" />系统信息</h2>
        <span v-if="!s.details" class="muted">正在读取…</span>
      </div>
      <dl class="properties system-properties">
        <div v-for="[label, value] in properties" :key="label">
          <dt>{{ label }}</dt>
          <dd :title="value">{{ value || '—' }}</dd>
        </div>
      </dl>
    </section>
    <section class="owner-section">
      <div class="section-heading">
        <h2><ShieldCheck class="icon-owner" aria-hidden="true" />设备所有者</h2>
      </div>
      <div class="owner-current">
        <span class="muted">当前所有者</span
        ><span :class="{ mono: s.details?.owner }">{{
          s.details ? s.details.owner || '尚未设置' : '读取中…'
        }}</span>
      </div>
      <Button
        variant="ghost"
        class="quiet owner-config-toggle"
        :aria-expanded="s.ownerExpanded"
        aria-controls="owner-configuration"
        @click="s.ownerExpanded = !s.ownerExpanded"
        ><ChevronRight aria-hidden="true" />配置设备所有者</Button
      >
      <div id="owner-configuration" class="owner-form" :hidden="!s.ownerExpanded">
        <div v-if="s.apk?.admins.length" class="form-row">
          <label for="apk-admin">安装包组件</label
          ><select id="apk-admin" v-model="s.component" :disabled="!!s.busy">
            <option v-for="component in s.apk.admins" :key="component" :value="component">
              {{ component }}
            </option>
            <option v-if="!s.apk.admins.includes(s.component)" :value="s.component">自定义组件</option>
          </select>
        </div>
        <div class="form-row">
          <label for="owner-component">管理组件</label>
          <div class="component-input">
            <Input
              id="owner-component"
              v-model="s.component"
              :aria-describedby="s.ownerCheck ? 'owner-result' : 'owner-help'"
              placeholder="com.example.app/.DeviceAdminReceiver"
              :disabled="!!s.busy"
              :spellcheck="false"
            /><Button variant="outline" :disabled="!!s.busy || !s.component.trim()" @click="w.checkOwner"
              >检查条件</Button
            >
          </div>
        </div>
        <div
          v-if="s.ownerCheck"
          id="owner-result"
          role="status"
          :class="['inline-result', s.ownerCheck.canSet || s.ownerCheck.alreadySet ? 'success' : 'error']"
        >
          {{ s.ownerCheck.summary }}
        </div>
        <p v-else id="owner-help" class="field-hint">先安装管理应用，再检查组件、主用户和账号状态。</p>
        <div class="owner-actions">
          <label class="checkbox"
            ><Checkbox
              v-model="s.consent"
              :disabled="!!s.busy || !s.ownerCheck?.canSet"
              aria-label="确认将此设备授权给上述管理应用"
            /><span>确认将此设备授权给上述管理应用</span></label
          ><Button
            class="primary"
            :disabled="!!s.busy || !s.consent || !s.ownerCheck?.canSet"
            @click="w.setOwner"
            >设置设备所有者</Button
          >
        </div>
      </div>
    </section>
  </template>
</template>
