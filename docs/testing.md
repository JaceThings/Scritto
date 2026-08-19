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

`check:flow` also hammers a value across widths inside a paragraph and asserts
the box is not left dressed for a transition afterwards — display, margin,
shrink-clip and inline width all back where they started — and that the
paragraph never gains a line box while the hammering runs. The width transition
survives across updates now, so its teardown is only ever reached by the
animation finishing, and that is the thing worth guarding.

## `/edges`

Twenty awkward cases in a grid, most on their own clock and never stopping: the
widest glyph this font stack renders against the narrowest, a width re-aimed
every 90ms against a 590ms roll, digits crossing a group separator, sign flips,
decimals arriving, empty and back, whitespace only, ZWJ emoji and skin tones,
combining marks, right-to-left, mixed scripts, Thai and Devanagari clusters,
sixty characters against one, a prefix and suffix kept either side, a value in
running copy inside a flow, three hosts sharing a line, an overshooting spring
over 1.4s, a value counting at 16ms, and two changes 8ms apart.

Every card audits itself whenever it goes idle, which is the point of the page:
the value on screen is the value it was handed, the host is wearing none of the
inline styles a width transition puts on it — display, width, text-indent,
margin-inline-end, flex-shrink, text-align, data-shrink-clip — and no glyph has
settled outside the box the value is measured to occupy. Against the host's own
box, not the card's: a long value with nowrap is meant to run past a narrow
card. A dot goes red and stays red with what it caught, and a banner catches
anything thrown or rejected.

Storm runs every card at once for ten seconds. Measured over a storm: 20 cards,
4,393 changes, nothing caught, no errors.

## `bun run check:versus`

Holds this fork against the upstream it forked. `/versus` already runs both
engines on one timer with the same constants pushed into both, so this drives
that page at three cadences — 90ms, 40ms and 20ms against a 590ms roll — and
compares what a person would actually see rather than what the code intends.

It records with the frame limiter off, which lands around 100fps, well above a
display's refresh, then measures three things per cadence: ink per half straight
off the recorded frames, how wide that ink spreads, and how long a departing
glyph lives from the moment its animation is created to the moment it leaves the
DOM. Ink and spread are guarded both ways — carrying less than upstream is a
divergence too — at 1.03x and 1.04x, and a glyph's life within 90ms.

Ink is summed brightness over the background, not a count of pixels past a
cutoff. A cutoff read 1.05x off a difference in how the brightness was
distributed while the ink itself was level, and nothing in these frames ever
reaches a lift of 150 out of 255, so the cutoff was sitting in the tail.

Measured now, stable across runs and against the deployed site: ink 0.998x at
every cadence, spread 1.000x, a glyph living 590ms here against 591ms upstream.

## `/versus`

Upstream `numeric-text` and this fork in one figure, on one timer, with every
constant written into both engines' `CONFIG` so the only thing differing is the
code. Upstream is vendored unmodified at `apps/website/src/vendor/numeric-text`
and registers `<numeric-text>`, so the two tags coexist; nothing else on the site
imports it.

Freeze pauses every animation in both shadow roots, catching each where it stands
rather than rewinding to a shared zero — at these cadences a dozen rolls are in
flight at different ages, and that spread is the thing worth looking at. Scrub
then walks the whole scene forward together, and the readout
counts ink still on screen grouped by the slot it sits in.

Forward only, because backward cannot be honest: a glyph that already finished
was released, and rewinding cannot bring it back, so the two sides would show
different pasts of the same value.

This page is what retired `hurry`. Measured at 90ms and 40ms cadences the two
engines match to within a frame — lifetimes 607 against 607ms, exits on screen
248 against 236ms, entrances 317 against 301ms, nothing cut short on either
side — and both stack outgoing glyphs in the same slot rather than swapping or
deleting them. Every apparent difference traced back to that option running the
fork's exits at up to 6×.

The one engine difference left is direction. Upstream reads a grouped value with
`parseFloat`, so `5,229 → 5,236` is `5 → 5` and rolls downward; the fork parses
the whole number and rises.

## The case sweep

`bun research/run-cases.ts` runs the documented value changes and
writes `research/cases.json`: what was kept, how far it travelled, how the box
resized. It is the source for [cases.md](cases.md), and worth re-running after
anything that touches the matcher.
