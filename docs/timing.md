# Timing

## The default roll

550ms, on a spring written as a CSS `linear()` easing:

```
linear(0,.1052,.3155,.532,.7112,.8414,.9265,.9765,1.0023,1.013,1.0151,
       1.0133,1.01,1.0068,1.0041,1.0022,1.001,1)
```

It crosses its target at roughly 55% of the way through and settles back from a
1.5% overshoot. That overshoot is the whole character of the motion: a glyph
arrives, goes a hair too far, and comes back. Take it out and the roll reads as
a fade with extra steps.

The bouncy preset is the same shape with more of it — a 4.5% overshoot,
same duration — and is the `bounce: true` option.

## What a duration actually buys

`transition.duration` is the duration of one glyph's animation, not of the whole
change. The last glyph starts late, so the transition as a whole runs longer:

| change | duration | last glyph starts | whole change |
| --- | --- | --- | --- |
| `9` → `10` | 400ms | 60ms | 460ms |
| `99` → `100` | 400ms | 80ms | 480ms |
| `Draft` → `Published` | 400ms | 104ms | 504ms |
| `1` → `1,000,000` | 400ms | 102ms | 502ms |

If you need the true end — to chain something after it, or to hold a frame — read
it off the animations rather than adding numbers by hand. Every animation the
element owns is reachable through its shadow root, and the largest `endTime`
among them is the answer.

## The stagger

`stagger` is 0.3, meaning the wave of delays spans at most 30% of the duration.
The delay a glyph gets comes from where it sits along the changed stretch, not
from its index, so a glyph leaving and the glyph replacing it move together.

Normalising over the changed stretch rather than the whole value keeps a small
edit lively inside a long value. `2 minutes 12 seconds` → `2 minutes 13 seconds`
changes one glyph, and that glyph uses the whole duration rather than a thirtieth
of it.

### A transition that cannot finish

The width transition is held apart from the animations a commit cancels. Every
update cancels those, and the width used to go with them: torn down mid-flight
and re-armed from whatever width it had reached, with its indent compensation
recomputed against a box that was itself moving.

At a cadence slower than the roll that converges anyway. Faster, it never did.
The box stayed blockified and start-aligned, so the value sat left of the centre
it was supposed to hold and outgoing ink spread into the slack. Measured against
upstream, which has no width transition at all, at a 20ms cadence on a 590ms
roll: ink spread 144.6px against 111.6px, and the value sat 53px left of its
stage centre against upstream's 31px.

A transition already heading for a width is now left alone rather than restarted,
and `_clearWidth` keeps its hands off the box while one is in flight. Same
measurement after: 111.8px against 111.6px, and 30.4px against 30.5px. A real
width change still animates exactly as before — the indent still travels its 8px
and the box its 5.59px of slack.

## The box

The width and the indent that goes with it use `cubic-bezier(0.22, 1, 0.36, 1)`,
deliberately not the roll's spring. Everything displaced by the host's edge —
the words after it, the row it sits in, the old glyphs riding the same shift —
is on that curve. A spring here would overshoot the layout, and a kept run would
outrun the shrink and have to come back.

## Rapid changes

A roll is left running when the next update lands. That is on purpose: a digit
halfway out of a counter that ticks faster than its own duration finishes
leaving rather than popping, and the churn harness asserts it.

The cost is that outgoing values stack. Change a value faster than its own
duration and you get several ghosts over each other, each individually legible
and collectively a smear.

The fix is the duration, not a shortcut. Keep a roll no longer than a few times
the gap between the updates driving it and nothing piles up: the site's own
readout rolls every step of a drag with a 300ms roll and never gets past one
glyph in a slot. Stretch that roll to 1600ms against a value every 40ms and the
pile is 60 outgoing values deep, half of them still inked — but that is arithmetic,
not a defect. A glyph's last stagger delay plus its duration is how long it
lives, and dividing that by the update gap is how many are on screen at once.
Upstream measures 55 at those settings. The answer is a shorter roll.

There used to be an option here that sped outgoing ink up 2.5× per change, capped
at 6×, to clear the pile. It is gone, and nothing replaced it. Measured across
every one of the site's readout presets it changed the stack depth at none of
them, because none of them runs a roll long enough to pile up; it only did
anything when the roll ran several times longer than the gap between updates,
which is the misconfiguration above. What it did do reliably was cause its own bugs — glyphs
whisked off screen having never been visible, and a dragged readout popping
instead of rolling.

A glyph that survives an update keeps its own roll. Committing a new value used
to cancel the animations on every glyph in it, including the ones that had not
changed, so a leading digit's entrance died the moment a trailing digit ticked.
On a counter at 90ms intervals with a 590ms roll that left the leading digit 93ms
to do a 590ms job, which is why the high-order digits looked faster than the low
ones. It now runs the full 597ms, matching upstream exactly at a 40ms cadence.

## Reduced motion

`respectMotionPreference` is on by default: with `prefers-reduced-motion: reduce`
the element renders the new value without animating. An element that is offscreen
also renders instantly rather than animating where nobody is looking.
