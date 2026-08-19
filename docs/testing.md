# Testing

Everything here drives a real browser against the dev server, so start that
first with `bun run play`. `STRESS_URL` points the harnesses somewhere else if
you want to check a deployed build.

## `bun run check:stress`

Forty-six cases through one element. Grouped numbers and currency, signs,
emoji, CJK, RTL, zero-width joiners, values long enough to wrap, values sitting
inside an inline wrapper, values with a neighbour hard against either side.

What it asserts is the stuff that breaks quietly: no glyph may overlap a
neighbour by more than half a pixel, a kept glyph has to land where the settled
layout puts it, and the box has to end up the size of the text it holds.

## `bun run check:flow`

The wrapping side. A word that keeps its line has to slide along it, a word that
changes line has to hand off between ghosts rather than fly, and the block has
to hold its height while a value inside it resizes. The homepage's live sentence
gets its own case, because a counter ticking mid-paragraph is the thing most
likely to shuffle a line nobody was looking at.

## `bun run check:churn`

Interruption. Fifteen transitions redraw only what changed. Eighteen kept-run
position checks. A rapid `0.23` → `0.40` still has the `2` rolling when the `4`
arrives — that one exists specifically to stop anyone "fixing" overlapping rolls
by cancelling them. Twelve overlapping `Words` → `Numbers` → `Words` cycles keep
all eight glyphs of `Creative` visible.

## `/studio`

Not automated, but the thing to reach for when a frame looks wrong. It holds one
element with its animations paused and driven by hand, so any moment of a
transition can be held still and inspected, with the blur, travel, scale,
rotation, stagger, duration and trend all adjustable underneath. It exports the
held frame as a transparent PNG at up to 8×, which is also how the icon artwork
gets made.

It runs like a video editor: space plays and pauses, `L` loops, `⌘,` and `⌘.`
step a single frame at 60fps (hold shift for ten), Home and End jump to the
ends, and the rate select plays back at down to a tenth of speed without
changing the roll's own timing. The strip above the scrubber is sixteen frames
of the transition, each one rasterised through the same capture the export uses,
so it shows the roll rather than a drawing of it. It rebuilds a quarter second
after the last knob moves, because sixteen captures is not something to do on
every frame of a drag.

## `/readouts`

The playground's slider readout, seven ways, on one page: every step rolling,
every step hurried, live under the finger, and four pacings. Drag each one and
pick by feel; the site default is marked. It exists because the right answer
here is a taste call and the wrong ones only show up under a real hand.

Below the seven is a Custom card: a number that never stops growing, with
sliders for how often it changes and how far it jumps each time, plus the
roll's own duration, stagger, blur, travel, scale and rotate live underneath —
the same global constants every card on the page reads, so moving one retunes
the whole page. It's also the tool that explains why a bigger number can feel
slower to settle than a smaller one: a change that only touches one digit
starts rolling immediately, but one that carries into a new digit (`990` to
`1000`) spreads its start across the width of everything that changed, per
`stagger`. Dialling stagger to 0 removes the difference outright.

## The case sweep

`bun research/run-cases.ts` runs the documented value changes and
writes `research/cases.json`: what was kept, how far it travelled, how the box
resized. It is the source for [cases.md](cases.md), and worth re-running after
anything that touches the matcher.
