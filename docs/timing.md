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

The cost is that outgoing values stack. Spam a card and you get several ghosts
over each other, each individually legible and collectively a smear. `hurry`
speeds the ink already on its way out — 2.5× per change, capped at 6× — so it
keeps rolling but clears the screen sooner.

The newest group is never hurried. It is the one being read, and speeding it up
is what makes a dragged readout pop instead of roll; everything behind it is
already illegible and only wants to get out of the way. Measured on the duration
slider through a fast drag, that takes the readout from 19 half-faded glyphs at
its worst down to 7.

`hurry` is off by default because a value that changes rarely has nothing to
clear. Turn it on for anything that can change faster than its own duration —
a card people click, a readout under a drag.

## Reduced motion

`respectMotionPreference` is on by default: with `prefers-reduced-motion: reduce`
the element renders the new value without animating. An element that is offscreen
also renders instantly rather than animating where nobody is looking.
