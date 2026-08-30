---
"@scritto/core": patch
---

Sweep the roll's stagger by position over the changed stretch rather than by index, so an old glyph and the new one under it fade together; let a centred or end-aligned host's row turn in place while its box resizes around it, measuring a kept run's travel from the box's anchor and clipping a moving edge only when a neighbour is within reach; keep exiting glyphs clipped when old glyphs reach past a followed host; and stop the exit mask dropping exiting glyphs below the baseline.
