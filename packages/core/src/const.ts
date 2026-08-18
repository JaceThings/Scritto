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

// A moving edge masks the row, and the neighbour rides it: old glyphs dissolve
// as it sweeps over them, new ones surface from under it. Both the live row
// and the exits fade over the same band, so nothing crosses a hard line —
// the mask's own coordinate box is the border box, so it hides horizontal
// overflow past a still-narrower edge without needing to reach past it
// (that's only ever a problem for the exits, which sit outside it on
// purpose). A linear-gradient mask varies in one axis only, so the other
// stays unbounded: a roll's vertical travel is never touched.
const EDGE_FADE = '0.3em'

type Sides = { left: boolean; right: boolean }

const edgeStops = (sides: Sides) =>
  [
    sides.left ? `transparent 0, #000 ${EDGE_FADE}` : '#000 0',
    sides.right ? `#000 calc(100% - ${EDGE_FADE}), transparent 100%` : '#000 100%',
  ].join(', ')

const edgeMask = (sides: Sides, size: string, position: string) => {
  const stops = edgeStops(sides)
  const layer = (prefix: string) => `
    ${prefix}mask-image: linear-gradient(90deg, ${stops});
    ${prefix}mask-size: ${size};
    ${prefix}mask-position: ${position};
    ${prefix}mask-repeat: no-repeat;`
  return layer('-webkit-') + layer('')
}

/** `data-shrink-clip` names the logical sides that move: "" or "end", "start", "both". */
const clipRules = () => {
  const cases: [selector: string, sides: Sides][] = [
    [`[data-shrink-clip='']`, { left: false, right: true }],
    [`[data-shrink-clip='end']`, { left: false, right: true }],
    [`[data-shrink-clip='start']`, { left: true, right: false }],
    [`[data-shrink-clip='both']`, { left: true, right: true }],
    [`[data-shrink-clip='']:dir(rtl)`, { left: true, right: false }],
    [`[data-shrink-clip='end']:dir(rtl)`, { left: true, right: false }],
    [`[data-shrink-clip='start']:dir(rtl)`, { left: false, right: true }],
  ]
  return cases
    .map(
      ([sel, sides]) => `
  :host(${sel}) {${edgeMask(sides, '100% 100%', '0 0')}
  }
  :host(${sel}) .exits {${edgeMask(sides, '100% 400%', '0 50%')}
  }`,
    )
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
