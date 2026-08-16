# Scritto

Get it in writing.

A small web component for SwiftUI-style rolling text — numbers and strings.

```bash
npm i @scritto/core
```

```html
<numeric-text></numeric-text>

<script type="module">
  import '@scritto/core'

  const text = document.querySelector('numeric-text')
  text.value = '1,000'
</script>
```

Wrap nearby copy in `<numeric-flow>` so words slide and rewrap as the value changes width:

```html
<numeric-flow>
  Used <numeric-text></numeric-text> billion tokens this month.
</numeric-flow>
```

Wrappers: `@scritto/react`, `@scritto/vue`, `@scritto/svelte`, `@scritto/solid`.

```tsx
import NumericText from '@scritto/react'

<NumericText value="1,000" />
```

## API

| Prop                      | Type               | Default                            | Description                                                                                                    |
| :------------------------ | :----------------- | :--------------------------------- | :------------------------------------------------------------------------------------------------------------- |
| `value`                   | `string \| number` | `""`                               | The text or number to display.                                                                                 |
| `animated`                | `boolean`          | `true`                             | (Wrappers only) Whether to animate changes. For Vanilla JS, use `text.update(val, false)` for instant updates. |
| `trend`                   | `1 \| 0 \| -1`     | `0`                                | Animation direction (1: up, -1: down, 0: auto-detect based on numbers).                                        |
| `transition`              | `Transition`       | `{ duration: 550, easing: '...' }` | Custom duration and easing function.                                                                           |
| `respectMotionPreference` | `boolean`          | `true`                             | If true, disables animation for users with `prefers-reduced-motion`.                                           |

The value stays one inline unit and does not wrap. Surrounding text wraps around its changing width. Characters render in their own spans, so ligatures and kerning are not supported.

Site: [scrit.to](https://scrit.to)

Based on [numeric-text](https://github.com/shizukushq/numeric-text) by shizukushq (MIT).
