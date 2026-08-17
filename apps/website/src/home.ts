import '@scritto/core'
import type { Scritto } from '@scritto/core'
import { bindCorners } from './corners'
import { bindJustif } from './justif'
import { comma, company, connectLive, nth, sitting, type Stats } from './live'
import { playCopySuccess } from './sounds'

export const initHome = (root: ParentNode = document) => {
  const corners = bindCorners(root)
  const justified = bindJustif(root)
  const node = (id: string) => root.querySelector<Scritto>(id)!

  const you = node('#you')
  const here = node('#here')
  const views = node('#views')
  const clicks = node('#clicks')
  const sat = node('#sat')
  const npm = node('#npm')

  const options = { respectMotionPreference: true, bounce: false }

  const paint = (el: Scritto, value: string, animate: boolean) => {
    el.setOptions(options)
    el.update(value, animate)
  }

  const paintSat = (seconds: number, animate: boolean) => {
    sat.setOptions({ ...options, transition: { duration: 280 } })
    sat.update(sitting(seconds), animate)
  }

  let arrived = false

  const render = (stats: Stats, animate: boolean) => {
    paint(you, nth(stats.you), animate)
    paint(here, company(stats.here), animate)
    paint(views, comma(stats.views), animate)
    paint(clicks, comma(stats.clicks), animate)
    paint(npm, comma(stats.npm), animate)
  }

  const disconnect = connectLive((stats) => {
    const first = !arrived
    arrived = true
    render(stats, !first)
  })

  const started = Date.now()
  paintSat(0, false)
  const ticking = window.setInterval(() => {
    paintSat(Math.floor((Date.now() - started) / 1000), true)
  }, 1000)

  const timers = new Set<number>()
  const status = root.querySelector('[data-copy-status]')
  // One row is confirmed at a time, and every press owns the reset that follows
  // it: an earlier timer must not cut a later row's confirmation short.
  let confirmed: HTMLButtonElement | null = null
  let press = 0

  const settle = () => {
    confirmed?.removeAttribute('data-copied')
    confirmed = null
    if (status) status.textContent = ''
  }

  const hold = (mine: number, after: number) => {
    timers.add(
      window.setTimeout(() => {
        if (press === mine) settle()
      }, after),
    )
  }

  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
    button.addEventListener('click', async () => {
      const command = button.dataset.copy
      if (!command) return
      const pkg = button.dataset.pkg ?? command
      const mine = ++press
      settle()
      try {
        await navigator.clipboard.writeText(command)
        playCopySuccess()
        confirmed = button
        button.setAttribute('data-copied', '')
        // The check mark is the sighted feedback; the row's own label never
        // changes, so the announcement is what a screen reader has to go on.
        if (status) status.textContent = `Copied ${pkg} install command to clipboard`
        hold(mine, 1400)
      } catch {
        if (status) status.textContent = `Unable to copy ${pkg} install command`
        hold(mine, 2400)
      }
    })
  }

  return () => {
    corners()
    justified?.destroy()
    disconnect()
    window.clearInterval(ticking)
    for (const timer of timers) window.clearTimeout(timer)
  }
}
