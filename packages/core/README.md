# @scritto/core

SwiftUI-style rolling text for the web. Numbers and strings. Framework-agnostic, zero runtime dependencies, SSR-safe.

This is the engine. Bindings: [`@scritto/react`](https://www.npmjs.com/package/@scritto/react), [`@scritto/vue`](https://www.npmjs.com/package/@scritto/vue), [`@scritto/svelte`](https://www.npmjs.com/package/@scritto/svelte), [`@scritto/solid`](https://www.npmjs.com/package/@scritto/solid).

## Install

```sh
npm install @scritto/core
```

## Usage

```html
<scritto-text></scritto-text>

<script type="module">
  import "@scritto/core";

  const text = document.querySelector("scritto-text");
  text.value = "1,000";
  text.update("2,000");
</script>
```

```html
<scritto-flow>
  Used <scritto-text></scritto-text> billion tokens this month.
</scritto-flow>
```

See the [root README](https://github.com/JaceThings/Scritto).
