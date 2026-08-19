# Measured cases

65 value changes, run through the real element at 48px and recorded off the
DOM rather than described from memory. **Kept** is the glyphs that never
re-rolled — still the same elements afterwards, with no animation on them.
**Travel** is how far the furthest kept glyph slid once everything settled.
**Width** is the host's box before and after, in pixels.

Re-run the sweep with `bun research/run-cases.ts` against a dev server; it
rewrites `research/cases.json`, which this page is generated from.

## What to look for

A counter that gains a digit keeps nothing, because every column shifts: `9` →
`10` re-rolls both. Change one digit in place and everything else survives,
which is why `1,204` → `1,205` keeps `1,20` and rolls a single glyph.

Anything with a unit attached keeps the unit for free. ` unread`, ` files`,
`Battery 8%`, ` of 10` — the number is the only thing that moves and the
sentence around it holds still. That is the case the library is really for.

The long-travel rows are the interesting ones.
`supercalifragilisticlight` → `light` keeps `light` and slides it 422px, which
is SwiftUI's behaviour and copied on purpose. `11` → `1,001` keeps both digits
and pays 74px for the separator that pushed them apart — the one case the
floating-run allowance exists for.

A few results are judgement calls rather than obvious wins. `nineteen` →
`twenty` keeps the shared `en` and slides it 86px, and `Offline` → `Online`
keeps `Oline` around the `ff` that leaves. Both are inside the travel budget and
both read fine at speed, but they are the kind of thing to look at in
[the studio](testing.md) before changing the matcher's constants.

The `Shape` group is the only place the strings are deliberately nonsense. Those
are the alignments the matcher has to get right, and real words would hide which
rule fired.

### Counters

| from | to | kept | travel | width |
| --- | --- | --- | --- | --- |
| `9` | `10` | — | — | 31 → 62 |
| `99` | `100` | — | — | 62 → 92 |
| `999` | `1,000` | — | — | 92 → 136 |
| `1,204` | `1,205` | `1,20` | — | 136 → 136 |
| `1,204` | `88,900` | — | — | 136 → 167 |
| `12,345` | `1,234` | `134` | — | 167 → 136 |
| `1` | `1,000,000` | `1` | — | 31 → 241 |
| `100` | `99` | — | — | 92 → 62 |
| `7` | `8` | — | — | 31 → 31 |
| `19` | `20` | — | — | 62 → 62 |

### Money

| from | to | kept | travel | width |
| --- | --- | --- | --- | --- |
| `$2.50` | `$12.75` | `$2.` | 31px | 136 → 167 |
| `$9.99` | `$10.00` | `$` | — | 136 → 167 |
| `€1,204` | `€1,205` | `€1,20` | — | 168 → 168 |
| `-$4.00` | `$4.00` | `$4.00` | 31px | 167 → 136 |
| `$1,000` | `$999` | `$` | — | 167 → 123 |

### Percent

| from | to | kept | travel | width |
| --- | --- | --- | --- | --- |
| `99%` | `100%` | `%` | 31px | 109 → 140 |
| `0.9` | `1.0` | — | — | 74 → 74 |
| `-1` | `0` | — | — | 62 → 31 |
| `3%` | `30%` | `3%` | 31px | 79 → 109 |
| `100%` | `99%` | `%` | 31px | 140 → 109 |

### Time

| from | to | kept | travel | width |
| --- | --- | --- | --- | --- |
| `12:59` | `13:00` | `1` | — | 136 → 136 |
| `9:41 AM` | `9:42 AM` | `9:4 AM` | — | 196 → 196 |
| `1 second` | `2 seconds` | ` second` | — | 212 → 238 |
| `59 seconds` | `1 minute 0 seconds` | `   seconds` | 182px | 269 → 451 |
| `2 minutes 12 seconds` | `2 minutes 13 seconds` | `2 minutes 1 seconds` | — | 508 → 508 |
| `Monday` | `Tuesday` | `day` | 13px | 186 → 199 |
| `March` | `April` | — | — | 146 → 107 |
| `11:59 PM` | `12:00 AM` | `1 M` | 4px | 223 → 227 |
| `in 5 minutes` | `in 4 minutes` | `in  minutes` | — | 280 → 280 |
| `Today` | `Tomorrow` | `To` | — | 145 → 238 |
| `31 December` | `1 January` | `1 ` | 31px | 311 → 229 |

