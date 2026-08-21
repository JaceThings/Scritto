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

// The band sits past the content, not inside it: the box converges on its width
// asymptotically, so a band within it would dim the last glyph the whole way and
// pop when the mask lifted. `EDGE_SLACK` widens the mask's box and a negative end
// margin takes that back out of the layout, staying inside a word space.
const EDGE_FADE = '0.3em'

/** How far past the content the mask's box reaches, in em. */
export const EDGE_SLACK = 0.4

export const edgeSlackPx = (el: HTMLElement) => (parseFloat(getComputedStyle(el).fontSize) || 16) * EDGE_SLACK

/** Room above and below the line for a descender and its blur, in em. */
const BLOCK_SLACK = 0.5

export const blockSlackPx = (el: HTMLElement) => (parseFloat(getComputedStyle(el).fontSize) || 16) * BLOCK_SLACK

type Sides = { left: boolean; right: boolean }

const edgeStops = (sides: Sides) =>
  [
    sides.left ? `transparent 0, #000 ${EDGE_FADE}` : '#000 0',
    sides.right ? `#000 calc(100% - ${EDGE_FADE}), transparent 100%` : '#000 100%',
  ].join(', ')

// Overscaled vertically on purpose: the band only ever cuts horizontally, so a
// descender or a blurred glyph reaching past the box keeps its ink.
const edgeMask = (sides: Sides) => {
  const stops = edgeStops(sides)
  const layer = (prefix: string) => `
    ${prefix}mask-image: linear-gradient(90deg, ${stops});
    ${prefix}mask-size: 100% 400%;
    ${prefix}mask-position: 0 50%;
    ${prefix}mask-repeat: no-repeat;`
  return layer('-webkit-') + layer('')
}

/**
 * `data-shrink-clip` names the logical sides that move: "" or "end", "start",
 * "both". The end side carries the mask's slack, so its band falls outside the
 * content and the host wears it, which covers the ghosts inside it too. The
 * start side has none, so its band goes on the ghosts alone and live ink is
 * never faded - and no ink ever wears both bands, which would square the ramp.
 */
const clipRules = () => {
  const cases: [selector: string, start: boolean, end: boolean, rtl: boolean][] = [
    [`[data-shrink-clip='']`, false, true, false],
    [`[data-shrink-clip='end']`, false, true, false],
    [`[data-shrink-clip='start']`, true, false, false],
    [`[data-shrink-clip='both']`, true, true, false],
    [`[data-shrink-clip='']:dir(rtl)`, false, true, true],
    [`[data-shrink-clip='end']:dir(rtl)`, false, true, true],
    [`[data-shrink-clip='start']:dir(rtl)`, true, false, true],
    [`[data-shrink-clip='both']:dir(rtl)`, true, true, true],
  ]
  const sides = (left: boolean, right: boolean): Sides => ({ left, right })
  return cases
    .map(([sel, start, end, rtl]) => {
      const host = end ? `
  :host(${sel}) {${edgeMask(rtl ? sides(true, false) : sides(false, true))}
  }` : ''
      const exits = start ? `
  :host(${sel}) .exits {${edgeMask(rtl ? sides(false, true) : sides(true, false))}
    /* !important, over the span reset below: the band's own box is the line, so
       a ghost's descender needs the same room the host takes. */
    padding-block: ${BLOCK_SLACK}em !important;
    margin-block: -${BLOCK_SLACK}em !important;
  }` : ''
      return host + exits
    })
    .join('')
}

export const STYLES = `
  :host {
    position: relative;
    display: inline;
    box-sizing: border-box;
    white-space: nowrap !important;
    isolation: isolate;
    vertical-align: baseline;
  }
  /* Sits on a section's baseline, not the host's box, which the taller section
     boxes stick a couple of pixels above. */
  .exits {
    position: absolute;
    inset-inline-start: 0;
    width: 100%;
    display: inline-flex !important;
    z-index: 2;
    pointer-events: none;
  }
  .exits::before {
    content: "\\200B"; /* baseline anchor, as on an empty section */
  }
${clipRules()}
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
  .section {
    position: relative !important;
    display: inline-flex !important;
    flex: none;
    transform: none;
    z-index: 1;
  }
  .section::before {
    content: "\\200B"; /* baseline when the section is empty */
  }
  .char {
    display: inline-block !important;
    opacity: 1;
    transform: none;
    filter: none;
    white-space: pre !important;
  }`
