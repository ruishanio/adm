<script setup lang="ts">
import { computed } from 'vue';
import { Cable, Monitor, Network } from '@lucide/vue';
import type { Device } from '@/shared/api/types';

const props = defineProps<{ device: Device }>();
// 与设备连接方式的文字判定一致；网络调试不一定经过 Wi-Fi，因此使用通用网络图标。
const icon = computed(() =>
  props.device.network ? Network : props.device.serial.startsWith('emulator-') ? Monitor : Cable,
);
</script>

<template>
  <component :is="icon" aria-hidden="true" />
</template>
