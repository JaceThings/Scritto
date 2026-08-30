import type { Scritto } from '@scritto/core'
import { comma, company, companyCount, connectLive, nth, sitting, type Stats } from '../lib/live'

const OPTIONS = { respectMotionPreference: true, bounce: false }
const SAT_DURATION = 280

// The visit, not the mount: it survives navigation and a reload starts it over.
const SAT_KEY = 'scritto_sat_start'
const reloaded = () => {
  const [entry] = performance.getEntriesByType('navigation')
  return entry instanceof PerformanceNavigationTiming && entry.type === 'reload'
}
const started = (() => {
  const stored = Number(sessionStorage.getItem(SAT_KEY))
  if (!reloaded() && Number.isFinite(stored) && stored > 0 && stored <= Date.now()) return stored
  const now = Date.now()
  sessionStorage.setItem(SAT_KEY, String(now))
  return now
})()

// From one, or a fresh load paints "0 seconds" and drops the s a beat later.
const elapsed = () => Math.max(1, Math.floor((Date.now() - started) / 1000))

// Painted immediately on a return visit, so the sentence keeps its height.
let cached: Stats | null = null

export const bindLiveReadout = (root: ParentNode) => {
  const node = (id: string) => root.querySelector<Scritto>(id)!
  const sat = node('#sat')

  const fields: Array<[Scritto, (stats: Stats) => string]> = [
    [node('#you'), (stats) => nth(stats.you)],
    [node('#here-count'), (stats) => companyCount(stats.here)],
    [node('#here'), (stats) => company(stats.here)],
    [node('#views'), (stats) => comma(stats.views)],
    [node('#clicks'), (stats) => comma(stats.clicks)],
    [node('#npm'), (stats) => comma(stats.npm)],
  ]

  const paint = (stats: Stats, animate: boolean) => {
    for (const [el, read] of fields) {
      el.setOptions(OPTIONS)
      el.update(read(stats), animate)
    }
  }

  const paintSat = (animate: boolean) => {
    sat.setOptions({ ...OPTIONS, transition: { duration: SAT_DURATION } })
    sat.update(sitting(elapsed()), animate)
  }

  let arrived = cached !== null
  if (cached) paint(cached, false)
  const disconnect = connectLive((stats) => {
    const animate = arrived
    arrived = true
    cached = stats
    paint(stats, animate)
  })

  paintSat(false)
  const ticking = window.setInterval(() => paintSat(true), 1000)

  // A background tab throttles the interval.
  const onVisible = () => {
    if (!document.hidden) paintSat(true)
  }
  document.addEventListener('visibilitychange', onVisible)

  return () => {
    disconnect()
    window.clearInterval(ticking)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