### Labels

| from | to | kept | travel | width |
| --- | --- | --- | --- | --- |
| `1 unread` | `2 unread` | ` unread` | — | 205 → 205 |
| `Track 1 of 12` | `Track 2 of 12` | `Track  of 12` | — | 309 → 309 |
| `3 files` | `4 files` | ` files` | — | 140 → 140 |
| `loading` | `loaded` | `load` | — | 168 → 155 |
| `Draft` | `Published` | — | — | 115 → 226 |
| `12 km` | `12 miles` | `12 ` | — | 144 → 195 |
| `Battery 84%` | `Battery 83%` | `Battery 8%` | — | 288 → 288 |
| `2.4 MB` | `24.1 MB` | `2 MB` | 31px | 162 → 193 |
| `v1.9.0` | `v1.10.0` | `v1..0` | 31px | 145 → 176 |
| `4 of 10` | `5 of 10` | ` of 10` | — | 165 → 165 |
| `Offline` | `Online` | `Oline` | 8px | 154 → 147 |
| `18 °C` | `19 °C` | `1 °C` | — | 131 → 131 |

### Words

| from | to | kept | travel | width |
| --- | --- | --- | --- | --- |
| `seven` | `nine` | — | — | 138 → 98 |
| `light` | `daylight` | `light` | 84px | 99 → 184 |
| `daylight` | `light` | `light` | 84px | 184 → 99 |
| `Creative` | `Code` | `Ce` | 71px | 193 → 122 |
| `supercalifragilisticlight` | `light` <br><sub>the Apple travel case</sub> | `light` | 422px | 521 → 99 |
| `the light you seek is within you` | `you are the daylight` | `   ` | — | 704 → 454 |
| `one` | `two` | — | — | 86 → 85 |
| `nineteen` | `twenty` | `en` | 86px | 199 → 157 |

### Scripts

| from | to | kept | travel | width |
| --- | --- | --- | --- | --- |
| `👋` | `🌍` | — | — | 48 → 48 |
| `Hello 👋` | `Hola 👋` | `H 👋` | 13px | 177 → 164 |
| `一` | `二` | — | — | 48 → 48 |
| `٣` | `٤` | — | — | 26 → 26 |
| `Grüße` | `Grüßen` | `Grüße` | — | 142 → 170 |
| `零` | `一` | — | — | 48 → 48 |
| `Ελλάδα` | `Ελλάδας` | `Ελλάδα` | 17px | 165 → 212 |
| `🌑` | `🌒` | — | — | 48 → 48 |

### Shape

| from | to | kept | travel | width |
| --- | --- | --- | --- | --- |
| `abcdef` | `abcXY` <br><sub>prefix only</sub> | `abc` | — | 160 → 152 |
| `abcdef` | `XYdef` <br><sub>suffix only</sub> | `def` | 17px | 160 → 143 |
| `abcXXXdef` | `abcYYYYYdef` <br><sub>both ends</sub> | `abcdef` | 66px | 262 → 328 |
| `xxlightxx` | `yylightyy` <br><sub>floating run</sub> | `light` | 2px | 206 → 210 |
| `zzzzdaylightzzzz` | `qqqqdaylightqqqq` <br><sub>floating run, long</sub> | `daylight` | 11px | 398 → 420 |
| `11` | `1,001` <br><sub>floating run pays for a separator</sub> | `11` | 74px | 62 → 136 |
