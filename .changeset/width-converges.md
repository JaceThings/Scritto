---
"@scritto/core": patch
---

Let a width transition finish instead of restarting it on every update. It was cancelled along with the rest of a commit's animations and re-armed from whatever width it had reached, with its indent compensation recomputed against a box that was already moving, so at a cadence faster than the roll it never converged: the box stayed blockified and start-aligned, the value sat left of the centre it should hold, and outgoing ink spread into the slack. At a 20ms cadence on a 590ms roll that was 144.6px of ink spread against upstream's 111.6px, and 53px off centre against 31px; now 111.8px and 30.4px. A transition already heading for a width is left alone, and the box's styles are not cleared while one is in flight. A real width change animates exactly as before.
