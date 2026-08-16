<script lang="ts" setup>
import '@scritto/core';
import { type ScrittoProps, type Scritto as ScrittoElement, type Value, BROWSER } from '@scritto/core';
import { onMounted, ref, watch } from 'vue';

interface Props extends /* @vue-ignore */ ScrittoProps {
  value: Value;
}

const props = withDefaults(defineProps<Props>(), {
  animated: true,
});

const el = ref<ScrittoElement>();
let isMounted = false;

watch(
  () => props.value,
  (newValue) => {
    if (el.value) {
      el.value.update(newValue, isMounted && props.animated);
    }
  },
);

watch(
  () => [props.trend, props.transition, props.respectMotionPreference],
  () => {
    if (el.value) {
      el.value.setOptions({
        trend: props.trend,
        transition: props.transition,
        respectMotionPreference: props.respectMotionPreference,
      });
    }
  },
  { deep: true },
);

onMounted(() => {
  if (el.value) {
    el.value.setOptions({
      trend: props.trend,
      transition: props.transition,
      respectMotionPreference: props.respectMotionPreference,
    });

    el.value.update(props.value, false);
  }
  isMounted = true;
});
</script>

<template>
  <scritto-text
    ref="el"
    v-bind="$attrs"
    role="img"
    :aria-label="(value ?? '') + ''"
    v-html="BROWSER ? '' : (value ?? '') + ''"
  />
</template>
