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
    white-space: nowrap !important; /* no multi-line support */
    isolation: isolate;
  }
  span {
    margin: 0 !important;
    padding: 0 !important;
    transform-origin: center;
  }
  [inert] {
    position: absolute !important;
    display: inline-flex !important;
    will-change: transform;
    z-index: 0;
  }
  .section {
    position: relative !important;
    display: inline-flex !important;
    will-change: transform;
    z-index: 1;
  }
  .char {
    display: inline-block !important;
    white-space: pre !important;
  }`
