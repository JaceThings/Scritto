# @scritto/svelte

## 0.2.0

### Minor Changes

- 262c0fb: Fade a travelling edge only where its ghosts have somewhere to escape to. The band arms when leaving ink would reach a neighbour on the line or leave the box a reader sees as holding the value, which is what a card, a pill or a tight container creates. A value with room around it is left alone and its ghosts dissolve on their own opacity, keeping their shape instead of being eaten unevenly by a gradient. The room is measured while the layout is still at rest, since a container that hugs the value moves with it. New `edgeFade` option takes `auto`, `always` or `never`.
- 262c0fb: Remove the `hurry` option. It sped outgoing glyphs up 2.5× per overlapping change, capped at 6×, to stop a rapidly-changing value stacking ghosts. Measured across every one of the site's own readout presets it changed the stack depth at none of them — pacing the updates had already prevented the pile-up — and it only did anything when the roll ran several times longer than the gap between updates, which is a misconfiguration with a better answer: a shorter roll. What it did reliably was cause its own bugs, whisking glyphs off screen that had never been visible and making a dragged readout pop instead of roll. Anything passing `hurry` can drop it; nothing else changes.

### Patch Changes

- Updated dependencies [262c0fb]
- Updated dependencies [262c0fb]
- Updated dependencies [262c0fb]
- Updated dependencies [262c0fb]
- Updated dependencies [262c0fb]
- Updated dependencies [262c0fb]
- Updated dependencies [262c0fb]
  - @scritto/core@0.2.0
