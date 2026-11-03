<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import {
  Camera,
  Circle,
  Square,
  RotateCw,
  Power,
  RefreshCw,
  ChevronDown,
  ArrowLeft,
  House,
  PanelsTopLeft,
  Volume1,
  Volume2,
  Keyboard,
  MonitorPlay,
  LoaderCircle,
  X,
} from '@lucide/vue';
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'reka-ui';
import { Button } from '@/shared/ui/button';
import AppSelect from '@/shared/ui/AppSelect.vue';
import AppDialog from '@/shared/ui/AppDialog.vue';
import DialogDeviceTarget from '@/shared/ui/DialogDeviceTarget.vue';
import { useWorkspace } from '@/shared/composables/workspace';
import { t } from '@/shared/i18n';
import { createControl } from './session';
const w = useWorkspace(),
  canvas = ref<HTMLCanvasElement>(),
  stage = ref<HTMLElement>();
const control = createControl(w.api, () => canvas.value),
  s = control.state;
const space = reactive({ width: 0, height: 0 });
const quality = ref('1600'),
  dialog = ref<'reboot' | 'shutdown' | 'text'>(),
  text = ref('');
const disabled = computed(() => !s.ready || s.busy || !!w.state.busy);
const qualities = computed(() => [
  { value: '1080', label: t('流畅') },
  { value: '1600', label: t('清晰') },
  { value: '1920', label: t('高清') },
]);
const frameStyle = computed(() => {
  const scale = Math.min(space.width / (s.width || 1), space.height / (s.height || 1), 1);
  return { width: `${s.width * scale}px`, height: `${s.height * scale}px` };
});
const duration = computed(
  () =>
    `${Math.floor(s.elapsed / 60)
      .toString()
      .padStart(2, '0')}:${(s.elapsed % 60).toString().padStart(2, '0')}`,
);
let observer: ResizeObserver | undefined, pointer: number | undefined;
let last: { x: number; y: number; width: number; height: number } | undefined;
const held = new Set<number>();
function point(event: PointerEvent | WheelEvent) {
  const box = canvas.value!.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(s.width - 1, Math.floor(((event.clientX - box.left) / box.width) * s.width))),
    y: Math.max(0, Math.min(s.height - 1, Math.floor(((event.clientY - box.top) / box.height) * s.height))),
    width: s.width,
    height: s.height,
  };
}
function touch(event: PointerEvent, action: number) {
  if (disabled.value || !s.width || (action === 0 && event.button !== 0)) return;
  if (action === 0) {
    if (pointer !== undefined) return;
    pointer = event.pointerId;
    canvas.value?.focus();
    canvas.value?.setPointerCapture(pointer);
  } else if (pointer !== event.pointerId) return;
  event.preventDefault();
  last = point(event);
  control.input({ kind: 'touch', action, ...last });
  if (action === 1 || action === 3) {
    pointer = undefined;
    last = undefined;
  }
}
function release() {
  if (pointer !== undefined && last) control.input({ kind: 'touch', action: 3, ...last });
  pointer = undefined;
  last = undefined;
  for (const keyCode of held) control.input({ kind: 'key', action: 1, keyCode, meta: 0 });
  held.clear();
}
function keyCode(event: KeyboardEvent) {
  const keys: Record<string, number> = {
    Escape: 4,
    Enter: 66,
    Backspace: 67,
    Delete: 112,
    Tab: 61,
    ' ': 62,
    ArrowUp: 19,
    ArrowDown: 20,
    ArrowLeft: 21,
    ArrowRight: 22,
    Home: 122,
    End: 123,
  };
  if (keys[event.key]) return keys[event.key];
  if (/^Key[A-Z]$/.test(event.code)) return event.code.charCodeAt(3) - 65 + 29;
  if (/^Digit[0-9]$/.test(event.code)) return Number(event.code[5]) + 7;
}
function keyboard(event: KeyboardEvent, action: number) {
  if (disabled.value || event.isComposing || event.metaKey || event.ctrlKey || event.key === 'Tab') return;
  const code = keyCode(event);
  if (code === undefined) return;
  event.preventDefault();
  if (action === 0) held.add(code);
  else held.delete(code);
  control.input({ kind: 'key', action, keyCode: code, meta: event.shiftKey ? 1 : 0 });
}
function wheel(event: WheelEvent) {
  if (disabled.value) return;
  event.preventDefault();
  control.input({
    kind: 'scroll',
    ...point(event),
    horizontal: -event.deltaX / 100,
    vertical: -event.deltaY / 100,
  });
}
async function confirm() {
  const action = dialog.value;
  dialog.value = undefined;
  if (action === 'text') {
    control.input({ kind: 'text', text: text.value });
    text.value = '';
  } else if (action) await control.action(action);
}
watch(
  // 自动发现会替换设备对象；只有传输身份或在线状态变化才重建视频连接。
  () => (w.online.value ? `${w.device.value?.serial}:${w.device.value?.transportId}` : ''),
  () => {
    release();
    dialog.value = undefined;
    control.start(w.online.value ? w.device.value : undefined, Number(quality.value));
  },
  { immediate: true },
);
watch(quality, () => {
  release();
  control.start(w.online.value ? w.device.value : undefined, Number(quality.value));
});
watch(() => [s.width, s.height], release);
onMounted(() => {
  observer = new ResizeObserver((entries) => {
    const size = entries[0]?.contentRect;
    if (size) {
      space.width = size.width;
      space.height = size.height;
    }
  });
  if (stage.value) observer.observe(stage.value);
  window.addEventListener('blur', release);
});
onBeforeUnmount(() => {
  release();
  observer?.disconnect();
  window.removeEventListener('blur', release);
  control.dispose();
});
</script>
<template>
  <div class="control-page">
    <div class="workspace-toolbar control-toolbar">
      <div class="toolbar-row">
        <Button variant="ghost" class="quiet" :disabled="disabled" @click="control.action('screenshot')"
          ><Camera aria-hidden="true" />{{ t('截图') }}</Button
        >
        <Button
          variant="ghost"
          :class="['quiet', { 'control-recording': s.recording }]"
          :disabled="disabled"
          @click="control.action('record')"
          ><Square v-if="s.recording" aria-hidden="true" /><Circle v-else aria-hidden="true" />{{
            s.recording ? t('结束录像') : t('录像')
          }}<span v-if="s.recording">{{ duration }}</span></Button
        >
        <span class="control-divider" aria-hidden="true" />
        <Button variant="ghost" class="quiet" :disabled="disabled" @click="control.input({ kind: 'rotate' })"
          ><RotateCw aria-hidden="true" />{{ t('旋转') }}</Button
        >
        <Button variant="ghost" class="quiet" :disabled="disabled" @click="dialog = 'text'"
          ><Keyboard aria-hidden="true" />{{ t('输入文本') }}</Button
        >
        <div class="control-toolbar-end">
          <AppSelect
            id="control-quality"
            v-model="quality"
            :options="qualities"
            :disabled="s.loading || s.busy || s.recording"
            :aria-label="t('画面清晰度')"
          />
          <Button
            variant="ghost"
            class="quiet icon-button"
            :disabled="s.loading || s.busy || !w.online.value"
            :title="t('重新连接')"
            :aria-label="t('重新连接')"
            @click="control.reconnect()"
            ><RefreshCw aria-hidden="true"
          /></Button>
          <DropdownMenuRoot
            ><DropdownMenuTrigger as-child
              ><Button variant="ghost" class="quiet" :disabled="disabled"
                ><Power aria-hidden="true" />{{ t('电源')
                }}<ChevronDown aria-hidden="true" /></Button></DropdownMenuTrigger
            ><DropdownMenuPortal
              ><DropdownMenuContent class="device-context-menu app-action-menu" align="end" :side-offset="5"
                ><DropdownMenuItem @select="control.key(26)"
                  ><Power aria-hidden="true" />{{ t('锁屏或唤醒') }}</DropdownMenuItem
                ><DropdownMenuItem @select="dialog = 'reboot'"
                  ><RefreshCw aria-hidden="true" />{{ t('重启设备') }}</DropdownMenuItem
                ><DropdownMenuItem class="destructive" @select="dialog = 'shutdown'"
                  ><Power aria-hidden="true" />{{ t('关闭设备') }}</DropdownMenuItem
                ></DropdownMenuContent
              ></DropdownMenuPortal
            ></DropdownMenuRoot
          >
        </div>
      </div>
    </div>
    <div
      v-if="s.error || s.notice"
      :class="['control-notice', { error: !!s.error }]"
      :role="s.error ? 'alert' : 'status'"
    >
      <span>{{ s.error || s.notice }}</span
      ><Button
        variant="ghost"
        class="icon-button"
        :aria-label="t('关闭提示')"
        @click="
          s.error = '';
          s.notice = '';
        "
        ><X aria-hidden="true"
      /></Button>
    </div>
    <div class="control-stage-wrap">
      <!-- 纹理只装饰投屏工作区，不拦截操作，也不参与画面尺寸计算。 -->
      <svg class="control-stage-grid" aria-hidden="true" focusable="false">
        <defs>
          <pattern id="control-stage-grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M 32 0.5 H 0.5 V 32" fill="none" stroke="currentColor" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#control-stage-grid)" />
      </svg>
      <div ref="stage" class="control-stage">
        <canvas
          :draggable="false"
          @mousedown.prevent
          ref="canvas"
          :style="frameStyle"
          :class="{ 'control-canvas-ready': s.ready }"
          tabindex="0"
          :aria-label="t('设备画面，点击控制，拖动滑动')"
          @pointerdown="touch($event, 0)"
          @pointermove="touch($event, 2)"
          @pointerup="touch($event, 1)"
          @pointercancel="touch($event, 3)"
          @lostpointercapture="release"
          @contextmenu.prevent="control.key(4)"
          @wheel="wheel"
          @keydown="keyboard($event, 0)"
          @keyup="keyboard($event, 1)"
          @blur="release"
        />
        <div v-if="!s.ready" class="control-empty">
          <LoaderCircle v-if="s.loading" class="spin" aria-hidden="true" /><MonitorPlay
            v-else
            aria-hidden="true"
          />
          <p>
            {{
              !w.online.value
                ? t('请选择已连接的设备')
                : s.loading
                  ? t('正在连接设备画面…')
                  : t('设备画面未连接')
            }}
          </p>
          <Button v-if="w.online.value && !s.loading" variant="outline" @click="control.reconnect()">{{
            t('重新连接')
          }}</Button>
        </div>
      </div>
    </div>
    <footer class="control-navigation">
      <div class="control-navigation-buttons">
        <Button
          variant="ghost"
          class="quiet"
          :disabled="disabled"
          :title="t('返回')"
          :aria-label="t('返回')"
          @click="control.key(4)"
          ><ArrowLeft aria-hidden="true" /></Button
        ><Button
          variant="ghost"
          class="quiet"
          :disabled="disabled"
          :title="t('主页')"
          :aria-label="t('主页')"
          @click="control.key(3)"
          ><House aria-hidden="true" /></Button
        ><Button
          variant="ghost"
          class="quiet"
          :disabled="disabled"
          :title="t('最近任务')"
          :aria-label="t('最近任务')"
          @click="control.key(187)"
          ><PanelsTopLeft aria-hidden="true" /></Button
        ><span class="control-divider" aria-hidden="true" /><Button
          variant="ghost"
          class="quiet"
          :disabled="disabled"
          :title="t('降低音量')"
          :aria-label="t('降低音量')"
          @click="control.key(25)"
          ><Volume1 aria-hidden="true" /></Button
        ><Button
          variant="ghost"
          class="quiet"
          :disabled="disabled"
          :title="t('提高音量')"
          :aria-label="t('提高音量')"
          @click="control.key(24)"
          ><Volume2 aria-hidden="true"
        /></Button>
      </div>
      <span class="control-hint">{{ t('点击操作，拖动滑动，右键返回') }}</span>
    </footer>
    <AppDialog
      v-if="dialog"
      :title="dialog === 'text' ? t('输入文本') : dialog === 'reboot' ? t('重启设备') : t('关闭设备')"
      :content-class="dialog === 'text' ? undefined : 'confirm-dialog'"
      @close="dialog = undefined"
      ><form @submit.prevent="confirm">
        <div class="dialog-body dialog-stack">
          <DialogDeviceTarget :name="w.title.value" :serial="w.device.value?.serial" />
          <template v-if="dialog === 'text'">
            <label class="field"
              >{{ t('输入文本') }}
              <textarea
                v-model="text"
                class="control-text"
                maxlength="1000"
                autofocus
                :aria-label="t('输入文本')"
              />
            </label>
            <p class="field-hint">{{ t('将文本粘贴到设备当前输入框，会替换设备剪贴板。') }}</p></template
          ><template v-else
            ><p class="dialog-message">
              {{
                dialog === 'reboot'
                  ? t('将重启此设备，当前连接和未保存的操作会中断。')
                  : t('将关闭此设备，之后需要手动开机才能重新连接。')
              }}
            </p></template
          >
        </div>
        <footer class="dialog-footer">
          <Button type="button" variant="outline" @click="dialog = undefined">{{ t('取消') }}</Button
          ><Button
            type="submit"
            :disabled="dialog === 'text' && !text"
            :class="dialog === 'shutdown' ? 'destructive' : 'primary'"
            >{{ dialog === 'text' ? t('发送') : dialog === 'reboot' ? t('重启设备') : t('关闭设备') }}</Button
          >
        </footer>
      </form></AppDialog
    >
  </div>
</template>
