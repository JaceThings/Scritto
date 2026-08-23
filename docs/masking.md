# Edges: how old ink leaves the box

When a value shrinks, the box moves to its new width while the glyphs that are leaving hold the place they were drawn in. For a few hundred milliseconds that ink sits outside the box — over the word after it, or outside the card that hugs it.

A gradient band dissolves that ink at the edge it is escaping from. This page is what the band is, where it lives, and the rules that keep it from becoming the thing it exists to prevent: a hard, straight cut through a glyph.

## The shape of it

One `linear-gradient` mask, 0.3em of ramp, on the layer that holds the leaving glyphs. Nothing else in the shadow tree is ever masked.

```css
/* end side, LTR: opaque until 0.3em before the edge, gone at the edge */
mask-image: linear-gradient(90deg, #000 0, #000 calc(100% - var(--room) - 0.3em), transparent calc(100% - var(--room)));
```

`--room` is `--scritto-exit-room` throughout this page, shortened to keep the lines readable. `data-shrink-clip` on the host says which logical sides are armed — `start`, `end`, `both`, or absent. The engine sets it for the length of a transition and takes it off at the end, so a settled host carries no mask at all.

## Which ink, which edge, how much room

Four decisions, in the order they matter.

**Only leaving ink wears a band.** The live value is never dimmed. The band lives on the layer that holds the leaving glyphs, never on the host — a band on the host would land on whatever the host contains, dimming the live value whenever its first glyph sits on the travelling edge (`€` in `€4,500.00 → €4.50`, for instance).

**An edge earns its band by travelling.** A stationary edge leaves nothing behind, so masking it can only cost you ink. Both edges move in a centred container; only one moves in a left-aligned card.

**The band sits past the content, not inside it.** The end side carries 0.4em of slack — box widened, negative margin handing it back to the line — so the ramp falls outside the last glyph. The box converges on its final width asymptotically, so a band inside the box would dim that glyph for the entire back half of the roll and then pop when the mask lifted.

**The band's own box has to be bigger than the ink.** This is the part that is easy to get wrong, because it is not about gradients at all. See below.

## The rule everything else follows from

A mask paints no further than its element's border box. `mask-clip` defaults to `border-box`, so the instant you arm a mask, every pixel outside that box is gone — not faded, gone, along a perfectly straight line.

That is one property doing two jobs, and only one of them was asked for. So the band's box is grown past the ink on every side that is not being faded:

| Direction | Room | Why that much |
| --- | --- | --- |
| Inline | `--scritto-exit-room`, set per transition | A ghost holds its place while the box leaves it, so it ends up as far out as that edge travels — plus its blur |
| Block | 0.5em above and below | Descenders, and the blur on a glyph that is scaling away |

The room is measured, not guessed:

```ts
const room = Math.max(Math.abs(startShift), Math.abs(endShift)) + blockSlackPx(this)
this.style.setProperty('--scritto-exit-room', `${Math.ceil(room)}px`)
```

Because the layer is absolutely positioned, that padding costs no layout at all. Its children are offset back by the same amount, so nothing moves:

```css
.exits            { padding-inline: var(--room); inset-inline-start: calc(-1 * var(--room)); }
.exits > [inert]  { inset-inline-start: var(--room); }
```

## Best practices

They generalise to any gradient mask over moving text.

**Grow the box before you fade.** *Why:* `mask-clip: border-box` makes the border box a hard clipper the moment a mask exists. *When:* always — the first time your ink is a descender, a blur, or anything held outside the box, you will see a flat edge instead of a ramp.

```css
/* not enough: the gradient is taller, the clip box is not */
mask-size: 100% 400%;
/* what works: the box itself is taller */
padding-block: 0.5em; margin-block: -0.5em;
```

**Never mask an element that contains live content.** *Why:* a mask applies to everything inside, so a band meant for a ghost will find your value. *When:* any time the faded thing and the permanent thing share an ancestor — put the band on a sibling overlay instead.

**One band per pixel.** *Why:* two masks multiply, and 0.3 × 0.3 is not a ramp, it is a step that reads as a cut. *When:* whenever a masked element would otherwise sit inside another masked element.

**End the ramp at an edge that has slack.** *Why:* a ramp ending at the content edge eats the last glyph; a ramp ending 0.4em past it eats nothing. *When:* on any edge where live text can reach the boundary.

**Put the room in a custom property, set from measurement.** *Why:* a constant big enough for the worst transition is absurd for the common one, and a constant sized for the common one cuts the worst. *When:* the overflow depends on the change rather than the design. `--scritto-exit-room` runs 38–195px on the same card depending on how far the edge moves.

**Reach for padding, not `mask-clip: no-clip`.** *Why:* `no-clip` removes the clip everywhere, not just past the ink — old ink leaks straight past the far edge instead, which is the thing the band exists to stop. *When:* never, until browsers agree on what it means outside a border box.

**Check your own resets are not eating the room.** *Why:* a shadow-tree reset like `span { padding: 0 !important }` silently wins against the rule that gives the band its room, and the symptom is a cut you have already "fixed". *When:* anywhere a broad reset and a targeted layout rule touch the same element.

```css
.exits { padding: 0.5em var(--room) !important; }  /* over the reset above */
```

**Give an embedded flow its gutter.** *Why:* the fade needs 16px to finish; a container with 8px of padding and `overflow: hidden` chops it halfway and leaves the hard edge back. *When:* embedding a value in a card, pill, or anything that hides overflow. See [Flow](flow.md#the-gutters).

## How we know

Rects lie at low alpha, so the ground truth is pixels. The probe freezes a frame mid-transition, screenshots it with the mask on, toggles only the mask off — no reflow, no re-run — and diffs. Anything the mask removed shows up as a bright region, and where that region has a straight edge, you have found a cut.

To attribute ink to the ghosts alone, hide the exits layer and diff again: two more shots, and the ratio per column is exactly how much of the ghost survived.

```
ghost survives, px from box RIGHT: -8:0.90 -7:0.77 -6:0.65 -5:0.54 -4:0.42 -3:0.30 -2:0.18 -1:0.06 0:0.00
```

That is what a fade looks like as numbers. A cut is `1.00` then `0.00`.

Three checks keep it honest: `/resize` audits every card on every frame and reads 0.0px of escape, `check:stress` fails if a ghost draws over a neighbour, and `check:versus` holds the whole engine within 1.03× of upstream on ink. `check:stress` models the clip line as the host's edge, not the band's box — the band's box is deliberately wider, so modelling it as the limit would let a real cut through unnoticed.
