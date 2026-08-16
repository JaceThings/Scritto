import type { Scritto } from '@scritto/core'

// Not a measurement: the metre is defined from the speed of light, so
// 299,792,458 m/s is exact by definition (BIPM, SI Brochure 9th ed., §2.3.1).
const KM_PER_SECOND = 299_792.458

const MINUTE_MS = 60_000

/**
 * How far light has run since the top of the current minute. Every timezone
 * offset is a whole number of minutes, so epoch minutes and wall-clock minutes
 * begin together.
 *
 * The minute is the anchor rather than the page load because a figure that only
 * ever climbs changes digit width logarithmically — twice in the first minute,
 * then hardly again. Against the minute it crosses a million around the third
 * second, ten million around the thirty-third, and drops back to six figures on
 * the reset, so the copy around it keeps reflowing.
 */
const traveled = () => Math.round(((Date.now() % MINUTE_MS) / 1000) * KM_PER_SECOND)

export const startLightTicker = (host: Scritto) => {
  // Trend has to be forced up. The core reads direction with parseFloat, which
  // stops at the first comma, so a grouped figure reads as standing still or
  // falling however fast it climbs.
  host.setOptions({ trend: 1 })

  const paint = (animate: boolean) => {
    const value = traveled().toLocaleString('en-US')
    host.update(value, animate)
    host.setAttribute('aria-label', value)
  }

  paint(false)
  const tick = window.setInterval(() => paint(true), 1000)

  // A background tab throttles the interval to roughly once a minute, which
  // leaves a stale — and therefore untrue — figure on screen on the way back.
  const onVisible = () => {
    if (!document.hidden) paint(true)
  }
  document.addEventListener('visibilitychange', onVisible)

  return () => {
    window.clearInterval(tick)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
