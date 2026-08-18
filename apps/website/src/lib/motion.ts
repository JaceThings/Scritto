// The site's one state-change beat, shared by every swap that has to read as
// part of the same gesture.
export const STATE_CHANGE_MS = 350
export const STATE_CHANGE_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'

// Away faster than back, so the handoff has happened before the eye has
// finished reading the exit.
export const SWAP_OUT_MS = Math.round(STATE_CHANGE_MS * 0.4)
export const SWAP_IN_MS = STATE_CHANGE_MS - SWAP_OUT_MS
export const SWAP_BLUR = 4
export const SWAP_SCALE = 0.94

export const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
