<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { AppWindow } from '@lucide/vue';
const props = defineProps<{ src?: string | null; cacheKey: string }>();
const emit = defineEmits<{ visible: [] }>();
const element = ref<HTMLElement>();
const failed = ref(false);
let observer: IntersectionObserver | undefined,
  visible = false;
watch(
  () => [props.cacheKey, props.src],
  () => {
    failed.value = false;
    if (visible && props.src === undefined) emit('visible');
  },
);
onMounted(() => {
  observer = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible) emit('visible');
    },
    { root: element.value?.closest('.apps-scroll'), rootMargin: '80px' },
  );
  if (element.value) observer.observe(element.value);
});
onBeforeUnmount(() => observer?.disconnect());
</script>
<template>
  <span ref="element" class="installed-app-icon" aria-hidden="true">
    <img v-if="src && !failed" :src="src" alt="" draggable="false" @error="failed = true" />
    <AppWindow v-else class="icon-apps" />
  </span>
</template>
