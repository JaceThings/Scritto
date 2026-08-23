<div align="center">

<h1>Scritto</h1>

SwiftUI-style rolling text for the web. Numbers and strings — the prefix stays, the middle rolls.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE) [![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)

**[scrit.to](https://scrit.to)**

</div>

## What it is

Most web number animations only handle digits. SwiftUI’s `.numericText` morphs any string — a status, a price, a label — and keeps the letters that stay put.

Scritto does that on the web. It diffs the old value against the new one, holds the shared prefix and suffix, and rolls the middle. Nearby words can slide and rewrap as the value changes width.

## Quick start

### Vanilla

```sh
npm install @scritto/core
```

```html
<scritto-text></scritto-text>

<script type="module">
  import "@scritto/core";

  const text = document.querySelector("scritto-text");
  text.value = "1,000";
</script>
```

Wrap nearby copy in `<scritto-flow>` so words slide and rewrap with the value:

```html
<scritto-flow>
  Used <scritto-text></scritto-text> billion tokens this month.
</scritto-flow>
```

### React

```sh
npm install @scritto/react
```

```tsx
import Scritto from "@scritto/react";

<Scritto value="1,000" />
```

### Vue

```sh
npm install @scritto/vue
```

```vue
<script setup>
import Scritto from "@scritto/vue";
</script>

<template>
  <Scritto value="1,000" />
</template>
```

### Svelte

```sh
npm install @scritto/svelte
```

```svelte
<script>
  import Scritto from "@scritto/svelte";
</script>

<Scritto value="1,000" />
```

### Solid

```sh
npm install @scritto/solid
```

```tsx
import Scritto from "@scritto/solid";

<Scritto value="1,000" />
```

Every framework package re-exports the core types and depends on `@scritto/core`, so you do not install it separately.

## Packages

| Package | npm | Description |
|---|---|---|
| `@scritto/core` | [![npm](https://img.shields.io/npm/v/%40scritto%2Fcore?label=)](https://www.npmjs.com/package/@scritto/core) | Framework-agnostic web component |
| `@scritto/react` | [![npm](https://img.shields.io/npm/v/%40scritto%2Freact?label=)](https://www.npmjs.com/package/@scritto/react) | React component |
| `@scritto/vue` | [![npm](https://img.shields.io/npm/v/%40scritto%2Fvue?label=)](https://www.npmjs.com/package/@scritto/vue) | Vue component |
| `@scritto/svelte` | [![npm](https://img.shields.io/npm/v/%40scritto%2Fsvelte?label=)](https://www.npmjs.com/package/@scritto/svelte) | Svelte component |
| `@scritto/solid` | [![npm](https://img.shields.io/npm/v/%40scritto%2Fsolid?label=)](https://www.npmjs.com/package/@scritto/solid) | Solid component |

## Features

- Numbers and arbitrary strings, not just digits
- LCP diffing: prefix and suffix stay put, the middle rolls
- `<scritto-flow>` slides nearby words when the value changes width
- Per-character enter/exit with stagger, blur, and trend
- Optional `bounce` adds a little overshoot on each letter
- RTL via `Intl.Segmenter`
- `prefers-reduced-motion` respected by default
- Zero runtime dependencies, SSR-safe, `role="img"` + `aria-label`

The value stays one inline unit and does not wrap. Characters render in their own spans, so ligatures and kerning are not supported.

## Contributing

Issues and PRs welcome.

## License

[MIT](./LICENSE)

## Docs

[`docs/`](docs/) has the long version: [how the roll works](docs/how-it-works.md), [what SwiftUI does](docs/what-apple-does.md) and the two places we differ, [sixty-five measured cases](docs/cases.md), [timing](docs/timing.md), [flow](docs/flow.md), [edges](docs/masking.md), the [API](docs/api.md) and [testing](docs/testing.md).

Based on [numeric-text](https://github.com/shizukushq/numeric-text) by shizukushq (MIT).

---

<div align="center">

Built by [Jace](https://ja.mt)

[X](https://ja.mt/x) | [Bluesky](https://ja.mt/bsky) | [Instagram](https://ja.mt/ig) | [Threads](https://ja.mt/threads)

</div>
