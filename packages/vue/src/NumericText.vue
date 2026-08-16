<script lang="ts" setup>
import '@scritto/core';
import { type NumericTextProps, type NumericText as NumericTextElement, type Value, BROWSER } from '@scritto/core';
import { onMounted, ref, watch } from 'vue';

interface Props extends /* @vue-ignore */ NumericTextProps {
  value: Value;
}

const props = withDefaults(defineProps<Props>(), {
  animated: true,
});

const el = ref<NumericTextElement>();
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
  <!-- @vue-expect-error types... -->
  <numeric-text
    ref="el"
    v-bind="$attrs"
    role="img"
    :aria-label="(value ?? '') + ''"
    v-html="BROWSER ? '' : (value ?? '') + ''"
  />
</template>
