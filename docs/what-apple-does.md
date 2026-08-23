# What SwiftUI does, and where we part company

Everything here was measured, not read. The reference is `Text(...).contentTransition(.numericText())` on macOS 27 / Xcode 26.6, August 2026, driven through a real `NSHostingView` two ways: offscreen, sampling the text layer's frame every 8ms and capturing the layouts SwiftUI hands a custom `TextRenderer` (57 cases), and on screen, recording a 900×130 borderless window at 30fps and measuring how far ink translates by cross-correlating per-frame column profiles (36 cases across three sweeps). The raw matrix is in `research/apple-matrix.txt`.

## The rule

**It matches a common prefix and a common suffix. Nothing else.**

| shared content | example | result |
| --- | --- | --- |
| prefix only | `abcdef` → `abcXY` | prefix kept, no motion |
| suffix only | `abcdef` → `XYdef` | suffix kept, slides 18px |
| both ends | `abcXXXdef` → `abcYYYYYdef` | both kept, suffix slides 47px |
| middle only | `xxlightxx` → `yylightyy` | **not matched** — everything dissolves |
| middle only, long | `zzzzdaylightzzzz` → `qqqqdaylightqqqq` | **not matched** |
| middle only, a word | `say light now` → `the light is` | **not matched** |

There is no search for a run flush with neither end. `the light you seek is within you` → `you are the daylight` shares the word `you`, and SwiftUI never considers it: the line cross-dissolves where it stands, left to right.

## A kept run travels as far as layout says

| pair | kept run travels |
| --- | --- |
| `dlight` → `light` | 25px |
| `daylight` → `light` | 69px |
| `brightestlight` → `light` | 167px |
| `extraordinarlight` → `light` | 224px |
| `supercalifragilisticlight` → `light` | **337px** |
| `dayt` → `t`, one glyph kept | 10px |

Every one of those is a smooth ramp, not a jump. Unlimited travel is safe for Apple precisely because an end-anchored run never travels further than layout moves it. The distance is a consequence, not a search result.

## The rest of what fell out of the study

- The text is anchored at its leading edge; the trailing edge does the moving. Across 14 recorded cases the left edge never moved.
- `.numericText()` animates anything, not only digits. Words, CJK, Hebrew and emoji all transition — it is not gated on the string being a number.
- `.numericText(value:)` behaved identically to `.numericText()` in every case.
- `.opacity` and `.identity` never interpolate the advance. `.interpolate`, and no transition at all, snap the layout at the end.
- Design (default, rounded, monospaced), size (14, 48, 96) and `monospacedDigit()` change the geometry but not the rule.
- A custom `TextRenderer` is called only for the two endpoint layouts, so the morph runs on rendered text rather than by re-laying it out per frame.
- Everything not kept cross-dissolves in place, blurring slightly, staggered left to right. Glyphs never fly to a new home.

## Where scritto agrees

**Keeps are unbounded at either end.** An earlier version capped how far a kept suffix could travel, which meant `supercalifragilisticlight` → `light` re-rolled every glyph where SwiftUI slides them. The cap is gone. Measured here at 48px type, that same pair keeps `light` and slides it 422px.

**Anything can roll.** Digits, words, emoji, CJK, Arabic-Indic digits. Nothing is gated on the value parsing as a number.

**The unmatched middle dissolves in place** rather than flying anywhere.

## Where scritto does not

**We look for a floating run, and Apple does not.** It buys real cases. `1 second` → `2 seconds` keeps ` second`; Apple re-rolls the lot. `xxlightxx` → `yylightyy` keeps `light` standing still, measured at 2px of drift.

The reason Apple can skip this and still look right is that its rule is self-limiting, and ours is not, so ours needs a brake: a floating run may travel at most its own length plus two glyph slots. That keeps `light` still, lets `11` → `1,001` pay 74px for the separator that pushed its digits apart, and refuses to let a short word cross a long value. `the light you seek is within you` → `you are the daylight` therefore re-rolls — same as Apple, by a different route.

**Direction is inferred from every number in the value, not just the first.** `2 minutes 12 seconds` → `2 minutes 13 seconds` reads as a rise, because the first number that differs decides. Gaining or losing a number leaves nothing to compare position-for-position, so `59 seconds` → `1 minute 0 seconds` reads as a rise too, which is what the clock is doing.
