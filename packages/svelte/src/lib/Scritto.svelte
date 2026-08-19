<script lang="ts">
  import '@scritto/core';
  import { type ScrittoProps, type Scritto as ScrittoElement, BROWSER } from '@scritto/core';
  import type { HTMLAttributes } from 'svelte/elements';
  import { onMount, untrack } from 'svelte';

  const {
    value,
    trend,
    transition,
    respectMotionPreference,
    bounce,
    animated = true,
    ...rest
  }: ScrittoProps & HTMLAttributes<HTMLElement> = $props();

  let text = $state<ScrittoElement>()!;
  let isMounted = false;

  $effect(() => {
    text.update(
      value,
      untrack(() => isMounted && animated),
    );
  });

  $effect(() => {
    text.setOptions({ trend, transition, respectMotionPreference, bounce });
  });

  onMount(() => {
    isMounted = true;
  });
</script>

<scritto-text bind:this={text} role="img" aria-label={value} {...rest}>
  {BROWSER ? '' : value}
</scritto-text>
