import type { Transition } from './types'

export const SPACE = '\u00A0'
export const CONFIG = {
  y: 0.35,
  scale: 0.6,
  blur: 0.1,
  rotate: 2,
  stagger: 0.3,
}

export const DEFAULT_TRANSITION: Transition = {
  duration: 550,
  easing:
    'linear(0,.1052,.3155,.532,.7112,.8414,.9265,.9765,1.0023,1.013,1.0151,1.0133,1.01,1.0068,1.0041,1.0022,1.001,1)',
}

export const BOUNCE_TRANSITION: Transition = {
  duration: 550,
  easing:
    'linear(0,0.0843,0.2682,0.4765,0.6659,0.8165,0.9238,0.9918,1.0289,1.044,1.0453,1.039,1.0298,1.0204,1.0123,1.0062,1.0021,1)',
}

export const SHRINK_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
export const WIDTH_ANIM = 'scritto-width'

// The box converges on its width asymptotically, so a ramp inside it would dim
// the last glyph the whole way and pop when the mask lifted. EDGE_SLACK widens
// the mask's box past the content and a negative end margin takes that back.
const EDGE_FADE = '0.3em'

/** How far past the content the mask's box reaches, in em. */
const EDGE_SLACK = 0.4

export const edgeSlackPx = (el: HTMLElement) => (parseFloat(getComputedStyle(el).fontSize) || 16) * EDGE_SLACK

/** Room above and below the line for a descender and its blur, in em. */
const BLOCK_SLACK = 0.5

export const blockSlackPx = (el: HTMLElement) => (parseFloat(getComputedStyle(el).fontSize) || 16) * BLOCK_SLACK

/** Room the band keeps beyond the ink it fades, so no edge but that one cuts it. */
const ROOM = 'var(--scritto-exit-room, 0px)'

/** How far the wipe below has swept across a line's ink, animated per group. */
export const WIPE_VAR = '--scritto-exit-wipe'
const WIPE = `var(${WIPE_VAR}, 0px)`

const mask = (stops: string, overscale = false) =>
  ['-webkit-', ''].map(
    (p) => `
    ${p}mask-image: linear-gradient(90deg, ${stops});
    ${p}mask-repeat: no-repeat;` +
      (overscale
        ? `
    ${p}mask-size: 100% 400%;
    ${p}mask-position: 0 50%;`
        : ''),
  ).join('')

/**
 * Only the ghosts wear a band, never the live value, and only one each: masking
 * twice squares the ramp into a hard edge. A mask paints no further than the
 * border box, so the band's box grows past the ink on every side it is not
 * fading, and its children start at that room to keep their place.
 */
const clipRules = () => {
  const sides: [value: string, start: boolean, end: boolean][] = [
    ['', false, true],
    ['end', false, true],
    ['start', true, false],
    ['both', true, true],
  ]
  return sides
    .flatMap(([value, start, end]) =>
      [false, true].map((rtl) => {
        const host = `[data-shrink-clip='${value}']${rtl ? ':dir(rtl)' : ''}`
        const [left, right] = rtl ? [end, start] : [start, end]
        const stops = [
          left ? `transparent ${ROOM}, #000 calc(${ROOM} + ${EDGE_FADE})` : '#000 0',
          right ? `#000 calc(100% - ${ROOM} - ${EDGE_FADE}), transparent calc(100% - ${ROOM})` : '#000 100%',
        ].join(', ')
        // Overscaled vertically: the band only ever cuts horizontally, so a
        // descender or a blurred glyph reaching past the box keeps its ink.
        return `
  :host(${host}) .exits {${mask(stops, true)}
    padding: ${BLOCK_SLACK}em ${ROOM} !important;
    margin-block: -${BLOCK_SLACK}em !important;
    inset-inline-start: calc(-1 * ${ROOM});
  }
  :host(${host}) .exits > [inert] {
    inset-inline-start: ${ROOM};
  }`
      }),
    )
    .join('')
}

/**
 * A wrapped value's old ink lies over text that has already re-flowed, so there
 * is no single edge to fade it against and a band on the box would erase every
 * line but the first. Each line's group wears its own instead, swept across that
 * line while the ghosts fade.
 */
const wipeRules = () =>
  [false, true]
    .map((rtl) => {
      const stops = rtl
        ? `transparent ${WIPE}, #000 calc(${WIPE} + ${EDGE_FADE}), #000 100%`
        : `#000 0, #000 calc(100% - ${WIPE} - ${EDGE_FADE}), transparent calc(100% - ${WIPE})`
      return `
  .exits > [inert][data-wipe]${rtl ? ':dir(rtl)' : ''} {${mask(stops)}
    padding: ${BLOCK_SLACK}em !important;
    margin: -${BLOCK_SLACK}em !important;
  }`
    })
    .join('')

export const STYLES = `
  :host {
    position: relative;
    display: inline;
    box-sizing: border-box;
    white-space: nowrap !important;
    isolation: isolate;
    vertical-align: baseline;
  }
  :host([data-wrap]) {
    white-space: normal !important;
  }
  .exits {
    position: absolute;
    inset-inline-start: 0;
    width: 100%;
    display: inline-flex !important;
    z-index: 2;
    pointer-events: none;
  }
  /* Sits on a section's baseline, not the host's box, which the sections top by a pixel or two. */
  .exits::before {
    content: "\\200B";
  }
${clipRules()}${wipeRules()}
  span {
    margin: 0 !important;
    padding: 0 !important;
    text-indent: 0; /* the host indents its row; each glyph is a block of its own */
    transform-origin: center;
  }
  /* Placed by a transform from the host's start edge, never a static position. */
  .exits > [inert] {
    position: absolute !important;
    display: inline-flex !important;
    inset-inline-start: 0;
  }
  /* Inline, not inline-flex: a section that cannot break internally makes the
     whole value one unbreakable box, and a long one then overhangs its column. */
  .section {
    position: relative !important;
    display: inline !important;
    transform: none;
    z-index: 1;
  }
  .word {
    display: inline-block !important;
    white-space: nowrap !important;
  }
  /* Inline-block, or the anchor below floats loose in the line and its
     zero-width space swallows the real space after the host. */
  .section:empty {
    display: inline-block !important;
  }
  .section:empty::before {
    content: "\\200B";
  }
  .char {
    display: inline-block !important;
    opacity: 1;
    transform: none;
    filter: none;
    white-space: pre !important;
  }`
