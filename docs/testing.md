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

The type is yours: pick a bundled family, grant local font access to get every
family installed on the machine, or upload a file. An uploaded font travels with
the export as base64, since an SVG image cannot fetch anything; an installed one
needs nothing, because the SVG resolves it locally the same way the page does.
Glow is a pair of text shadows — a tight core and a wide halo — and it survives
the export, so an icon can be lit rather than flat.

It runs like a video editor: space plays and pauses, `L` loops, `⌘,` and `⌘.`
step a single frame at 60fps (hold shift for ten), Home and End jump to the
ends, and the rate select plays back at down to a tenth of speed without
changing the roll's own timing. The strip above the scrubber is sixteen frames
of the transition, each one rasterised through the same capture the export uses,
so it shows the roll rather than a drawing of it. It rebuilds a quarter second
after the last knob moves, because sixteen captures is not something to do on
every frame of a drag.

Building the strip means walking the animations across the whole timeline, which
is the one thing that must not be visible: it reads as the transition playing at
some absurd speed. The stage holds a still of the frame you were on and the host
goes `visibility: hidden` underneath it — a hidden element still has layout and
still reports what its animations are doing, which is all the capture needs, and
the clone the capture builds forces itself visible.

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

## `/versus`

Upstream `numeric-text` and this fork in one figure, on one timer, with every
constant written into both engines' `CONFIG` so the only thing differing is the
code. Upstream is vendored unmodified at `apps/website/src/vendor/numeric-text`
and registers `<numeric-text>`, so the two tags coexist; nothing else on the site
imports it.

Freeze pauses every animation in both shadow roots, catching each where it stands
rather than rewinding to a shared zero — at these cadences a dozen rolls are in
flight at different ages, and that spread is the thing worth looking at. Scrub
then walks the whole scene together, and the readout counts ink still on screen
grouped by the slot it sits in.

That count settles the question the page was built for. Both engines stack
outgoing glyphs in the same slot; neither swaps or deletes them. What differs is
`hurry`, which upstream does not have. At a 40ms cadence on a 590ms roll, a slot
is two or more glyphs deep in 100% of frames upstream and 26% with `hurry` on,
and the fork's mean depth is 1.29 against 2.77. Turn `hurry` off and the two
match: 99% against 100%, mean 2.53 against 2.72.

## The case sweep

`bun research/run-cases.ts` runs the documented value changes and
writes `research/cases.json`: what was kept, how far it travelled, how the box
resized. It is the source for [cases.md](cases.md), and worth re-running after
anything that touches the matcher.
