# How the roll works

A value changes. Some of the glyphs on screen are also in the new value, and
some are not. The ones that survive slide to where they now belong; the ones
that do not roll out while their replacements roll in. That is the whole idea,
and everything below is the detail of deciding which is which and moving them
without the reader noticing the machinery.

## Graphemes, not characters

The value is split into graphemes before anything else looks at it. A string of
plain ASCII takes a fast path that walks the code units directly, because that
is most values and `Intl.Segmenter` is not free. The moment a byte above 0x7F
appears, or a CRLF pair, the whole string goes through the segmenter instead.

That matters for anything that is one glyph made of several code points. `👋` is
two code units and one grapheme. A flag is four. `é` typed as `e` + a combining
accent is two code points that must never be split, or the accent rolls away on
its own.

Every ordinary space becomes a non-breaking space at this point. The host is
`white-space: nowrap`, and a value like `1 minute 0 seconds` would otherwise be
free to collapse or break at the spaces while it is mid-roll.

## What gets kept

Three passes, in order, and they stop as soon as the answer cannot improve.

**The common prefix.** Walk from the start while the old glyph and the new
glyph match. `Track 1 of 12` to `Track 2 of 12` keeps `Track ` before anything
else runs.

**The longest run either value ends with.** Walk back from both ends while they
match. That is what makes ` unread` survive `1 unread` to `2 unread`, and what
lets `$4.00` survive losing its minus sign.

**A run flush with neither end.** This is the part Apple does not do, and it is
worth having: `xxlightxx` to `yylightyy` keeps `light` standing perfectly still,
where a prefix-and-suffix-only rule would dissolve the whole line. The search
tries five alignments — the one layout implies, then two either side of it,
nearer side first so ties travel the shortest distance.

A floating run has to be at least two glyphs long. One letter shared by two
unrelated words is a coincidence, not a run, and treating it as one makes
`seven` to `nine` fly its `n` across the value while everything else rolls.

## Why a floating run pays for its travel

An end-anchored run never chooses to move. Layout moves it, and the distance is
whatever the change happens to require — `supercalifragilisticlight` to `light`
slides the kept `light` 422 pixels, and it reads as the word staying put while
everything in front of it is taken away.

A floating run is different, because keeping it is a choice. Nothing forces
`light` in the middle of one value to be the same `light` in the middle of
another, and if it is allowed to fly far enough, the reader sees a word swimming
upstream through text that is dissolving around it.

So a floating run buys its travel: it may move at most its own length plus two
glyph slots. The two are there for exactly one case, a group separator
appearing. `11` to `1,001` keeps both `1`s and pays 74 pixels for the comma that
pushed them apart, which is right. A three-letter word cannot cross a
twenty-glyph value, which is also right.

Travel is measured in glyph slots and corrected by where the box is anchored,
because a run's distance on screen depends on which edge of the box holds still
while the box resizes. A value that grows from its right edge moves its content
differently from one that grows from its centre.

## Three passes over the DOM, batched

Every host that changed in the same tick is handled together, in a microtask, in
three phases. All of them read, then all of them write, then all of them read
again. Interleaving would make each host's measurements depend on how many hosts
came before it.

1. **Prepare.** Measure where everything currently is, and build the plan: which
   glyphs are kept, which are entering, which are leaving, and the box each one
   sits in right now.
2. **Commit.** Rearrange the DOM. Entering glyphs are inserted at zero opacity;
   leaving glyphs are moved into a separate layer; kept glyphs stay put in the
   tree even though their position on screen has just changed.
3. **Finish.** Measure again, then start every animation from the difference
   between the two reads.

## FLIP, and the one honest reference point

A kept glyph is now in a new place, because the glyphs around it changed. It is
moved back to where it was with a transform and then animated to nothing, so it
appears to slide from the old position to the new one.

The reference for that measurement is a kept glyph itself, not the section
containing it. `offsetLeft` rounds to whole pixels, so measuring the container
invents a sub-pixel jump that shows up as the whole run twitching at the start
of every transition.

## The sweep

Glyphs do not all start at once. Each one is delayed by where it sits along the
row, so the change reads as a wave crossing the value rather than a flash.

Delay comes from position, not from index. Two glyphs standing on top of each
other — the old one leaving, the new one arriving — get the same delay and cross
over together, which is the whole point. Indices would put them on different
schedules.

The wave is normalised over the changed stretch alone, not the whole value. A
one-digit change inside a long number would otherwise start late and finish in a
sliver of the duration it was given.

`Draft` to `Published`, at a 400ms duration:

| glyph | x | delay |
| --- | --- | --- |
| `P` | 46 | 0ms |
| `u` | 76 | 16ms |
| `b` | 105 | 32ms |
| `l` | 131 | 47ms |
| `i` | 143 | 54ms |
| `s` | 158 | 60ms |
| `h` | 184 | 74ms |
| `e` | 213 | 89ms |
| `d` | 241 | 104ms |

The outgoing `Draft` gets the same treatment against its own positions: `D` at
0ms, `r` at 18ms, `a` at 28ms, `f` at 43ms, `t` at 52ms.

## What a glyph actually does

Entering and leaving are the same four properties, mirrored:

```
opacity   0 → 1
transform translateY(±0.35em) scale(0.6) rotateZ(2deg) → none
filter    blur(0.1em) → none
```

The sign on `translateY` is the trend: a value that went up has its new glyphs
arrive from below and its old ones leave upward. The rotation is two degrees,
which is not enough to read as rotation — it is enough to stop the glyph looking
like a rigid object being scaled.

## The box

The host's width is animated as well, so the words after it slide instead of
jumping. An inline host becomes `inline-block` for the duration, with its
vertical padding and border cancelled by matching negative margins so the line
it sits on keeps its height.

Whichever edge the box is anchored to, the content is indented back by however
far the start edge has to travel and eased to nothing along with the width. That
way the row holds where it will land instead of drifting into place.

The width easing is `cubic-bezier(0.22, 1, 0.36, 1)`, not the roll's own spring.
A spring overshoots, and a kept run riding an overshooting box outruns the
shrink and has to come back.

## The mask

When the box shrinks, the old row reaches past where the box is heading, and
whatever sits after the host slides in over that ink. A gradient mask dissolves
the moving edge so the two never overlap.

It is only armed for a shrink, and only when there is a neighbour within reach.
A growing value lays its new glyphs down at their final places and fades them in
there while the box catches up, so there is nothing to hide, and masking it
anyway costs the last glyph its edge.

The band sits slightly past the content rather than inside it. The box converges
on its final width asymptotically, so the last glyph spends the back half of the
transition a pixel or two beyond the edge at full opacity — a band inside the box
would dim it the whole way and then pop when the mask lifted.

## Leaving glyphs keep going

Outgoing glyphs are parked in their own layer, positioned by a transform from
the host's start edge rather than by layout, so the box can resize underneath
them without dragging them along.

They are deliberately not cancelled when the next update lands. A digit halfway
out of a rapidly-changing counter finishes leaving rather than popping. The cost
is that a value spammed faster than its own duration stacks several outgoing
copies over each other. The fix for that is a roll no longer than the gap
between updates, not a shortcut that speeds the pile away; see
[timing.md](timing.md).

## The pool

Glyph elements are recycled through a pool rather than created and thrown away.
A release rides the animation that finishes it, spaces included: a space has no
ink to roll, so it runs an animation that does nothing rather than a wall-clock
timer. Anything holding the roll still — a paused scrub, a background tab —
would otherwise lose its spaces while the glyphs around them stayed.
