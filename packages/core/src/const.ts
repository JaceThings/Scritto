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
export const STYLES = `
  :host {
    position: relative;
    display: inline-flex;
    box-sizing: border-box;
    white-space: nowrap !important;
    isolation: isolate;
    vertical-align: baseline;
  }
  :host([data-shrink-clip]) {
    clip-path: inset(-2em 0 -2em 0);
  }
  :host([data-shrink-clip]) [inert] {
    -webkit-mask-image: linear-gradient(90deg, #000 0%, #000 calc(100% - 0.7em), transparent);
    mask-image: linear-gradient(90deg, #000 0%, #000 calc(100% - 0.7em), transparent);
  }
  span {
    margin: 0 !important;
    padding: 0 !important;
    transform-origin: center;
  }
  [inert] {
    position: absolute !important;
    display: inline-flex !important;
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
