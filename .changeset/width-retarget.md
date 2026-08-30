---
"@scritto/core": patch
---

Retarget a width transition in flight instead of finishing it to the old width and snapping. The box is pinned by the running animation, so reading it as the new value's width came back equal to where it started; the content's own width is summed from its sections now, and a different one lands the box and starts again from the width it had reached. And the host refuses to flex-shrink for the length of a transition: a container the content overflows would otherwise take back the edge mask's slack on the way up and pin the box to its own edge on the way down, leaving the value half a slack off centre until the end. Clicking through the playground's Words preset at a normal pace snapped the whole value 31px in a frame before; the kept ink now moves at most 2.3px between frames. `i` to the basmala and back settles at the same millisecond as an engine with no width transition at all.
