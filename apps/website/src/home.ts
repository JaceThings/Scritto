import '@scritto/core'
import type { Scritto } from '@scritto/core'
import { bindJustif } from './justif'
import { comma, company, connectLive, nth, sitting, type Stats } from './live'
import { playCopySuccess } from './sounds'

// The wordmark lives in the header the router never swaps, so the dictionary
// entry has to be hung off it on mount and taken down again on the way out.
const mountEntry = (root: ParentNode) => {
  const entry = root.querySelector<HTMLTemplateElement>('#entry')
  const heading = root.querySelector('h1')
  const head = heading?.parentElement
  if (!entry || !heading || !head) return
  const parts = [...entry.content.cloneNode(true).childNodes].filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  )
  const [gloss, senses] = parts
  head.classList.add('entry-head')
  heading.after(gloss)
  head.after(senses)
  return () => {
    head.classList.remove('entry-head')
    for (const part of parts) part.remove()
  }
}

export const initHome = (root: ParentNode = document) => {
  const unmountEntry = mountEntry(root)
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
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
    const label = button.querySelector('[data-copy-label]')
    button.addEventListener('click', async () => {
      const command = button.dataset.copy
      if (!command || !label) return
      const restore = (text: string, after: number) => {
        timers.add(
          window.setTimeout(() => {
            label.textContent = text
            label.classList.remove('text-accent-green')
          }, after),
        )
      }
      try {
        await navigator.clipboard.writeText(command)
        playCopySuccess()
        label.textContent = 'copied'
        label.classList.add('text-accent-green')
        restore('copy', 1400)
      } catch {
        label.textContent = 'failed'
        restore('copy', 2400)
      }
    })
  }

  return () => {
    unmountEntry?.()
    justified?.destroy()
    disconnect()
    window.clearInterval(ticking)
    for (const timer of timers) window.clearTimeout(timer)
  }
}
