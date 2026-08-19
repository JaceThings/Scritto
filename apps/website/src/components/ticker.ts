import type { Scritto } from '@scritto/core'

const KM_PER_SECOND = 299_792.458
const KM_PER_MILE = 1.609344

const MINUTE_MS = 60_000

// Where the reader is, not what language they read in: en-US is the default
// browser language half the world over.
const US_ZONES = [
  'Pacific/Honolulu',
  'America/Adak',
  'America/Anchorage',
  'America/Boise',
  'America/Chicago',
  'America/Denver',
  'America/Detroit',
  'America/Indiana/',
  'America/Juneau',
  'America/Kentucky/',
  'America/Los_Angeles',
  'America/Menominee',
  'America/Metlakatla',
  'America/New_York',
  'America/Nome',
  'America/North_Dakota/',
  'America/Phoenix',
  'America/Sitka',
  'America/Yakutat',
]

const inUS = () => {
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone
  return US_ZONES.some((zone) => here.startsWith(zone))
}

/**
 * Anchored to the minute rather than the page load: a figure that only climbs
 * stops changing digit width, and the copy around it stops reflowing.
 */
const traveled = (perSecond: number) => Math.round(((Date.now() % MINUTE_MS) / 1000) * perSecond)

export const startLightTicker = (host: Scritto, unit: HTMLElement) => {
  const miles = inUS()
  const perSecond = miles ? KM_PER_SECOND / KM_PER_MILE : KM_PER_SECOND
  unit.textContent = miles ? 'miles' : 'km'

  const paint = (animate: boolean) => {
    const value = traveled(perSecond).toLocaleString('en-US')
    host.update(value, animate)
    host.setAttribute('aria-label', `${value} ${unit.textContent}`)
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
