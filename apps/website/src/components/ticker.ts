import type { Scritto } from '@scritto/core'

const KM_PER_SECOND = 299_792.458

const MINUTE_MS = 60_000

/**
 * Anchored to the minute rather than the page load: a figure that only climbs
 * stops changing digit width, and the copy around it stops reflowing.
 */
const traveled = () => Math.round(((Date.now() % MINUTE_MS) / 1000) * KM_PER_SECOND)

export const startLightTicker = (host: Scritto) => {
  const paint = (animate: boolean) => {
    const value = traveled().toLocaleString('en-US')
    host.update(value, animate)
    host.setAttribute('aria-label', value)
  }

  paint(false)
  const tick = window.setInterval(() => paint(true), 1000)

  const onVisible = () => {
    if (!document.hidden) paint(true)
  }
  document.addEventListener('visibilitychange', onVisible)

  return () => {
    window.clearInterval(tick)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
