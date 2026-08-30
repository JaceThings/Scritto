<div align="center">

<img src="assets/icon.png" alt="" width="128" height="128" />

<h1>Scritto</h1>

Give it a new value and the text rolls to it. Whatever didn't change stays exactly where it was.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE) [![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)

**[scrit.to](https://scrit.to)**

</div>

```sh
npm install @scritto/core
```

```html
<scritto-text id="count">0</scritto-text>

<script type="module">
  import "@scritto/core";

  const el = document.querySelector("#count");
  let n = 0;
  setInterval(() => el.update(String(++n)), 1000);
</script>
```

That is the whole thing. `update()` rolls; assigning `.value` sets the text with no motion, which is what you want for the first value.

## What it is

Most web number animations only handle digits. SwiftUI's `.numericText` morphs any string, a status or a price or a label, and keeps the letters that stay put. Scritto does that on the web: it diffs the old value against the new one, holds the glyphs that survive, slides them to where they now belong, and rolls the rest out while their replacements roll in. Wrap the line in `<scritto-flow>` and the words beside the value move on the same clock instead of jumping when the browser reflows.

**Every glyph renders in its own span, which is the price of the whole effect.** Nothing can slide independently unless it is its own box, so ligatures and kerning do not apply to a value while Scritto owns it, and the value is one non-wrapping inline unit. If you need a paragraph of text to reflow, this is the wrong tool; if you need a number, a price, a status or a short label to change without the eye losing it, this is exactly the tool.

## Quick start

### Vanilla

```html
<scritto-text></scritto-text>

<script type="module">
  import "@scritto/core";

  const text = document.querySelector("scritto-text");
  text.update("1,000"); // rolls. Assign .value instead to set it without motion
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

Sizes are gzipped and measured by `bun run size` against the built output, not estimated.

| Package | npm | Size | Description |
|---|---|---|---|
| `@scritto/core` | [![npm](https://img.shields.io/npm/v/%40scritto%2Fcore?label=)](https://www.npmjs.com/package/@scritto/core) | 9.92 KB | Framework-agnostic web component |
| `@scritto/react` | [![npm](https://img.shields.io/npm/v/%40scritto%2Freact?label=)](https://www.npmjs.com/package/@scritto/react) | 0.57 KB | React component |
| `@scritto/vue` | [![npm](https://img.shields.io/npm/v/%40scritto%2Fvue?label=)](https://www.npmjs.com/package/@scritto/vue) | 0.67 KB | Vue component |
| `@scritto/svelte` | [![npm](https://img.shields.io/npm/v/%40scritto%2Fsvelte?label=)](https://www.npmjs.com/package/@scritto/svelte) | 0.49 KB | Svelte component |
| `@scritto/solid` | [![npm](https://img.shields.io/npm/v/%40scritto%2Fsolid?label=)](https://www.npmjs.com/package/@scritto/solid) | 0.64 KB | Solid component |

A wrapper is a thin binding over the element, so the core is what you are actually paying for. Zero runtime dependencies.

## What it does

- Numbers and arbitrary strings, not just digits
- Keeps a shared prefix, a shared suffix, and a run flush with neither end, the last of which SwiftUI does not do
- `<scritto-flow>` slides and rewraps the words beside a value when it changes width
- Per-glyph enter and exit with stagger, blur, scale and trend; `bounce` adds overshoot
- Ghosts fade at an edge only where they would hit a neighbour or leave their container, so text with room around it keeps its shape (`edgeFade` overrides it)
- Graphemes rather than code points, so emoji, ZWJ sequences, combining marks, CJK and RTL survive intact
- SSR-safe, `prefers-reduced-motion` honoured by default, and the value kept readable by assistive tech: the element carries it as a plain text node in the light DOM with every animated glyph `aria-hidden`, and the React, Vue and Solid wrappers also set `role="img"` with an `aria-label`

It needs `Intl.Segmenter`, the Web Animations API, CSS masks and `linear()` easing, and polyfills none of them.

## What it does not do

**Ligatures and kerning are off inside a value.** Every glyph is its own span, which is what lets one slide while its neighbour stays. There is no version of this that keeps both.

**A value never wraps.** The host is `white-space: nowrap` and ordinary spaces become non-breaking, so a long value runs past a narrow container rather than breaking across lines. That is deliberate, because a value that rewraps mid-roll is unreadable, but it means you size the container rather than the value.

**Updating faster than the roll stacks ghosts.** An outgoing glyph is never cancelled by the next update, because a digit that pops out of existence halfway through reads worse than one that finishes leaving. Change a value several times inside one roll duration and you get several outgoing copies over each other. The fix is a duration shorter than the gap between your updates, not a shortcut that speeds the pile away.

**Interrupting a `<scritto-flow>` word mid-wrap looks wrong for a few frames.** A word changing line is drawn by two ghosts while its real box sits hidden at the destination, measured 30–34px from where the reader sees it. Interrupt that and the slide restarts from a place nothing was drawn. It settles correctly and leaves nothing behind; it is a known rough edge, not a leak.

**An embedded flow needs 16px of gutter.** The edge fade needs one rem to finish. A container that gives it less and hides its overflow cuts the fade off partway and leaves exactly the hard edge the mask exists to avoid.

## Contributing

Issues and PRs welcome.

## License

[MIT](./LICENSE)

## Docs

The [wiki](https://github.com/JaceThings/Scritto/wiki) has the rest. Start with [recipes](https://github.com/JaceThings/Scritto/wiki/Recipes) for working code by task, or the [glossary](https://github.com/JaceThings/Scritto/wiki/Glossary) if a page uses a word you do not recognise. Then: [how the roll works](https://github.com/JaceThings/Scritto/wiki/How-the-Roll-Works), [what SwiftUI does](https://github.com/JaceThings/Scritto/wiki/What-SwiftUI-Does) and the two places we differ, [sixty-five measured cases](https://github.com/JaceThings/Scritto/wiki/Measured-Cases), [timing](https://github.com/JaceThings/Scritto/wiki/Timing), [flow](https://github.com/JaceThings/Scritto/wiki/Flow), [edges](https://github.com/JaceThings/Scritto/wiki/Edges), the [API](https://github.com/JaceThings/Scritto/wiki/API) and [testing](https://github.com/JaceThings/Scritto/wiki/Testing).

Based on [numeric-text](https://github.com/shizukushq/numeric-text) by shizukushq (MIT).

---

<div align="center">

Built by [Jace](https://ja.mt)

[X](https://ja.mt/x) | [Bluesky](https://ja.mt/bsky) | [Instagram](https://ja.mt/ig) | [Threads](https://ja.mt/threads)

</div>
