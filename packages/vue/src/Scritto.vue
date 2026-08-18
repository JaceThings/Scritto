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

const applyOptions = () => {
  el.value?.setOptions({
    trend: props.trend,
    transition: props.transition,
    respectMotionPreference: props.respectMotionPreference,
    bounce: props.bounce,
    wave: props.wave,
  });
};

watch(
  () => props.value,
  (newValue) => {
    el.value?.update(newValue, isMounted && props.animated);
  },
);

watch(
  () => [props.trend, props.transition, props.respectMotionPreference, props.bounce, props.wave],
  applyOptions,
  { deep: true },
);

onMounted(() => {
  applyOptions();
  el.value?.update(props.value, false);
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
