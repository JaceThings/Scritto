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

const maskLayer = (prefix: string, angle: string, position: string) => `
    ${prefix}mask-image: linear-gradient(${angle}, #000 0%, #000 100%, transparent);
    ${prefix}mask-size: calc(100% + 0.9em) 400%;
    ${prefix}mask-position: ${position};
    ${prefix}mask-repeat: no-repeat;
    ${prefix}mask-clip: no-clip;`

const overflowMask = (angle: string, position: string) =>
  `${maskLayer('-webkit-', angle, position)}${maskLayer('', angle, position)}`

export const STYLES = `
  :host {
    position: relative;
    display: inline;
    box-sizing: border-box;
    white-space: nowrap !important;
    isolation: isolate;
    vertical-align: baseline;
  }
  :host([data-shrink-clip]) {
    clip-path: inset(-2em -0.9em -2em 0);${overflowMask('90deg', '0 50%')}
  }
  :host([data-shrink-clip]:dir(rtl)) {
    clip-path: inset(-2em 0 -2em -0.9em);${overflowMask('270deg', '100% 50%')}
  }
  :host([data-shrink-clip]) [inert] {
    -webkit-mask-image: linear-gradient(90deg, #000 0%, #000 calc(100% - 1.15em), transparent);
    mask-image: linear-gradient(90deg, #000 0%, #000 calc(100% - 1.15em), transparent);
  }
  span {
    margin: 0 !important;
    padding: 0 !important;
    transform-origin: center;
  }
  [inert] {
    position: absolute !important;
    display: inline-flex !important;
    /* Exiting glyphs are placed by a transform measured from the host's start
       edge, so the layer must not fall back to its static inline position. */
    inset-inline-start: 0;
    z-index: 2;
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
