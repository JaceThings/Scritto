import type { Transition } from './types'

export const SPACE = '\u00A0'
export const CONFIG = {
  y: 0.35,
  scale: 0.6,
  blur: 0.1,
  rotate: 2,
  stagger: 0.3,
  /** How far into its roll a glyph is before it starts to carry its neighbours. */
  push: 0.35,
  /** How much later, as a share of the duration, each line below the host's takes up the wave. */
  lineLag: 0.12,
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

// While a host's width animates with text following it, its row is clipped
// at its own edge, which the neighbour rides: exiting glyphs dissolve there
// as the edge sweeps over them on a shrink, and entering glyphs past the old
// edge come out from under it on a grow. The exits get a soft band just
// inside the edge (they are fading anyway); the live row a hard clip a hair
// past it, since a soft band there would dim the last glyph until the mask
// lifted, and a mask cannot reach past the box for composited children. The
// clip is loose everywhere else so a roll's vertical travel stays in.
const EDGE_FADE = '0.3em'
const EDGE_SLACK = '0.1em'

const edgeMask = (prefix: string, angle: string, position: string) => `
    ${prefix}mask-image: linear-gradient(${angle}, #000 calc(100% - ${EDGE_FADE}), transparent 100%);
    ${prefix}mask-size: 100% 400%;
    ${prefix}mask-position: ${position};
    ${prefix}mask-repeat: no-repeat;`

const exitMask = (angle: string, position: string) =>
  `${edgeMask('-webkit-', angle, position)}${edgeMask('', angle, position)}`

const rowClip = (end: 'right' | 'left') =>
  `clip-path: inset(-1em ${end === 'right' ? `-${EDGE_SLACK} -1em -1em` : `-1em -1em -${EDGE_SLACK}`});`

export const STYLES = `
  :host {
    position: relative;
    display: inline;
    box-sizing: border-box;
    white-space: nowrap !important;
    isolation: isolate;
    vertical-align: baseline;
  }
  /* Sits where a .section sits — the same line box, off the same baseline
     anchor — so an exiting glyph lines up with the live glyph it replaces.
     Anchoring it to the host's box instead drops it by the couple of pixels
     the taller section boxes stick out. */
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
  :host([data-shrink-clip]) {
    ${rowClip('right')}
  }
  :host([data-shrink-clip]:dir(rtl)) {
    ${rowClip('left')}
  }
  :host([data-shrink-clip]) .exits {${exitMask('90deg', '0 50%')}
  }
  :host([data-shrink-clip]:dir(rtl)) .exits {${exitMask('270deg', '100% 50%')}
  }
  span {
    margin: 0 !important;
    padding: 0 !important;
    transform-origin: center;
  }
  .exits > [inert] {
    position: absolute !important;
    display: inline-flex !important;
    /* Exiting glyphs are placed by a transform measured from the host's start
       edge, so the layer must not fall back to its static inline position. */
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
