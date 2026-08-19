---
"@scritto/core": patch
---

Give every glyph its own clock. Committing a value cancelled the animations on all of its glyphs, including the ones that had not changed, so a leading digit's entrance was cut short the moment a trailing digit ticked — on a counter at 90ms intervals with a 590ms roll, the leading digit got 93ms of it. A glyph that survives an update now keeps its own animation and runs the full duration. Separately, `hurry` was scaling every animation on a glyph inside an exit group, including a leftover entrance whose fill the exit reads as its starting point; it now only touches the exit itself, so entrances always play at 1×.
