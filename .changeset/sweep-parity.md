---
"@scritto/core": patch
---

Sweep a roll's stagger over where its glyphs start rather than how far they reach, ending one step short, and sweep what is arriving separately from what is leaving. Measuring to the far edge handed a narrow last glyph — a comma, a `1` — a longer wait than its share, and sweeping both directions together meant the first glyph to leave was not always the one that started at zero. An exit waiting out its delay sits at full opacity, so both showed up as outgoing ink that lingered brighter and longer than it should. Against the upstream this forked, at a 20ms cadence on a 590ms roll: mean exit delay 46.5ms against upstream's 38.4ms before, 38.6ms after; a departing glyph's life 643ms before, 635ms against upstream's 636ms after; and the ghost alpha on screen now matches to within a hundredth.
