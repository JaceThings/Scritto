# API

## `<scritto-text>`

```html
<scritto-text id="count">0</scritto-text>
```

```js
const el = document.querySelector('#count')
el.value = '1'            // rolls
el.update('2', false)     // sets it without rolling
el.setOptions({ trend: 1, transition: { duration: 300 } })
```

`value` and `update(next, animated = true)` are the same thing; the property
setter is the non-animating form's shorthand for `update(next, false)`.

Text content inside the tag is the server-rendered value. Import
`@scritto/core/ssr.css` if the element has to look right before its script runs.

### Options

| option | default | what it does |
| --- | --- | --- |
| `transition` | `{ duration: 550, easing: <spring> }` | one glyph's animation |
| `trend` | `0` | `1` up, `-1` down, `0` reads it off the value |
| `bounce` | `false` | swaps the spring for the bouncier preset |
| `respectMotionPreference` | `true` | honour `prefers-reduced-motion` |

`trend: 0` compares every number in the two values and lets the first one that
differs decide. Values that gain or lose a number read as a rise.

### Events

`scrittochange` fires twice per update, `detail.phase` being `before` then
`after`, with `detail.animate` saying whether this one is rolling. It bubbles,
which is how `<scritto-flow>` hears about its own hosts.

## `<scritto-flow>`

Wraps a line so the words beside a value move with it. No options; see
[flow.md](flow.md).

## Framework packages

`@scritto/react`, `@scritto/vue`, `@scritto/svelte`, `@scritto/solid`. Each is a
thin wrapper over the element — under a kilobyte gzipped — taking the same
options as props plus `value` and `animated`.

```jsx
<Scritto value={count} trend={1} transition={{ duration: 300 }} />
```

They bring `@scritto/core` with them; installing both is only necessary if you
also use the element directly.
