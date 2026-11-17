<script setup lang="ts">
import { useDevices } from '@/features/devices/state';
const devicesFeature = useDevices();

import { t } from '@/shared/i18n/index';
import { computed, nextTick, ref } from 'vue';
import { Cable, Network, Wifi } from '@lucide/vue';
import AppDialog from '@/shared/ui/AppDialog.vue';
import { Button } from '@/shared/ui/button/index';
import { Input } from '@/shared/ui/input/index';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/ui/tabs/index';
import { useWorkspace } from '@/shared/composables/workspace';
import { targetKey } from '@/shared/utils/device';
const w = useWorkspace(),
  s = w.state;
// 每次打开从空地址开始，避免把历史设备当作本次连接目标。
const tab = ref('network'),
  address = ref(''),
  pairAddress = ref(''),
  code = ref('');
const message = ref(''),
  error = ref(false);
const needsConnectionPort = computed(() => address.value.trim().endsWith(':'));
async function submit() {
  if (s.busy || (tab.value === 'network' && needsConnectionPort.value)) return;
  message.value = '';
  error.value = false;
  let paired = false;
  await w.run(tab.value === 'pair' ? t('正在配对设备') : t('正在连接设备'), async () => {
    try {
      if (tab.value === 'pair') {
        const pairingEndpoint = pairAddress.value.trim();
        await w.api.pair(pairingEndpoint, code.value);
        // 配对地址已由后端校验；仅继承主机部分，保留 IPv6 方括号，避免沿用旧设备或配对端口。
        address.value = pairingEndpoint.replace(/:\d+$/, ':');
        code.value = '';
        tab.value = 'network';
        message.value = t('配对成功，已填入设备地址。请在冒号后填写无线调试主页上的连接端口。');
        paired = true;
      } else {
        await w.api.connect(address.value);
        await devicesFeature.refresh();
        const d = devicesFeature.state.snapshot?.devices.find((d) => d.serial === address.value.trim());
        if (d) s.selected = targetKey(d);
        s.modal = null;
      }
    } catch (e) {
      error.value = true;
      message.value = e instanceof Error ? e.message : String(e);
      throw e;
    }
  });
  if (paired) {
    // 等任务结束、输入框恢复可编辑后，将光标放到端口位置，直接继续下一步。
    await nextTick();
    const input = document.getElementById('connection-address') as HTMLInputElement | null;
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }
}
</script>
<template>
  <AppDialog
    :title="t('连接设备')"
    content-class="connection-dialog"
    :busy="!!s.busy"
    @close="s.modal = null"
  >
    <div class="dialog-body">
      <Tabs v-model="tab" class="connection-layout"
        ><TabsList class="connection-tabs" :aria-label="t('连接方式')"
          ><TabsTrigger value="network" :disabled="!!s.busy"
            ><Network aria-hidden="true" />{{ t('网络连接') }}</TabsTrigger
          ><TabsTrigger value="pair" :disabled="!!s.busy"
            ><Wifi aria-hidden="true" />{{ t('无线配对') }}</TabsTrigger
          ><TabsTrigger value="usb" :disabled="!!s.busy"
            ><Cable aria-hidden="true" />{{ t('USB 连接') }}</TabsTrigger
          ></TabsList
        >
        <TabsContent value="usb" class="connection-panel usb-guide"
          ><p>{{ t('连接后，设备会自动出现在左侧列表。') }}</p>
          <ol>
            <li>{{ t('在 Android 设备上开启开发者选项与 USB 调试。') }}</li>
            <li>{{ t('使用支持数据传输的 USB 线连接电脑。') }}</li>
            <li>{{ t('解锁设备，允许这台电脑进行调试。') }}</li>
          </ol>
          <p class="muted">{{ t('Windows 未识别设备时，请安装设备厂商的 ADB 驱动。') }}</p></TabsContent
        >
        <TabsContent
          v-for="method in ['network', 'pair']"
          :key="method"
          :value="method"
          class="connection-panel"
        >
          <form v-if="tab === method" id="connect-form" @submit.prevent="submit">
            <label class="field"
              >{{ tab === 'pair' ? t('配对地址') : t('设备地址')
              }}<Input
                v-if="tab === 'pair'"
                v-model="pairAddress"
                autofocus
                placeholder="192.168.1.100:37000"
                :disabled="!!s.busy"
                required
                :spellcheck="false"
                aria-describedby="connection-help connection-result" /><Input
                v-else
                id="connection-address"
                v-model="address"
                autofocus
                placeholder="192.168.1.100:5555"
                :disabled="!!s.busy"
                required
                :spellcheck="false"
                aria-describedby="connection-help connection-result" /></label
            ><label v-if="tab === 'pair'" class="field"
              >{{ t('配对码')
              }}<Input
                v-model="code"
                inputmode="numeric"
                autocomplete="off"
                :placeholder="t('6 位数字')"
                pattern="[0-9]{6}"
                maxlength="6"
                required
                :disabled="!!s.busy"
            /></label>
            <p id="connection-help" class="field-hint">
              {{
                tab === 'pair'
                  ? t('在设备「无线调试 → 使用配对码配对设备」中查看地址和配对码。')
                  : t('电脑与设备需处于可互通的网络。无线调试的连接端口与配对端口通常不同。')
              }}
            </p>
          </form>
        </TabsContent>
      </Tabs>
      <div
        v-if="message"
        id="connection-result"
        :class="['inline-result', error ? 'error' : 'success']"
        :role="error ? 'alert' : 'status'"
      >
        {{ message }}
      </div>
    </div>
    <footer class="dialog-footer">
      <template v-if="s.busy"
        ><span class="muted">{{ s.busy }}…</span
        ><Button variant="outline" @click="w.api.cancel">{{ t('停止等待') }}</Button></template
      ><template v-else
        ><Button variant="outline" @click="s.modal = null">{{ tab === 'usb' ? t('完成') : t('取消') }}</Button
        ><Button
          v-if="tab !== 'usb'"
          class="primary"
          type="submit"
          form="connect-form"
          :disabled="tab === 'network' && needsConnectionPort"
          >{{ tab === 'pair' ? t('配对设备') : t('连接') }}</Button
        ></template
      >
    </footer>
  </AppDialog>
</template>
