# Timing

## The default roll

550ms, on a spring written as a CSS `linear()` easing:

```
linear(0,.1052,.3155,.532,.7112,.8414,.9265,.9765,1.0023,1.013,1.0151,
       1.0133,1.01,1.0068,1.0041,1.0022,1.001,1)
```

It crosses its target at roughly 55% of the way through and settles back from a 1.5% overshoot. That overshoot is the whole character of the motion: a glyph arrives, goes a hair too far, and comes back. Take it out and the roll reads as a fade with extra steps.

The bouncy preset is the same shape with more of it — a 4.5% overshoot, same duration — and is the `bounce: true` option.

## What a duration actually buys

`transition.duration` is the duration of one glyph's animation, not of the whole change. The last glyph starts late, so the transition as a whole runs longer:

| change | duration | last glyph starts | whole change |
| --- | --- | --- | --- |
| `9` → `10` | 400ms | 60ms | 460ms |
| `99` → `100` | 400ms | 80ms | 480ms |
| `Draft` → `Published` | 400ms | 104ms | 504ms |
| `1` → `1,000,000` | 400ms | 102ms | 502ms |

If you need the true end — to chain something after it, or to hold a frame — read it off the animations rather than adding numbers by hand. Every animation the element owns is reachable through its shadow root, and the largest `endTime` among them is the answer.

## The stagger

`stagger` is 0.3, meaning the wave of delays spans at most 30% of the duration. The delay a glyph gets comes from where it sits along the changed stretch, not from its index, so a glyph leaving and the glyph replacing it move together.

Normalising over the changed stretch rather than the whole value keeps a small edit lively inside a long value. `2 minutes 12 seconds` → `2 minutes 13 seconds` changes one glyph, and that glyph uses the whole duration rather than a thirtieth of it.

### A transition that cannot finish

The width transition is held apart from the animations a commit cancels. Every update cancels those, but a width transition already heading for a target is left alone rather than restarted, and `_clearWidth` keeps its hands off the box while one is in flight. Tearing it down mid-flight and re-arming it from whatever width it had reached, with its indent compensation recomputed against a box that was itself moving, is what a faster-than-the-roll cadence would otherwise do: the box stays blockified and start-aligned, so the value sits left of the centre it's supposed to hold and outgoing ink spreads into the slack. Left alone, a real width change still animates exactly as before — the indent travels its full distance and the box its full slack, regardless of cadence.

Two more things a pinned box needs. A value that wants a *different* width while a transition is in flight can't be read off the box, which is pinned somewhere on its way to the old one — reading it would return the start width and the transition would finish to the old width and snap. The content's own width is summed from its sections instead, and if it differs from the box's the box is landed first and the new transition starts from the width it had reached. And for the length of a transition the host refuses to flex-shrink: a container the content overflows would otherwise take back the mask's slack on the way up and pin the box to its own edge on the way down, while the indent kept decaying under it.

## The box

The width and the indent that goes with it use `cubic-bezier(0.22, 1, 0.36, 1)`, deliberately not the roll's spring. Everything displaced by the host's edge — the words after it, the row it sits in, the old glyphs riding the same shift — is on that curve. A spring here would overshoot the layout, and a kept run would outrun the shrink and have to come back.

## Rapid changes

A roll is left running when the next update lands. That is on purpose: a digit halfway out of a counter that ticks faster than its own duration finishes leaving rather than popping, and the churn harness asserts it.

The cost is that outgoing values stack. Change a value faster than its own duration and you get several ghosts over each other, each individually legible and collectively a smear.

The fix is the duration, not a shortcut. Keep a roll no longer than a few times the gap between the updates driving it and nothing piles up: the site's own readout rolls every step of a drag with a 300ms roll and never gets past one glyph in a slot. A glyph's last stagger delay plus its duration is how long it lives, and dividing that by the update gap is how many are on screen at once — the smaller that number, the shorter the roll needs to be for the update cadence driving it.

There is no option to speed outgoing ink up to clear a pile faster; a roll sized to its update cadence needs none. Speeding up outgoing ink independently of the roll duration causes its own bugs — glyphs whisked off screen having never been visible, and a rapidly-updating readout popping instead of rolling.

A glyph that survives an update keeps its own roll: committing a new value only cancels the animations on the glyphs that actually changed, so a leading digit's entrance runs its full duration even while a trailing digit ticks beside it.

## Reduced motion

`respectMotionPreference` is on by default: with `prefers-reduced-motion: reduce` the element renders the new value without animating. An element that is offscreen also renders instantly rather than animating where nobody is looking.
