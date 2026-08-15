# NumericText

[![NPM version](https://badgen.net/npm/v/@numeric-text/core?color=0&labelColor=0)](https://npmjs.com/package/@numeric-text/core)
[![bundle size](https://badgen.net/badge/bundle%20size/2.38KB?color=0&labelColor=0)](https://bundlephobia.com/package/@numeric-text/core)
[![playground](https://badgen.net/badge/p/playground?label=&color=0&labelColor=0)](https://play-numeric-text.pages.dev)

A lightweight, framework-agnostic component for text transitions. As the name suggests, this is a dedicated attempt to replicate the behavior and feel of SwiftUI’s [.numericText](<https://developer.apple.com/documentation/swiftui/contenttransition/numerictext(value:)>) for the web.

## Features

- **Framework-agnostic**: Use it with any framework or just Vanilla JS.
- **Zero Dependencies**: No third-party runtime dependencies.
- **Ultra-Lightweight**: Only **2.38KB** (gzipped) for the core package.
- **High Performance**: Optimized for **120fps** animations.
- **SSR Support**: Works with Server-Side Rendering.
- **A11y**:
  - **Screen Reader Ready**: Fully accessible with `aria-label` and `role="img"`.
  - **Universal**: Supports all languages and character sets via `Intl.Segmenter`.
  - **RTL Support**: Built-in support for Right-to-Left languages like Arabic or Hebrew.
  - **Respects Preferences**: Automatically disables animations for users with `prefers-reduced-motion`.

## Limitations

- The value itself does not wrap: it stays one inline unit. Surrounding text wraps around its changing width.
- No support for ligatures and kerning: Because every character is rendered in its own `<span>`, typographic features such as ligatures and kerning are not supported.

## Installation

```bash
# Core (Vanilla JS)
npm install @numeric-text/core

# Framework Wrappers
npm install @numeric-text/svelte
npm install @numeric-text/solid
npm install @numeric-text/react
npm install @numeric-text/vue
```

## Usage

### Vanilla JS

```html
<numeric-text></numeric-text>

<script type="module">
  import '@numeric-text/core'
  // Using CDN (without bundler):
  // import 'https://esm.sh/@numeric-text/core'

  const text = document.querySelector('numeric-text')
  // set initial value
  text.value = 'text' // or text.update('text', false)
</script>
```

### Svelte

```svelte
<script lang="ts">
  import NumericText from '@numeric-text/svelte'
</script>

<NumericText value="text" />
```

### React/Solid.js

```tsx
import NumericText from '@numeric-text/react'
// or
import NumericText from '@numeric-text/solid'

<NumericText value="text" />
```

### Vue

```vue
<script lang="ts" setup>
import NumericText from '@numeric-text/vue'
</script>

<NumericText value="text" />
```

## API Reference

| Prop                      | Type               | Default                            | Description                                                                                                    |
| :------------------------ | :----------------- | :--------------------------------- | :------------------------------------------------------------------------------------------------------------- |
| `value`                   | `string \| number` | `""`                               | The text or number to display.                                                                                 |
| `animated`                | `boolean`          | `true`                             | (Wrappers only) Whether to animate changes. For Vanilla JS, use `text.update(val, false)` for instant updates. |
| `trend`                   | `1 \| 0 \| -1`     | `0`                                | Animation direction (1: up, -1: down, 0: auto-detect based on numbers).                                        |
| `transition`              | `Transition`       | `{ duration: 550, easing: '...' }` | Custom duration and easing function.                                                                           |
| `respectMotionPreference` | `boolean`          | `true`                             | If true, disables animation for users with `prefers-reduced-motion`.                                           |

## Why?

Ever since SwiftUI introduced `.numericText`, I have been waiting for a similar solution to arrive on the web. It is an ideal way to draw a user's attention to interface changes — be it a status update, a price change, or a counter increment.

<video src="https://github.com/user-attachments/assets/03053492-582e-4947-a330-1af362b161d7" autoplay loop muted playsinline style="max-width: 100%;"></video>

### The Limitations of Existing Solutions

Until now, the closest web alternative was [number-flow](https://number-flow.barvian.me/). While it is visually stunning and elegant, it is strictly limited to animating **numbers**. SwiftUI’s implementation, however, is much more versatile, capable of morphing arbitrary text strings.

Another approach, often referred to as "TextMorph" (popularized by components in [motion-primitives](https://motion-primitives.com/docs/text-morph)), takes a fundamentally different path. To the best of my knowledge, this technique originated in the [Family](https://family.co/) app. It works by assigning unique IDs to every character and animating their individual layout transitions.

<video src="https://github.com/user-attachments/assets/f5a571b3-6b61-4e31-9776-d2f1c9921cb7" autoplay loop muted playsinline style="max-width: 100%;"></video>

However, applying this specific logic to general UI text has significant drawbacks:

- **Visual Chaos**: Characters often fly across the screen in a confusing manner. During the transition from "Creative" to "Craft", letters rearrange: the fourth letter "a" moves to replace the "e", the fifth letter "t" flies to the end of "Craft", etc. It lacks a sense of structural cohesion and feels disjointed.
- **Performance Heavy**: Animating the layout of _every single character_ is expensive on lower-end mobile devices.

It is quite surprising that this "fly-everywhere" logic was so heavily promoted in [@emilkowalski](https://x.com/emilkowalski)'s [animations.dev](https://animations.dev/), considering its impact on text legibility and performance during transitions.

### The NumericText Approach

Driven by the lack of a proper SwiftUI-like alternative, I built `NumericText`. It handles both numbers and text, providing a cohesive feel for text transitions, and achieving a visual fluidity similar to [number-flow](https://number-flow.barvian.me/) when animating numbers.

Under the hood, `NumericText` uses a _LCP_ diffing algorithm. Unlike character-level morphing, this ensures the transition feels grounded and predictable. Letters don't fly randomly, they stay anchored where they belong logically.

<video src="https://github.com/user-attachments/assets/f1234f3e-c336-4eb1-a263-3d47f0560b5c" autoplay loop muted playsinline style="max-width: 100%;"></video>

This diffing logic is nearly identical to the one used in SwiftUI. By dividing the text into three logical sections — we only need to animate the layout transitions of the sections themselves. This approach delivers better performance, especially on low-end mobile devices.

<video src="https://github.com/user-attachments/assets/5f5dd2fb-1876-46b9-b447-61eea59b0c99" autoplay loop muted playsinline style="max-width: 100%;"></video>
