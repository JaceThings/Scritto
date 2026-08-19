---
"@scritto/core": minor
"@scritto/react": minor
"@scritto/vue": minor
"@scritto/solid": minor
"@scritto/svelte": minor
---

Remove the `hurry` option. It sped outgoing glyphs up 2.5× per overlapping change, capped at 6×, to stop a rapidly-changing value stacking ghosts. Measured across every one of the site's own readout presets it changed the stack depth at none of them — pacing the updates had already prevented the pile-up — and it only did anything when the roll ran several times longer than the gap between updates, which is a misconfiguration with a better answer: a shorter roll. What it did reliably was cause its own bugs, whisking glyphs off screen that had never been visible and making a dragged readout pop instead of roll. Anything passing `hurry` can drop it; nothing else changes.
