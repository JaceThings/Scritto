# How SwiftUI's numeric text transition behaves

Measured on macOS 27 / Xcode 26.6 (Apple Swift 6.3.3), August 2026, against
`Text(...).contentTransition(.numericText())`. Two instruments, both driving a
real `NSHostingView`:

- **Offscreen** (headless Mac mini, no display needed): the text layer's frame
  sampled every 8ms across a value change, plus the layouts SwiftUI hands a
  custom `TextRenderer`. 57 cases.
- **On screen** (a 900x130 borderless window, `.accessory` so it never takes
  focus): `screencapture -v` of just that rect, 30fps, sliced per case by a
  marker square, then per-frame ink-column profiles and cross-correlation to
  measure how far content translates. 36 cases across three sweeps.

Raw data: `probe/apple-matrix.txt`, the sweep logs, and the frame analyses.

## What it does

**It matches a common prefix and a common suffix. Nothing else.**

| shared content | example | result |
| --- | --- | --- |
| prefix only | `abcdef` -> `abcXY` | prefix kept, no motion |
| suffix only | `abcdef` -> `XYdef` | suffix kept, slides 18px |
| both ends | `abcXXXdef` -> `abcYYYYYdef` | both kept, suffix slides 47px |
| middle only | `xxlightxx` -> `yylightyy` | **not matched** — everything dissolves in place |
| middle only, long | `zzzzdaylightzzzz` -> `qqqqdaylightqqqq` | **not matched** |
| middle only, a word | `say light now` -> `the light is` | **not matched** |

There is no search for a run flush with neither end. `the light you seek is
within you` -> `you are the daylight` shares the word `you`, and SwiftUI never
considers it: the whole line cross-dissolves where it stands, left to right.

**A matched run slides as far as the layout requires, with no distance limit.**

| pair | kept run travels |
| --- | --- |
| `dlight` -> `light` | 25px |
| `daylight` -> `light` | 69px |
| `brightestlight` -> `light` | 167px |
| `extraordinarlight` -> `light` | 224px |
| `supercalifragilisticlight` -> `light` | **337px** |
| `dayt` -> `t` (one character kept) | 10px |

Every one of those is a smooth ramp, not a jump. The reason unlimited travel is
safe for Apple is that an end-anchored run never travels further than the
layout moves it — the distance is a consequence, not a search result.

**Everything that is not kept cross-dissolves in place**, blurring slightly,
staggered left to right. Glyphs never fly to a new home.

## Other observations

- The text is anchored at the leading edge; the trailing edge does the moving.
  In 14 recorded cases the left edge never moved.
- `.numericText()` animates any content, not only digits — words, CJK, Hebrew
  and emoji all transition. It is not gated on the string being a number.
- `.numericText(value:)` behaved identically to `.numericText()` in every case.
- `.opacity` and `.identity` never interpolate the advance; `.interpolate` and
  no transition at all snap the layout at the end.
- Design (default / rounded / monospaced), size (14 / 48 / 96) and
  `monospacedDigit()` change the geometry but not the rule.
- A custom `TextRenderer` is called only for the endpoint layouts, so the morph
  itself is done on rendered text rather than by re-laying it out per frame.

## What scritto does with this

Same as Apple where Apple is right, and deliberately different in one place.

- **Prefix and suffix keeps are unbounded**, as Apple's are. Before this study
  scritto capped how far a kept suffix could travel, so
  `supercalifragilisticlight` -> `light` rerolled every glyph where SwiftUI
  slides them. The cap is gone: an end-anchored run goes wherever layout puts
  it.
- **Floating runs stay, but bounded.** Unlike Apple, scritto does look for a run
  flush with neither end, because it buys real cases: `1 second` ->
  `2 seconds` keeps ` second`, which Apple rerolls entirely. The bound is
  `travel <= run length + 2`, so a stationary shared word is kept while a short
  common word cannot fly across the value. `xxlightxx` -> `yylightyy` keeps
  `light` standing still — better than Apple's full dissolve — while
  `the light you seek is within you` -> `you are the daylight` rerolls, which is
  what Apple does too.
