---
"@scritto/core": minor
"@scritto/react": minor
"@scritto/solid": minor
"@scritto/svelte": minor
"@scritto/vue": minor
---

Add the `wave` option: the new glyphs carry whatever the change displaces (the host's edge, kept runs, the words after it in a flow), so neighbours wait for them to land and ride in behind, and a paragraph reflows a line at a time. Off by default.

Fix the roll's stagger to sweep by position rather than index, so an old glyph and the new one under it fade together; let a centred or end-aligned host's row turn in place while its box resizes around it, clipping whichever edges move; keep exiting glyphs clipped whenever a word follows the host; and stop the exit mask dropping exiting glyphs below the baseline.
