# @scritto/core

## 0.1.5

### Patch Changes

- ce19aac: Keep surviving glyphs through rapid updates. Find kept runs a couple of characters off the suffix, pool chars once, and FLIP from a kept glyph's centre so a later tick does not cancel an earlier roll.
