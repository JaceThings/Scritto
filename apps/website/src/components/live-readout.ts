import type { Scritto } from '@scritto/core'
import { comma, company, connectLive, nth, sitting, type Stats } from '../lib/live'

const OPTIONS = { respectMotionPreference: true, bounce: false }
const SAT_DURATION = 280

// The sitting timer measures the visit, not the mount: it survives moving
// between the site's own pages, and a reload starts it over.
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

const elapsed = () => Math.floor((Date.now() - started) / 1000)

// The last stats paint immediately on a return visit to the page, so the
// sentence keeps its full height instead of collapsing until /hello answers.
let cached: Stats | null = null

/** The opening sentence's live figures: visitor counts, pokes, and the timer. */
export const bindLiveReadout = (root: ParentNode) => {
  const node = (id: string) => root.querySelector<Scritto>(id)!
  const sat = node('#sat')

  const fields: Array<[Scritto, (stats: Stats) => string]> = [
    [node('#you'), (stats) => nth(stats.you)],
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

  // A background tab throttles the interval; catch the figure up the moment
  // the page is looked at again.
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
