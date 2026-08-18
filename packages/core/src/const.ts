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
// at whichever of its edges is moving, which the neighbour on that side
// rides: exiting glyphs dissolve there as the edge sweeps over them on a
// shrink, and entering glyphs past the old edge come out from under it on a
// grow. A start-anchored box moves its end (the usual case, and a flow's);
// an end-anchored one its start; a centred one both. The exits get a soft
// band just inside the edge (they are fading anyway); the live row a hard
// clip a hair past it, since a soft band there would dim the last glyph until
// the mask lifted, and a mask cannot reach past the box for composited
// children. The clip is loose on every other side so a roll's vertical
// travel, and old glyphs standing past a still edge, stay in.
const EDGE_FADE = '0.3em'
const EDGE_SLACK = '0.1em'
const FAR = '9999px'

type Sides = { left: boolean; right: boolean }

const exitMask = (sides: Sides) => {
  const stops = [
    sides.left ? `transparent 0, #000 ${EDGE_FADE}` : '#000 0',
    sides.right ? `#000 calc(100% - ${EDGE_FADE}), transparent 100%` : '#000 100%',
  ].join(', ')
  const layer = (prefix: string) => `
    ${prefix}mask-image: linear-gradient(90deg, ${stops});
    ${prefix}mask-size: 100% 400%;
    ${prefix}mask-position: 0 50%;
    ${prefix}mask-repeat: no-repeat;`
  return layer('-webkit-') + layer('')
}

const rowClip = (sides: Sides) =>
  `clip-path: inset(-1em ${sides.right ? `-${EDGE_SLACK}` : `-${FAR}`} -1em ${sides.left ? `-${EDGE_SLACK}` : `-${FAR}`});`

// `data-shrink-clip` names the logical side(s) that move: "" or "end" (the
// default), "start", or "both".
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
  :host(${sel}) {
    ${rowClip(sides)}
  }
  :host(${sel}) .exits {${exitMask(sides)}
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
${clipRules()}
  span {
    margin: 0 !important;
    padding: 0 !important;
    /* The host indents its row to pin it while its box moves; that must not
       reach the glyphs, each of which is a block with a first line of its own. */
    text-indent: 0;
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
