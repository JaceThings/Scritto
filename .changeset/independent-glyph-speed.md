---
"@scritto/core": patch
---

Let a glyph that survives an update keep its own roll. Committing a value cancelled the animations on all of its glyphs, including the ones that had not changed, so a leading digit's entrance was cut short the moment a trailing digit ticked — on a counter at 90ms intervals with a 590ms roll the leading digit got 93ms of it, which read as the high-order digits animating faster than the low ones. It now runs the full duration.
