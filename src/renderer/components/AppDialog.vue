<script setup lang="ts">
import { t } from '../../shared/i18n';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { X } from '@lucide/vue';
const props = defineProps<{
  title: string;
  busy?: boolean;
  description?: string;
  contentClass?: string;
  returnFocus?: HTMLElement;
}>();
// 弹窗由工作台状态打开，没有 DialogTrigger 时显式恢复原焦点；菜单可传入稳定的行节点。
const previousFocus =
  props.returnFocus || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
function restoreFocus(event: Event) {
  event.preventDefault();
  if (previousFocus?.isConnected) previousFocus.focus();
}
const emit = defineEmits<{ close: [] }>();
function close() {
  if (!props.busy) emit('close');
}
</script>
<template>
  <Dialog
    :open="true"
    @update:open="
      (value) => {
        if (!value) close();
      }
    "
  >
    <DialogContent
      class="dialog"
      :class="contentClass"
      @close-auto-focus="restoreFocus"
      :show-close-button="false"
      @escape-key-down="
        (e) => {
          if (busy) e.preventDefault();
        }
      "
      @interact-outside="(e) => e.preventDefault()"
    >
      <header class="dialog-header">
        <DialogTitle>{{ title }}</DialogTitle
        ><Button
          variant="ghost"
          class="icon-button"
          :aria-label="t('关闭对话框')"
          :disabled="busy"
          @click="close"
          ><X aria-hidden="true"
        /></Button>
      </header>
      <DialogDescription class="sr-only">{{ description || title }}</DialogDescription>
      <slot />
    </DialogContent>
  </Dialog>
</template>
