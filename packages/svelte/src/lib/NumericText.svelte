<script lang="ts">
  import '@scritto/core';
  import { type NumericTextProps, type NumericText as NumericTextElement, BROWSER } from '@scritto/core';
  import type { HTMLAttributes } from 'svelte/elements';
  import { onMount, untrack } from 'svelte';

  const {
    value,
    trend,
    transition,
    respectMotionPreference,
    animated = true,
    ...rest
  }: NumericTextProps & HTMLAttributes<HTMLElement> = $props();

  let text = $state<NumericTextElement>()!;
  let isMounted = false;

  $effect(() => {
    text.update(
      value,
      untrack(() => isMounted && animated),
    );
  });

  $effect(() => {
    text.setOptions({ trend, transition, respectMotionPreference });
  });

  onMount(() => {
    isMounted = true;
  });
</script>

<numeric-text bind:this={text} role="img" aria-label={value} {...rest}>
  {BROWSER ? '' : value}
</numeric-text>
