// Only `#page` swaps: the old body fades out, the footer slides to its new
// position while the new body is hidden, then that fades in.

import { playClick } from './sounds'

const FADE_MS = 250
const FOOTER_SLIDE_MS = 350
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'

export type PageInit = (root: ParentNode) => (() => void) | void

const normalize = (pathname: string) => {
  const file = pathname.slice(pathname.lastIndexOf('/') + 1)
  if (file === 'playground.html') return '/playground'
  if (file === 'docs.html') return '/docs'
  if (file === '' || file === 'index.html') return '/'
  return pathname
}

const settled = (animation: Animation) =>
  animation.finished.catch(() => {}).then(() => undefined)

const documents = new Map<string, Document>()

const load = async (url: URL) => {
  const key = url.pathname
  const cached = documents.get(key)
  if (cached) return cached
  const res = await fetch(url.href, { headers: { accept: 'text/html' } })
  if (!res.ok) throw new Error(`${url.pathname} ${res.status}`)
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html')
  documents.set(key, doc)
  return doc
}

export const startRouter = (pages: Record<string, PageInit>) => {
  const page = document.querySelector<HTMLElement>('#page')
  const footer = document.querySelector<HTMLElement>('footer')
  if (!page || !footer) return

  let route = normalize(location.pathname)
  let dispose = pages[route]?.(document) ?? undefined
  let busy = false


  const navigate = async (url: URL, push: boolean) => {
    if (busy) return
    busy = true
    document.documentElement.classList.add('routed')
    try {
      const doc = await load(url)
      const next = doc.querySelector<HTMLElement>('#page')
      if (!next) {
        location.href = url.href
        return
      }

      await settled(page.animate({ opacity: [1, 0] }, { duration: FADE_MS, easing: EASE }))
      page.style.opacity = '0'

      const footerBefore = footer.getBoundingClientRect().top

      dispose?.()
      dispose = undefined
      page.className = next.className
      page.replaceChildren(...next.cloneNode(true).childNodes)
      document.title = doc.title
      if (push) history.pushState(null, '', url)
      route = normalize(url.pathname)
      document.documentElement.dataset.route = route
      dispose = pages[route]?.(document) ?? undefined

      const shift = footerBefore - footer.getBoundingClientRect().top
      if (Math.abs(shift) > 0.5) {
        footer.animate(
          { transform: [`translateY(${shift}px)`, 'none'] },
          { duration: FOOTER_SLIDE_MS, easing: EASE },
        )
      }

      const reveal = page.animate(
        { opacity: [0, 1] },
        { duration: FADE_MS, easing: EASE, delay: FOOTER_SLIDE_MS, fill: 'backwards' },
      )
      void settled(reveal).then(() => {
        page.style.opacity = ''
      })
    } catch {
      location.href = url.href
    } finally {
      busy = false
    }
  }

  const leave = (url: URL, sameRoute: boolean) => {
    const go = () => {
      if (sameRoute) return
      void navigate(url, true)
    }
    if (window.scrollY <= 0) {
      go()
      return
    }
    let started = false
    const once = () => {
      if (started) return
      started = true
      go()
    }
    // `scrollend` is missing on older Safari; fall back to a scaled timeout.
    if (window.onscrollend !== undefined) {
      window.addEventListener('scrollend', once, { once: true })
      window.setTimeout(once, 900)
    } else {
      window.setTimeout(once, Math.min(700, window.scrollY * 0.6))
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (event.button !== 0) return
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('.footer-link') : null
    const link = anchor?.hasAttribute('data-route') ? anchor : null
    if (!link) {
      if (anchor) playClick()
      return
    }
    const url = new URL(link.href, location.href)
    if (url.origin !== location.origin) return
    const sameRoute = normalize(url.pathname) === route
    if (!sameRoute) playClick()
    event.preventDefault()
    leave(url, sameRoute)
  })

  window.addEventListener('popstate', () => {
    const url = new URL(location.href)
    if (normalize(url.pathname) === route) return
    void navigate(url, false)
  })
}
